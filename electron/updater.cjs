/**
 * Downloads and launches a new version of the till.
 *
 * The installer is fetched to the temp folder, the running app quits, and the
 * installer takes over — NSIS replaces the existing install in place, so the old
 * version is gone once it finishes.
 *
 * Google Drive needs special handling. For anything over about 100MB it does not
 * serve the file directly: it answers with an HTML page asking the user to
 * confirm past the virus scan. That page carries a form with the real download
 * parameters, so the flow here is: request, notice HTML came back, read the
 * confirmation form out of it, and request again with those parameters and the
 * cookies Drive set. Only if that still fails does the browser get involved.
 */

const { app, shell, BrowserWindow } = require('electron')
const { createWriteStream, existsSync, unlinkSync, statSync, openSync, readSync, closeSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const https = require('node:https')
const http = require('node:http')
const { spawn } = require('node:child_process')

const MAX_REDIRECTS = 8
const MAX_CONFIRM_STEPS = 4

/** Windows executables begin with "MZ"; an HTML error page does not. */
function looksLikeExecutable(filePath) {
  try {
    if (statSync(filePath).size < 1024 * 1024) return false // no real installer is under 1MB
    const fd = openSync(filePath, 'r')
    const buffer = Buffer.alloc(2)
    readSync(fd, buffer, 0, 2, 0)
    closeSync(fd)
    return buffer[0] === 0x4d && buffer[1] === 0x5a // "MZ"
  } catch {
    return false
  }
}

/** Minimal cookie jar — Drive's confirmation step only works with its cookies. */
function rememberCookies(jar, headers) {
  const set = headers['set-cookie']
  if (!set) return
  set.forEach((line) => {
    const [pair] = line.split(';')
    const index = pair.indexOf('=')
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
  })
}

const cookieHeader = (jar) =>
  Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')

/** Issues a GET, following redirects itself so cookies survive each hop. */
function request(url, jar, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StockPilotTill',
      Accept: '*/*',
    }
    const cookies = cookieHeader(jar)
    if (cookies) headers.Cookie = cookies

    const req = client.get(url, { headers }, (res) => {
      rememberCookies(jar, res.headers)

      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (!redirectsLeft) return reject(new Error('Too many redirects.'))
        const next = new URL(res.headers.location, url).toString()
        return resolve(request(next, jar, redirectsLeft - 1))
      }

      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`The download link returned HTTP ${res.statusCode}.`))
      }

      res.finalUrl = url
      return resolve(res)
    })

    req.on('error', reject)
    req.setTimeout(120000, () => req.destroy(new Error('The download timed out.')))
  })
}

const isHtml = (res) => (res.headers['content-type'] || '').toLowerCase().includes('text/html')

function readText(res, limit = 512 * 1024) {
  return new Promise((resolve) => {
    let data = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => {
      if (data.length < limit) data += chunk
    })
    res.on('end', () => resolve(data))
    res.on('error', () => resolve(data))
  })
}

const unescapeHtml = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

/**
 * Extracts the real download URL from Drive's "can't scan this file" page.
 *
 * Current Drive renders a form posting to drive.usercontent.google.com with the
 * id, confirm and uuid parameters. Older variants put a confirm token straight
 * on a /uc link, so both shapes are handled.
 */
function resolveConfirmation(html, pageUrl) {
  // 1. The download form.
  const form = html.match(/<form[^>]+action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i)
  if (form) {
    const action = unescapeHtml(form[1])
    const params = new URLSearchParams()
    const inputs = form[2].matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi)
    for (const [, name, value] of inputs) params.append(name, unescapeHtml(value))
    if (params.toString()) {
      return new URL(`${action}${action.includes('?') ? '&' : '?'}${params.toString()}`, pageUrl).toString()
    }
  }

  // 2. A direct link carrying a confirm token.
  const link = html.match(/href="(\/uc\?export=download[^"]+)"/i)
  if (link) return new URL(unescapeHtml(link[1]), 'https://drive.google.com').toString()

  // 3. Bare token — rebuild the /uc URL around it.
  const token = html.match(/confirm=([0-9A-Za-z_-]+)/)
  const id = pageUrl.match(/[?&]id=([A-Za-z0-9_-]+)/)
  if (token && id) {
    return `https://drive.usercontent.google.com/download?id=${id[1]}&export=download&confirm=${token[1]}`
  }

  return null
}

function pipeToFile(res, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const total = Number(res.headers['content-length']) || 0
    let received = 0

    const file = createWriteStream(destination)
    res.on('data', (chunk) => {
      received += chunk.length
      if (total) onProgress(Math.round((received / total) * 100))
    })
    res.pipe(file)

    file.on('finish', () => file.close(() => resolve(destination)))
    file.on('error', (err) => {
      try { unlinkSync(destination) } catch { /* nothing to clean */ }
      reject(err)
    })
  })
}

/**
 * Fetches a URL to disk, stepping through any confirmation pages on the way.
 * Returns { ok } or { needsBrowser } when the host will not hand over the file.
 */
async function fetchInstaller(url, destination, onProgress) {
  const jar = new Map()
  let current = url

  for (let step = 0; step < MAX_CONFIRM_STEPS; step += 1) {
    // eslint-disable-next-line no-await-in-loop -- each step depends on the last
    const res = await request(current, jar)

    if (!isHtml(res)) {
      // eslint-disable-next-line no-await-in-loop
      await pipeToFile(res, destination, onProgress)
      return { ok: true }
    }

    // eslint-disable-next-line no-await-in-loop
    const html = await readText(res)
    const next = resolveConfirmation(html, res.finalUrl || current)
    if (!next || next === current) return { needsBrowser: true }
    current = next
  }

  return { needsBrowser: true }
}

/**
 * Fetches the installer and runs it. Resolves { started: true } just before the
 * app quits, or { started: false, openedBrowser: true } when the host would not
 * hand over the file and the link was opened in a browser instead.
 */
async function downloadAndInstall({ url, version }, onProgress) {
  const target = path.join(os.tmpdir(), `StockPilot-Till-Setup-${version || 'latest'}.exe`)

  if (existsSync(target)) {
    try { unlinkSync(target) } catch { /* will be overwritten */ }
  }

  const result = await fetchInstaller(url, target, onProgress)

  if (!result.ok || !looksLikeExecutable(target)) {
    try { unlinkSync(target) } catch { /* best effort */ }
    await shell.openExternal(url)
    return {
      started: false,
      openedBrowser: true,
      reason: 'That host would not hand over the file directly, so the link has been opened in your browser. Download it there, then run it.',
    }
  }

  // Detach so the installer outlives the app it is about to replace.
  const child = spawn(target, [], { detached: true, stdio: 'ignore' })
  child.unref()

  setTimeout(() => {
    BrowserWindow.getAllWindows().forEach((w) => w.destroy())
    app.quit()
  }, 800)

  return { started: true }
}

module.exports = { downloadAndInstall, looksLikeExecutable, resolveConfirmation }
