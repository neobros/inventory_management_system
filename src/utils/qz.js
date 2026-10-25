/**
 * Silent printing to a printer chosen BY NAME, via QZ Tray.
 *
 * The browser alone cannot do this: window.print() always opens a dialog and
 * never lets a page pick the destination. QZ Tray is a small service that runs
 * on the till PC and exposes the machine's printers over a local WebSocket
 * (localhost:8181), so the app can send a receipt straight to "Xprinter XP-80C"
 * with no dialog and no user action.
 *
 * Everything here degrades safely: if QZ Tray is not installed the helpers
 * report unavailable and the caller falls back to normal browser printing.
 */

import qz from 'qz-tray'

let connecting = null

/** QZ refuses to talk to a page that has not been given permission. Unsigned
 *  use prompts the operator once per machine — they tick "remember". */
let configured = false

function configureOnce() {
  if (configured) return
  configured = true

  // No signing certificate: QZ shows a one-time allow prompt on this machine.
  // Supplying empty signatures keeps it in unsigned mode rather than erroring.
  qz.security.setCertificatePromise((resolve) => resolve())
  qz.security.setSignatureAlgorithm('SHA512')
  qz.security.setSignaturePromise(() => (resolve) => resolve())
}

/** True once a live connection to the local QZ Tray service exists. */
export function isConnected() {
  try {
    return qz.websocket.isActive()
  } catch {
    return false
  }
}

/**
 * Opens the connection, reusing an in-flight attempt so several callers do not
 * race. Resolves false rather than throwing when QZ Tray is not running.
 */
export async function connect({ retries = 0, timeout = 3 } = {}) {
  if (isConnected()) return true
  if (connecting) return connecting

  configureOnce()

  connecting = qz.websocket
    .connect({ retries, delay: 1, timeout })
    .then(() => true)
    .catch(() => false)
    .finally(() => { connecting = null })

  return connecting
}

export async function disconnect() {
  if (isConnected()) {
    try {
      await qz.websocket.disconnect()
    } catch {
      // Nothing useful to do if teardown fails.
    }
  }
}

/** Every printer installed on the till PC. Empty array when QZ is unavailable. */
export async function listPrinters() {
  if (!(await connect())) return []
  try {
    const found = await qz.printers.find()
    return Array.isArray(found) ? found : [found]
  } catch {
    return []
  }
}

/** The machine's default printer name, or '' when it cannot be determined. */
export async function defaultPrinter() {
  if (!(await connect())) return ''
  try {
    return (await qz.printers.getDefault()) || ''
  } catch {
    return ''
  }
}

/**
 * Minimal stylesheet shipped with the raster render.
 *
 * QZ rasterises the HTML in isolation, so it cannot see the app's stylesheets —
 * anything the receipt needs has to travel with it.
 */
function receiptCss(widthMm, contentMm) {
  return `
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #000; background: #fff;
      width: ${widthMm}mm;
    }
    .receipt {
      width: ${contentMm}mm; padding: 0; margin: 0 auto;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 11px; line-height: 1.4;
    }
    .receipt.w58 { font-size: 10px; }
    .receipt.w75 { font-size: 10.5px; }
    .receipt-head { text-align: center; margin-bottom: 6px; }
    .receipt-logo { max-width: 40mm; max-height: 18mm; margin: 0 auto 4px; display: block; }
    .receipt-shop { font-size: 15px; font-weight: 700; }
    .receipt-meta { font-size: 10px; }
    .receipt hr { border: none; border-top: 1px dashed #000; margin: 5px 0; }
    .receipt-rows { width: 100%; border-collapse: collapse; }
    .receipt-rows td, .receipt-rows th { padding: 1px 0; border: none; font-size: inherit; text-align: left; }
    .receipt-rows th { font-size: 10px; border-bottom: 1px solid #000; font-weight: 700; }
    .receipt-rows .r { text-align: right; }
    .receipt-item-name { font-weight: 600; padding-top: 3px; }
    .receipt-disc { font-size: 10px; font-style: italic; }
    .receipt-total { display: flex; justify-content: space-between; padding: 1px 0; }
    .receipt-total.grand {
      font-size: 14px; font-weight: 700;
      border-top: 1px solid #000; border-bottom: 1px double #000;
      padding: 3px 0; margin: 3px 0;
    }
    .receipt-foot { text-align: center; margin-top: 7px; font-size: 10px; }
    .receipt-barcode { text-align: center; margin-top: 6px; }
    .receipt-barcode svg, .label-cell svg { max-width: 100%; height: auto; }
    /* An undrawn barcode is an empty <svg>, sized 300x150px by default: collapse it rather than print a blank gap. */
    .receipt-barcode svg:empty { display: none; }
    .label-sheet { display: grid; gap: 2mm; }
    .label-cell { text-align: center; padding: 1mm; page-break-inside: avoid; }
    .label-shop { font-size: 8px; font-weight: 700; text-transform: uppercase; }
    .label-name { font-size: 9px; }
    .label-price { font-size: 11px; font-weight: 700; }
  `
}

const PAPER_MM = { '58mm': 58, '75mm': 75, '80mm': 80, A4: 210 }
const PRINTABLE_MM = { '58mm': 48, '75mm': 64, '80mm': 72, A4: 190 }

/**
 * Prints whatever is currently mounted in #print-portal to a named printer,
 * with no dialog.
 *
 * Returns false if QZ Tray is not reachable or the print failed, so the caller
 * can fall back to window.print() instead of leaving the cashier with nothing.
 */
export async function printToNamedPrinter({ printerName, paperSize = '80mm', copies = 1, heightMm = null }) {
  if (!printerName) return false
  if (!(await connect())) return false

  const portal = document.getElementById('print-portal')
  if (!portal || !portal.innerHTML.trim()) return false

  const widthMm = PAPER_MM[paperSize] || 80
  const contentMm = PRINTABLE_MM[paperSize] || 72
  const html = `<html><head><meta charset="utf-8"><style>${receiptCss(widthMm, contentMm)}</style></head>`
    + `<body>${portal.innerHTML}</body></html>`

  try {
    const config = qz.configs.create(printerName, {
      units: 'mm',
      // An exact height stops the printer feeding a long blank tail after a
      // short bill; null falls back to letting the roll run on.
      size: paperSize === 'A4'
        ? { width: 210, height: 297 }
        : { width: widthMm, height: heightMm || null },
      margins: 0,
      copies: Math.max(1, Math.min(Number(copies) || 1, 5)),
      scaleContent: true,
      rasterize: true,
    })

    await qz.print(config, [{ type: 'pixel', format: 'html', flavor: 'plain', data: html }])
    return true
  } catch {
    return false
  }
}

/**
 * Opens the cash drawer wired to the receipt printer.
 *
 * Sends the standard ESC/POS kick pulse, which is what almost every drawer that
 * hangs off a thermal printer's RJ11 port responds to.
 */
export async function openCashDrawer(printerName) {
  if (!printerName || !(await connect())) return false
  try {
    const config = qz.configs.create(printerName)
    await qz.print(config, [{ type: 'raw', format: 'command', flavor: 'plain', data: '\x1B\x70\x00\x19\xFA' }])
    return true
  } catch {
    return false
  }
}
