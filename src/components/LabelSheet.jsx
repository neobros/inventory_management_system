import { createPortal } from 'react-dom'
import Barcode from './Barcode'
import { money } from '../utils/format'

/**
 * Label presets for an A4 sheet.
 *
 * `columns` drives the grid, so the name states the same number — they used to
 * disagree ("4 across" printed 5). Widths are the A4 printable width split
 * across the columns.
 *
 * `barWidth` is the width of one barcode module in px (~0.26mm each). It stays
 * at 0.9 or above: thinner bars start failing on inexpensive scanners, and a
 * label that will not scan is worse than a slightly larger one.
 */
export const LABEL_SIZES = {
  mini: {
    label: 'Mini — 6 across (31mm wide)', columns: 6,
    barHeight: 18, barWidth: 0.9, font: 7, text: { shop: 6, name: 7, price: 8 },
  },
  small: {
    label: 'Small — 5 across (38mm wide)', columns: 5,
    barHeight: 22, barWidth: 1.0, font: 8, text: { shop: 7, name: 8, price: 9 },
  },
  medium: {
    label: 'Medium — 4 across (48mm wide)', columns: 4,
    barHeight: 28, barWidth: 1.2, font: 9, text: { shop: 8, name: 9, price: 11 },
  },
  large: {
    label: 'Large — 3 across (65mm wide)', columns: 3,
    barHeight: 38, barWidth: 1.5, font: 10, text: { shop: 9, name: 10, price: 12 },
  },
}

/**
 * Barcode width steps, as the width of one bar module in px (1px ≈ 0.265mm).
 *
 * Narrower means thinner bars, and thinner bars are harder to scan. The floor is
 * scanner-specific, which is why this is a setting the shop tests on its own
 * scanner rather than a number picked here. `risk` flags steps worth testing
 * before printing a full sheet.
 */
export const BAR_WIDTHS = [
  // 0 means "use the width the label size was designed with".
  { value: 0, label: 'Auto (matches label size)', risk: 'none' },
  { value: 0.6, label: 'Extra narrow', risk: 'high' },
  { value: 0.7, label: 'Very narrow', risk: 'medium' },
  { value: 0.8, label: 'Narrow', risk: 'low' },
  { value: 0.9, label: 'Slightly narrow', risk: 'none' },
  { value: 1.0, label: 'Standard', risk: 'none' },
  { value: 1.2, label: 'Wide', risk: 'none' },
]

/** Thickness of one bar on paper, in mm. */
export const barMm = (px) => (px * 25.4) / 96

export function LabelCell({
  product, shop, currency, size, showName = true, showPrice = true, showShop = true, barWidth,
}) {
  const s = LABEL_SIZES[size] || LABEL_SIZES.small
  return (
    <div className="label-cell">
      {showShop && shop?.name && (
        <div className="label-shop" style={{ fontSize: s.text.shop }}>{shop.name}</div>
      )}
      {showName && <div className="label-name" style={{ fontSize: s.text.name }}>{product.name}</div>}
      <Barcode
        value={product.barcode}
        height={s.barHeight}
        width={barWidth || s.barWidth}
        fontSize={s.font}
        margin={2}
      />
      {showPrice && (
        <div className="label-price" style={{ fontSize: s.text.price }}>{money(product.price, currency)}</div>
      )}
    </div>
  )
}

/**
 * Expands each {product, copies} pair into individual labels and mounts the
 * sheet in the print portal.
 */
export default function LabelSheetPortal({ items, shop, currency, size = 'small', options = {} }) {
  const host = document.getElementById('print-portal')
  if (!host || !items?.length) return null

  const cells = items.flatMap(({ product, copies }) =>
    Array.from({ length: Math.max(1, Number(copies) || 1) }, (_, i) => ({ product, key: `${product.id}-${i}` }))
  )
  const columns = (LABEL_SIZES[size] || LABEL_SIZES.small).columns

  return createPortal(
    <div className="label-sheet" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '2mm' }}>
      {cells.map(({ product, key }) => (
        <LabelCell key={key} product={product} shop={shop} currency={currency} size={size} {...options} />
      ))}
    </div>,
    host
  )
}
