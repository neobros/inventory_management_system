import { useLayoutEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

/**
 * Renders a CODE128 barcode as inline SVG.
 *
 * SVG rather than canvas so the bars stay crisp at printer DPI — a canvas
 * barcode rasterised at screen resolution is a common cause of labels that
 * scanners refuse to read.
 */
export default function Barcode({
  value,
  height = 44,
  width = 1.6,
  fontSize = 12,
  displayValue = true,
  margin = 4,
  className = '',
}) {
  const ref = useRef(null)

  // useLayoutEffect, not useEffect. A regular effect draws the bars some time
  // after the element is in the page, and a receipt captured for printing in
  // that gap carries an empty <svg> — which browsers size at a default 300×150px.
  // On the busy billing screen that produced a bill with no barcode and ~40mm of
  // blank paper where it should have been. A layout effect draws during the same
  // commit, so the bars exist the moment the receipt does.
  useLayoutEffect(() => {
    if (!ref.current || !value) return
    try {
      JsBarcode(ref.current, String(value), {
        format: 'CODE128',
        height,
        width,
        fontSize,
        displayValue,
        margin,
        textMargin: 1,
        lineColor: '#000000',
        background: 'transparent',
      })
    } catch {
      // An unencodable value should not take the whole page down.
      ref.current.innerHTML = ''
    }
  }, [value, height, width, fontSize, displayValue, margin])

  if (!value) return <span className="text-muted text-sm">No barcode</span>
  return <svg ref={ref} className={className} />
}
