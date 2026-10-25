/**
 * Printing helpers.
 *
 * Everything printable is rendered into #print-portal and the rest of the app
 * is hidden by the print stylesheet. The @page rule is injected here because it
 * has to change per shop (58mm / 75mm / 80mm / A4) and @page cannot read a CSS
 * variable or be scoped to a class.
 */

import { isDesktop, printViaDesktop } from './desktop'

export const PAPER_MM = { '58mm': 58, '75mm': 75, '80mm': 80, A4: 210 }

/**
 * Printable width, which is narrower than the paper: a thermal head cannot
 * reach the edges of the roll. An 80mm roll prints 72mm (576 dots at 203dpi),
 * a 58mm roll prints 48mm. Laying content out at the full paper width makes the
 * driver shunt it sideways instead of centring it.
 */
// 75mm: 64mm keeps ~5.5mm clear each side. Rolls of this width are common on
// impact printers too, whose head reaches less far than a thermal one, so it
// errs narrow — a clipped right edge is worse than a wider margin.
export const PRINTABLE_MM = { '58mm': 48, '75mm': 64, '80mm': 72, A4: 190 }

const RULE_ID = 'sp-print-page-rule'

/** CSS pixels are defined as 1/96 inch, which makes this exact rather than a guess. */
const pxToMm = (px) => (px / 96) * 25.4

/**
 * Measures how tall the rendered receipt actually is, in millimetres.
 *
 * `@page { size: 80mm auto }` is meant to shrink the page to its content, but
 * browsers largely ignore the `auto` and fall back to a full sheet — which is
 * why a short bill fed out a long blank tail. Measuring lets us name an exact
 * page height instead.
 *
 * The portal is hidden on screen, so it is briefly laid out off-canvas at the
 * true paper width to be measured, then put back exactly as it was.
 */
export function measureContentMm(paperSize = '80mm') {
  const el = document.getElementById('print-portal')
  if (!el) return null

  const widthMm = PRINTABLE_MM[paperSize] || 72
  const prevStyle = el.getAttribute('style')
  const receipt = el.querySelector('.receipt')
  const prevReceipt = receipt ? receipt.getAttribute('style') : null

  el.style.cssText =
    `display:block !important;position:fixed;left:-10000px;top:0;` +
    `width:${widthMm}mm;visibility:hidden;pointer-events:none;`
  // On screen .receipt has a fixed px width; fill the paper instead.
  if (receipt) receipt.style.width = '100%'

  const px = el.scrollHeight

  if (receipt) {
    if (prevReceipt === null) receipt.removeAttribute('style')
    else receipt.setAttribute('style', prevReceipt)
  }
  if (prevStyle === null) el.removeAttribute('style')
  else el.setAttribute('style', prevStyle)

  if (!px) return null
  // A couple of mm of slack so the last line is never clipped.
  return Math.ceil(pxToMm(px)) + 2
}

/** Page size for the roll: exact height when measurable, `auto` as a fallback. */
function pageSizeFor(paperSize) {
  if (paperSize === 'A4' || paperSize === 'a4') return 'A4 portrait'
  const widthMm = PAPER_MM[paperSize] || 80
  const heightMm = measureContentMm(paperSize)
  return heightMm ? `${widthMm}mm ${heightMm}mm` : `${widthMm}mm auto`
}

function applyPageRule(paperSize, extra = '') {
  document.getElementById(RULE_ID)?.remove()
  const style = document.createElement('style')
  style.id = RULE_ID
  // html/body must not add their own height or the page grows again.
  const contentMm = PRINTABLE_MM[paperSize] || 72
  style.textContent =
    `@page { size: ${pageSizeFor(paperSize)}; margin: 0; }`
    + ` @media print {`
    + `   html, body { height: auto !important; margin: 0 !important; padding: 0 !important; }`
    + `   .receipt { width: ${contentMm}mm !important; margin: 0 auto !important; padding: 0 !important; }`
    + ` }`
    + ` ${extra}`
  document.head.appendChild(style)
}

function cleanup() {
  document.body.classList.remove('printing')
  document.getElementById(RULE_ID)?.remove()
}

/**
 * Sends whatever is currently mounted in the print portal to the printer.
 * Resolves once the print dialog has been dismissed.
 */
export function printPortal(paperSize = '80mm', extraCss = '') {
  return new Promise((resolve) => {
    applyPageRule(paperSize, extraCss)
    document.body.classList.add('printing')

    const done = () => {
      window.removeEventListener('afterprint', done)
      cleanup()
      resolve()
    }
    window.addEventListener('afterprint', done)

    // Browsers block on window.print(); the frame lets the DOM paint first.
    requestAnimationFrame(() => {
      window.print()
      // Safari never fires afterprint reliably — belt-and-braces cleanup.
      setTimeout(done, 1200)
    })
  })
}

/**
 * Prints the receipt `copies` times — for shops that keep a merchant copy.
 *
 * The jobs run one after another rather than together: a second window.print()
 * fired while the first is still open is silently dropped by Chrome.
 */
export async function printReceipt(paperSize = '80mm', copies = 1) {
  const runs = Math.max(1, Math.min(Number(copies) || 1, 5))
  for (let i = 0; i < runs; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential is the point
    await printPortal(paperSize)
  }
}

/**
 * Waits until the print portal actually holds a rendered receipt.
 *
 * Printing is triggered right after React is told to render the receipt, and
 * the DOM may not have caught up yet. Polling animation frames is reliable
 * where a fixed timeout is a guess — and guessing wrong prints blank paper.
 */
export function portalReady(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const start = Date.now()
    const check = () => {
      const el = document.getElementById('print-portal')
      if (el && el.innerHTML.trim().length > 0) return resolve(true)
      if (Date.now() - start > timeoutMs) return resolve(false)
      return requestAnimationFrame(check)
    }
    check()
  })
}

/**
 * Prints a bill the best way this machine allows.
 *
 * 1. Desktop till (Electron): native silent print to the named printer.
 * 2. Web + QZ Tray installed: silent print to the named printer.
 * 3. Plain browser: the usual dialog, or silent under --kiosk-printing.
 *
 * Returns 'direct', 'browser', or 'empty' when there was nothing to print, so
 * the caller can warn instead of quietly feeding out a blank receipt.
 * Never throws — a failed silent print still ends up on paper.
 */
let lastPrintError = ''

/** Why the last silent print attempt failed, for the UI to surface. */
export function getLastPrintError() {
  return lastPrintError
}

export async function printBill(shop) {
  const paperSize = shop?.paperSize || '80mm'
  const copies = shop?.printCopies || 1

  // Let React commit whatever was rendered just before this call. Without it,
  // a page that swaps one bill for the next and prints straight away gets the
  // PREVIOUS bill measured — the portal is not empty, so portalReady passes at
  // once. A long previous bill then gave the new one a page ~144mm too tall.
  await nextFrame()

  // Refuse to spend paper on an empty job.
  if (!(await portalReady())) return 'empty'

  // The shop logo changes the bill's height; measure after it has loaded, or a
  // fresh logo makes the page too short and clips the bottom of the bill.
  await imagesReady()

  // Never capture a receipt whose barcode has not been drawn yet.
  await barcodesReady()

  const heightMm = measureContentMm(paperSize)
  const widthMm = PAPER_MM[paperSize] || 80
  const contentMm = PRINTABLE_MM[paperSize] || 72

  // 1. Desktop till: native silent print, nothing to install.
  if (isDesktop()) {
    try {
      const res = await printViaDesktop({ printerName: shop?.printerName, widthMm, contentMm, heightMm, copies })
      if (res.ok) {
        lastPrintError = ''
        return 'direct'
      }
      lastPrintError = res.reason || ''
    } catch (err) {
      lastPrintError = err?.message || ''
      // Fall through to the browser path below.
    }
  }

  // 2. Web + QZ Tray: silent print to a named printer.
  if (shop?.printerName) {
    try {
      // Loaded on demand so the QZ client stays out of the initial bundle.
      // Height is passed in: qz.js importing print.js would be a cycle.
      const { printToNamedPrinter } = await import('./qz')
      if (await printToNamedPrinter({ printerName: shop.printerName, paperSize, copies, heightMm })) {
        return 'direct'
      }
    } catch {
      // QZ missing or blocked — the browser path below still prints.
    }
  }

  // 3. Plain browser.
  await printReceipt(paperSize, copies)
  return 'browser'
}

/**
 * Resolves once every image in the print portal has loaded (or failed), so the
 * measured height includes the logo. Gives up after `timeoutMs` rather than
 * hold up a sale on an image that never arrives.
 */
export function imagesReady(timeoutMs = 2000) {
  const el = document.getElementById('print-portal')
  const pending = el ? Array.from(el.querySelectorAll('img')).filter((img) => !img.complete) : []
  if (!pending.length) return Promise.resolve()

  return new Promise((resolve) => {
    let left = pending.length
    const settle = () => {
      left -= 1
      if (left <= 0) resolve()
    }
    pending.forEach((img) => {
      img.addEventListener('load', settle, { once: true })
      img.addEventListener('error', settle, { once: true })
    })
    setTimeout(resolve, timeoutMs)
  })
}

/**
 * Resolves once every barcode in the print portal has its bars drawn.
 *
 * Barcode draws itself during React's commit now, so this normally returns at
 * once — it is the second line of defence. An undrawn barcode is an empty <svg>
 * sized 300×150px by default, which printed as a blank gap with no barcode.
 */
export function barcodesReady(timeoutMs = 1500) {
  const undrawn = () => {
    const el = document.getElementById('print-portal')
    if (!el) return 0
    return Array.from(el.querySelectorAll('.receipt-barcode svg, .label-cell svg'))
      .filter((svg) => svg.childElementCount === 0).length
  }
  if (undrawn() === 0) return Promise.resolve(true)

  return new Promise((resolve) => {
    const start = Date.now()
    const check = () => {
      if (undrawn() === 0) return resolve(true)
      if (Date.now() - start > timeoutMs) return resolve(false)
      return requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  })
}

/** Waits for React to commit pending portal content before reading the DOM. */
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

/**
 * Label sheets print on A4 with a column count matched to the label width.
 * Returns false when there was nothing rendered to print.
 */
export async function printLabels(columns) {
  await nextFrame()
  if (!(await portalReady())) return false
  await printPortal('A4', `.label-sheet { grid-template-columns: repeat(${columns}, 1fr) !important; }`)
  return true
}
