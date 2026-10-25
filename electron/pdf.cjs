/**
 * Saves rendered HTML as an A4 PDF in the user's Downloads folder.
 *
 * Used for barcode label sheets, which go to an ordinary office printer rather
 * than the receipt roll — handing over a PDF lets the shop check the layout,
 * print it whenever, and keep it.
 *
 * Rendering happens in a hidden window rather than the till's own, so the sheet
 * can be laid out at true A4 without disturbing what the user is looking at.
 */

const { app, BrowserWindow, shell } = require('electron')
const { writeFile, access } = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

/** Adds " (2)", " (3)" … rather than overwriting an earlier sheet. */
async function uniquePath(dir, base, ext) {
  for (let n = 0; n < 100; n += 1) {
    const name = n === 0 ? `${base}${ext}` : `${base} (${n})${ext}`
    const full = path.join(dir, name)
    try {
      // eslint-disable-next-line no-await-in-loop -- probing names in order
      await access(full)
    } catch {
      return full // access threw, so nothing is there
    }
  }
  return path.join(dir, `${base} ${Date.now()}${ext}`)
}

async function saveHtmlAsPdf({ html, fileName = 'labels', landscape = false }) {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  })

  const tmpFile = path.join(os.tmpdir(), `stockpilot-labels-${Date.now()}.html`)

  try {
    await writeFile(tmpFile, html, 'utf8')
    await win.loadFile(tmpFile)

    // Barcodes are inline SVG, but wait for any images all the same.
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const imgs = Array.from(document.images).filter((i) => !i.complete)
        if (!imgs.length) return resolve(true)
        let left = imgs.length
        const tick = () => { if (--left <= 0) resolve(true) }
        imgs.forEach((i) => { i.addEventListener('load', tick); i.addEventListener('error', tick) })
        setTimeout(() => resolve(true), 3000)
      })
    `).catch(() => {})

    const pdf = await win.webContents.printToPDF({
      // The named size, not a custom one. printToPDF measures a custom
      // pageSize in inches (unlike print(), which uses microns), and the
      // mismatch is an easy way to produce "Printing failed". 'A4' lands within
      // a quarter of a millimetre, which no printer cares about.
      pageSize: 'A4',
      landscape,
      printBackground: true,
      margins: { marginType: 'none' },
    })

    const downloads = app.getPath('downloads')
    const target = await uniquePath(downloads, fileName, '.pdf')
    await writeFile(target, pdf)

    return { ok: true, path: target }
  } catch (err) {
    return { ok: false, error: err.message || 'Could not create the PDF.' }
  } finally {
    if (!win.isDestroyed()) win.destroy()
    // Best effort: the temp file is harmless if it lingers.
    import('node:fs/promises').then((fs) => fs.unlink(tmpFile)).catch(() => {})
  }
}

/** Opens the containing folder with the file selected. */
function revealFile(filePath) {
  shell.showItemInFolder(filePath)
}

module.exports = { saveHtmlAsPdf, revealFile }
