/**
 * Profit % (markup on cost) used to fill the selling price on the product form.
 *
 *   selling = cost + cost x markup%      e.g. 800 + 25% = 1000
 */

export const DEFAULT_MARKUP = 25

/**
 * The shop's markup %, or '' when the shop has switched it off.
 * A shop that has never saved the setting gets the 25 % default.
 */
export function shopMarkup(shop) {
  const v = shop?.markupPercent
  if (v === undefined) return DEFAULT_MARKUP
  if (v === null || v === '') return ''
  return Number(v)
}

const money2 = (n) => Math.round(n * 100) / 100

/** Selling price from cost and markup %, or null when either is missing. */
export function priceFromMarkup(cost, markup) {
  const c = Number(cost)
  if (cost === '' || markup === '' || markup === null || !Number.isFinite(c) || c <= 0) return null
  const m = Number(markup)
  if (!Number.isFinite(m)) return null
  return money2(c * (1 + m / 100))
}

/** Markup % that a cost and selling price give, or '' when it cannot be worked out. */
export function markupFromPrice(cost, price) {
  const c = Number(cost)
  const p = Number(price)
  if (cost === '' || price === '' || !(c > 0) || !Number.isFinite(p)) return ''
  return money2((p / c - 1) * 100)
}
