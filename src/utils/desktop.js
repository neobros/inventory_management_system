/**
 * Desktop (Electron) integration.
 *
 * When the till runs as the packaged desktop app, `window.stockpilot` is
 * present and printing goes straight to a named printer with no dialog and no
 * extra software. On the web this module reports unavailable and the caller
 * falls back to QZ Tray, then to the browser.
 */

const bridge = () => (typeof window !== 'undefined' ? window.stockpilot : undefined)

/** True inside the packaged desktop till. */
export const isDesktop = () => Boolean(bridge()?.isElectron)

/** This build's version number, or '' on the web. */
export async function appVersion() {
  const api = bridge()
  if (!api) return ''
  try {
    const info = await api.info()
    return info?.version || ''
  } catch {
    return ''
  }
}

/** Downloads and runs the new installer. The app quits if it starts. */
export async function installUpdate({ url, version }, onProgress) {
  const api = bridge()
  if (!api) return { started: false, error: 'Updates only apply to the desktop app.' }

  const stop = onProgress ? api.onUpdateProgress(onProgress) : null
  try {
    return await api.installUpdate({ url, version })
  } finally {
    if (stop) stop()
  }
}

export async function openUpdateLink(url) {
  const api = bridge()
  if (!api) return window.open(url, '_blank')
  return api.openUpdateLink({ url })
}

/**
 * Wraps the label sheet in a standalone A4 document.
 *
 * The hidden PDF window has none of the app's stylesheets, so the label styles
 * travel with it. Sizes are in millimetres so the sheet matches real paper and
 * the barcodes keep the exact bar widths scanners expect.
 */
function buildLabelDocument(innerHtml, columns) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: 'Segoe UI', Arial, sans-serif; }
    .label-sheet {
      display: grid !important;
      grid-template-columns: repeat(${columns}, 1fr) !important;
      gap: 2mm !important;
      padding: 8mm 6mm;
    }
    .label-cell {
      text-align: center; padding: 1mm;
      break-inside: avoid; page-break-inside: avoid;
    }
    /* Natural width, never stretched: width:100% overrode the bar width and made every barcode span the whole label. */
    .label-cell svg { width: auto; max-width: 100%; height: auto; display: block; margin: 0 auto; }
    .label-shop { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .label-name {
      font-size: 9px; margin: 1px 0; font-weight: 500;
      overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    }
    .label-price { font-size: 11px; font-weight: 700; margin-top: 1px; }
  </style></head><body>${innerHtml}</body></html>`
}

/**
 * Saves the label sheet currently in #print-portal as an A4 PDF in Downloads.
 * Returns { ok, path } or { ok: false, error }.
 */
export async function saveLabelsPdf({ columns = 4, fileName = 'barcode-labels' } = {}) {
  const api = bridge()
  if (!api) return { ok: false, error: 'Saving a PDF is only available in the desktop app.' }

  const portal = document.getElementById('print-portal')
  if (!portal || !portal.innerHTML.trim()) {
    return { ok: false, error: 'The label sheet had not rendered yet.' }
  }

  try {
    return await api.savePdf({ html: buildLabelDocument(portal.innerHTML, columns), fileName })
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not save the PDF.' }
  }
}

/** Opens Explorer with a saved file selected. */
export async function revealFile(filePath) {
  const api = bridge()
  if (api) await api.revealFile(filePath)
}

/** Printers installed on this machine. Empty array on the web. */
export async function listPrinters() {
  const api = bridge()
  if (!api) return []
  try {
    return await api.listPrinters()
  } catch {
    return []
  }
}

/**
 * Wraps the receipt markup in a standalone document.
 *
 * The offscreen print window has none of the app's stylesheets, so everything
 * the bill needs travels with it.
 */
function buildDocument(innerHtml, widthMm, contentMm) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${widthMm}mm auto; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { width: ${widthMm}mm; font-family: 'Segoe UI', Arial, sans-serif; }
    /* Centred at the printable width — the head cannot reach the paper edges. */
    .receipt {
      width: ${contentMm}mm; margin: 0 auto; padding: 0;
      font-family: Consolas, 'Courier New', monospace;
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
    .receipt-foot { text-align: center; margin: 7px 0 0; font-size: 10px; }
    .receipt-barcode { text-align: center; margin-top: 6px; }
    .receipt-barcode svg, .label-cell svg { max-width: 100%; height: auto; }
    /* An undrawn barcode is an empty <svg>, sized 300x150px by default: collapse it rather than print a blank gap. */
    .receipt-barcode svg:empty { display: none; }
    .label-sheet { display: grid; gap: 2mm; }
    .label-cell { text-align: center; padding: 1mm; page-break-inside: avoid; }
    .label-shop { font-size: 8px; font-weight: 700; text-transform: uppercase; }
    .label-name { font-size: 9px; }
    .label-price { font-size: 11px; font-weight: 700; }
  </style></head><body>${innerHtml}</body></html>`
}

/**
 * Prints whatever is mounted in #print-portal to `printerName`, silently.
 *
 * Returns { ok, reason } rather than a bare boolean — a silent failure with no
 * explanation is the hardest kind of printing bug to chase.
 */
export async function printViaDesktop({ printerName, widthMm = 80, contentMm = 72, heightMm = null, copies = 1 }) {
  const api = bridge()
  if (!api) return { ok: false, reason: 'Not running in the desktop app.' }

  const portal = document.getElementById('print-portal')
  if (!portal || !portal.innerHTML.trim()) {
    return { ok: false, reason: 'The receipt had not rendered yet.' }
  }

  try {
    const result = await api.print({
      html: buildDocument(portal.innerHTML, widthMm, contentMm),
      // TEMPORARY: which screen the print came from, for the print log.
      source: (location.hash || location.pathname || '').replace(/^#/, ''),
      printerName: printerName || undefined,
      widthMm,
      heightMm,
      copies,
    })
    return {
      ok: Boolean(result?.success),
      reason: result?.failureReason || (result?.success ? '' : 'The printer rejected the job.'),
      note: result?.note || '',
    }
  } catch (err) {
    return { ok: false, reason: err?.message || 'The print request failed.' }
  }
}
