/**
 * Receipt printing for the desktop till.
 *
 * Split out from main.cjs so the print path can be exercised directly by a test
 * script instead of only through the running UI.
 */

const { BrowserWindow } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs/promises')

const MM_TO_MICRONS = 1000

// Clearance under the last line so the auto-cutter never slices the footer.
const CUT_CLEARANCE_MM = 3

/**
 * How tall the receipt really is, measured inside the print window.
 *
 * The till used to send a height measured on screen, where the receipt has
 * bigger text and padding than the printed copy — so every bill came out about
 * 20mm too long, with that much blank paper underneath. Measuring the very
 * document being printed, with the styles it prints with, cannot disagree with
 * what lands on paper. Returns null when there is nothing to measure.
 */
async function contentHeightMm(webContents) {
  const px = await webContents.executeJavaScript(`
    (function () {
      var r = document.querySelector('.receipt');
      return r ? Math.ceil(r.getBoundingClientRect().bottom) : 0;
    })()
  `).catch(() => 0)
  if (!px) return null
  return Math.ceil((px / 96) * 25.4) + CUT_CLEARANCE_MM
}

/** webContents.print() can hang indefinitely on a stuck spooler; never wait forever. */
function printOnce(webContents, options, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const timer = setTimeout(
      () => finish({ success: false, failureReason: 'Printing timed out — is the printer switched on?' }),
      timeoutMs
    )
    try {
      webContents.print(options, (success, failureReason) => {
        clearTimeout(timer)
        finish({ success, failureReason })
      })
    } catch (err) {
      clearTimeout(timer)
      finish({ success: false, failureReason: err.message })
    }
  })
}

/**
 * Prints receipt HTML to a named printer with no dialog.
 *
 * The bill is rendered in its own hidden window at the exact paper width, so the
 * till's UI never has to be hidden and restored around a print job.
 */
/* ---- TEMPORARY print diagnostics — remove once the bottom-space issue is found ---- */
const DEBUG_DIR = path.join(os.tmpdir(), 'stockpilot-print-debug')

async function debugRecord(entry, html) {
  try {
    await fs.mkdir(DEBUG_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const page = String(entry.source || 'unknown').replace(/[^a-z0-9]+/gi, '_') || 'unknown'
    const htmlFile = path.join(DEBUG_DIR, `${stamp}_${page}.html`)
    await fs.writeFile(htmlFile, html, 'utf8')
    await fs.appendFile(
      path.join(DEBUG_DIR, 'print-log.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), ...entry, htmlFile }) + '\n',
      'utf8'
    )
  } catch {
    // Diagnostics must never get in the way of printing.
  }
}
/* ---- end temporary diagnostics ---- */

async function printHtml({ html, printerName, widthMm, heightMm, copies, source }) {
  const debug = { source, printerName, widthMm, rendererHeightMm: heightMm, copies }
  // NOT offscreen. An offscreen BrowserWindow never completes layout here — the
  // renderer fails to execute scripts and print() is handed an empty document.
  // A plain hidden window renders normally and prints correctly.
  const printWindow = new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  })

  // A receipt carrying a base64 logo can exceed the practical data: URL limit,
  // so the document goes through a temp file instead.
  const tmpFile = path.join(os.tmpdir(), `stockpilot-receipt-${Date.now()}.html`)

  try {
    await fs.writeFile(tmpFile, html, 'utf8')
    await printWindow.loadFile(tmpFile)

    // Wait for images (the shop logo) to finish decoding before rasterising.
    await printWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const imgs = Array.from(document.images).filter((i) => !i.complete)
        if (!imgs.length) return resolve(true)
        let left = imgs.length
        const tick = () => { if (--left <= 0) resolve(true) }
        imgs.forEach((i) => { i.addEventListener('load', tick); i.addEventListener('error', tick) })
        setTimeout(() => resolve(true), 2000)
      })
    `).catch(() => {})

    const options = {
      silent: true,
      printBackground: true,
      copies: Math.max(1, Math.min(Number(copies) || 1, 5)),
      margins: { marginType: 'none' },
    }
    if (printerName) options.deviceName = printerName
    if (widthMm) {
      // Prefer the height measured here, in the document actually printing. The
      // renderer's figure is a fallback only — it is measured with screen styles.
      const measured = await contentHeightMm(printWindow.webContents)
      debug.measuredMm = measured
      debug.receiptsInDocument = (html.match(/class="receipt[\s"]/g) || []).length
      options.pageSize = {
        width: Math.round(widthMm * MM_TO_MICRONS),
        // A generous roll length only if neither measurement was possible.
        height: Math.round((measured || heightMm || 3000) * MM_TO_MICRONS),
      }
      debug.pageSentMm = options.pageSize.height / MM_TO_MICRONS
    }

    let result = await printOnce(printWindow.webContents, options)
    debug.firstAttempt = { success: result.success, failureReason: result.failureReason || '' }

    // Some drivers reject a custom page size outright. Rather than leave the
    // cashier with nothing, try again and let the driver use its own paper.
    if (!result.success && options.pageSize) {
      const { pageSize, ...withoutSize } = options
      result = await printOnce(printWindow.webContents, withoutSize)
      if (result.success) result.note = 'printed using the driver default paper size'
      debug.retriedWithoutPageSize = true
    }

    debug.finalResult = { success: result.success, note: result.note || '' }
    await debugRecord(debug, html)
    return result
  } catch (err) {
    return { success: false, failureReason: err.message }
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy()
    fs.unlink(tmpFile).catch(() => {})
  }
}

module.exports = { printHtml, printOnce, contentHeightMm, CUT_CLEARANCE_MM }
