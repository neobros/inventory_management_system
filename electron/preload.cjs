/**
 * The only bridge between the till UI and Node.
 *
 * contextIsolation stays on and nodeIntegration off, so the renderer gets this
 * narrow, named API and nothing else — no fs, no child_process, no ipcRenderer.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('stockpilot', {
  isElectron: true,

  /** [{ name, displayName, isDefault, status }] */
  listPrinters: () => ipcRenderer.invoke('printers:list'),

  /** Silent print to a named printer. -> { success, failureReason } */
  print: (payload) => ipcRenderer.invoke('printers:print', payload),

  info: () => ipcRenderer.invoke('app:info'),

  /** Saves HTML as an A4 PDF in Downloads. -> { ok, path } */
  savePdf: (payload) => ipcRenderer.invoke('pdf:save', payload),

  /** Shows a saved file in Explorer. */
  revealFile: (filePath) => ipcRenderer.invoke('pdf:reveal', { path: filePath }),

  /** Downloads the new installer and runs it; the app quits when it starts. */
  installUpdate: (payload) => ipcRenderer.invoke('update:install', payload),

  /** Opens the download link in the user's browser. */
  openUpdateLink: (payload) => ipcRenderer.invoke('update:openLink', payload),

  /** Download progress, 0-100. Returns an unsubscribe function. */
  onUpdateProgress: (callback) => {
    const handler = (_event, percent) => callback(percent)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },

  showError: (title, message) => ipcRenderer.invoke('app:error', { title, message }),
})
