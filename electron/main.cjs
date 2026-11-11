/**
 * StockPilot Till — Electron main process.
 *
 * This is the shop-side desktop app. The platform admin panel stays on the web;
 * this build exists for one reason the browser cannot deliver: printing a bill
 * to a named printer, silently, with an exact page height.
 *
 * Receipts are printed by loading the receipt HTML into a hidden window and
 * calling webContents.print({ silent: true, deviceName }). Nothing is hidden or
 * restyled in the main window, and the page size is given in microns so a 90mm
 * bill uses 90mm of paper.
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('node:path')
const { printHtml } = require('./print.cjs')
const { downloadAndInstall } = require('./updater.cjs')
const { saveHtmlAsPdf, revealFile } = require('./pdf.cjs')

// Read from package.json rather than app.getVersion(): that returns Electron's
// own version whenever the app is not started as a directory, which would show
// the wrong number in the title bar and break update comparisons.
const APP_VERSION = require('../package.json').version

// Kept in step with .titlebar in global.css.
const TITLEBAR_HEIGHT = 38

// Vite dev server when running `npm run electron:dev`, packaged files otherwise.
const DEV_URL = process.env.VITE_DEV_SERVER_URL
const isDev = Boolean(DEV_URL)

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#131a2b',
    title: `StockPilot Till  v${APP_VERSION}`,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),

    // Windows offers no way to recolour the standard caption, so the frame is
    // hidden and only the min/max/close buttons are overlaid. The app paints
    // the rest of the strip itself (see TitleBar), which is how the window
    // chrome ends up matching the sidebar instead of being system white.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#131a2b',        // --sidebar
      symbolColor: '#cbd5e1',
      height: TITLEBAR_HEIGHT,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // The page's own <title> would otherwise replace the window caption, hiding
  // the version the shop needs to quote when reporting a problem.
  mainWindow.on('page-title-updated', (event) => event.preventDefault())

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.maximize()
  })

  if (isDev) {
    mainWindow.loadURL(DEV_URL)
  } else {
    // HashRouter is used in the Electron build so file:// URLs resolve.
    const entry = path.join(__dirname, '..', 'dist-desktop', 'index.html')
    if (require('node:fs').existsSync(entry)) {
      mainWindow.loadFile(entry)
    } else {
      // A missing build used to mean a silent, empty window. Say what to do.
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<body style="margin:0;background:#131a2b;color:#e2e8f0;font:15px Segoe UI,sans-serif;'
        + 'display:grid;place-items:center;height:100vh"><div style="text-align:center">'
        + '<h2 style="margin:0 0 10px">The app has not been built yet</h2>'
        + '<p style="color:#94a3b8">Run <code>npm run build:electron</code>, then start it again.</p>'
        + '</div></body>'
      ))
    }
  }

  // Anything aiming at a real website opens in the user's browser, not in the till.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* ------------------------------------------------------------------ *
 * Printing
 * ------------------------------------------------------------------ */

/** Every printer Windows can see, with the default flagged. */
ipcMain.handle('printers:list', async () => {
  if (!mainWindow) return []
  try {
    const printers = await mainWindow.webContents.getPrintersAsync()
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: Boolean(p.isDefault),
      status: p.status,
    }))
  } catch {
    return []
  }
})

ipcMain.handle('printers:print', (_event, payload) => printHtml(payload))

/**
 * Downloads the published installer and runs it, reporting progress back to the
 * window so the user sees something happen during a 100MB download.
 */
ipcMain.handle('update:install', async (event, { url, version }) => {
  try {
    return await downloadAndInstall({ url, version }, (percent) => {
      if (!event.sender.isDestroyed()) event.sender.send('update:progress', percent)
    })
  } catch (err) {
    return { started: false, error: err.message || 'The download failed.' }
  }
})

/** Opens the download link in the user's browser instead. */
ipcMain.handle('update:openLink', async (_event, { url }) => {
  await shell.openExternal(url)
  return { ok: true }
})

/** Renders label-sheet HTML to an A4 PDF in the Downloads folder. */
ipcMain.handle('pdf:save', (_event, payload) => saveHtmlAsPdf(payload))

/** Opens Explorer with the saved file selected. */
ipcMain.handle('pdf:reveal', (_event, { path: filePath }) => {
  revealFile(filePath)
  return { ok: true }
})

ipcMain.handle('app:info', () => ({
  version: APP_VERSION,
  platform: process.platform,
}))

ipcMain.handle('app:error', async (_event, { title, message }) => {
  await dialog.showMessageBox(mainWindow, { type: 'error', title, message })
})
