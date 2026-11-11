/**
 * Units that are sold by measure rather than by the piece.
 *
 * Stock and price always stay in the product's own unit (a "kg" product holds
 * stock in kg and is priced per kg). At the till the cashier may type the
 * amount in a smaller or larger unit — 200 g of a kg product — and it is
 * converted to the product's unit before it touches the bill or the stock.
 */

/** factor = how many of the product's unit one `entry` unit is. */
const ENTRY_UNITS = {
  kg: [{ unit: 'g', factor: 0.001 }, { unit: 'kg', factor: 1 }],
  g: [{ unit: 'g', factor: 1 }, { unit: 'kg', factor: 1000 }],
  litre: [{ unit: 'ml', factor: 0.001 }, { unit: 'litre', factor: 1 }],
  ml: [{ unit: 'ml', factor: 1 }, { unit: 'litre', factor: 1000 }],
  meter: [{ unit: 'cm', factor: 0.01 }, { unit: 'meter', factor: 1 }],
  // Older products were saved as "metre"; they keep working as meter.
  metre: [{ unit: 'cm', factor: 0.01 }, { unit: 'metre', factor: 1 }],
  feet: [{ unit: 'inch', factor: 1 / 12 }, { unit: 'feet', factor: 1 }],
  yard: [{ unit: 'feet', factor: 1 / 3 }, { unit: 'yard', factor: 1 }],
}

/** One-tap amounts on the weigh screen, in the first entry unit. */
const QUICK = {
  kg: [100, 250, 500, 1000, 2000],
  g: [50, 100, 250, 500, 1000],
  litre: [250, 500, 1000, 2000],
  ml: [100, 250, 500, 1000],
  meter: [50, 100, 200, 500],
  metre: [50, 100, 200, 500],
  feet: [6, 12, 24, 36],
  yard: [1, 3, 6, 9],
}

/** Old spelling saved on earlier products; shown and re-saved as "meter". */
export function normaliseUnit(unit) {
  const u = String(unit || '').trim().toLowerCase()
  return u === 'metre' ? 'meter' : u
}

export function isMeasured(unit) {
  return Boolean(ENTRY_UNITS[unit])
}

/** Units the cashier can type the amount in, first one is the default. */
export function entryUnits(unit) {
  return ENTRY_UNITS[unit] || [{ unit: unit || 'pcs', factor: 1 }]
}

export function quickAmounts(unit) {
  return QUICK[unit] || []
}

/** Three decimals is a gram of a kg — fine enough, and kills float noise (0.30000000004). */
export function roundQty(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000
}

/** Converts an amount typed in `entryUnit` to the product's own unit. */
export function toProductUnit(amount, entryUnit, productUnit) {
  const opt = entryUnits(productUnit).find((o) => o.unit === entryUnit)
  return roundQty((Number(amount) || 0) * (opt ? opt.factor : 1))
}

/**
 * Human-friendly quantity: 0.2 kg reads as "200 g", 1500 g as "1.5 kg",
 * 3 pcs as "3 pcs".
 */
export function formatQty(qty, unit = 'pcs') {
  const q = roundQty(qty)
  const trim = (n) => String(roundQty(n))
  if (unit === 'kg' && q > 0 && q < 1) return `${trim(q * 1000)} g`
  if (unit === 'g' && q >= 1000) return `${trim(q / 1000)} kg`
  if (unit === 'litre' && q > 0 && q < 1) return `${trim(q * 1000)} ml`
  if (unit === 'ml' && q >= 1000) return `${trim(q / 1000)} litre`
  if ((unit === 'meter' || unit === 'metre') && q > 0 && q < 1) return `${trim(q * 100)} cm`
  if (unit === 'metre') return `${trim(q)} meter`
  // Inches and feet don't divide evenly (1 inch = 0.083 feet), so these show
  // two decimals — 0.333 yard reads as "1 feet", not "0.999 feet".
  const two = (n) => String(Math.round(n * 100) / 100)
  if (unit === 'feet' && q > 0 && q < 1) return `${two(q * 12)} inch`
  if (unit === 'yard' && q > 0 && q < 1) return `${two(q * 3)} feet`
  return `${trim(q)} ${unit}`
}

/** "per kg" for measured goods, "each" for pieces. */
export function perUnit(unit) {
  return isMeasured(unit) ? `/ ${unit}` : 'each'
}

/**
 * True when a unit price is a whole number of cents. A line sold for a typed
 * amount (160 for 3 pcs) can have a unit price like 53.333333 — printing
 * "3 × 53.33" next to 160.00 would look like a mistake, so the bill shows just
 * the quantity and the line total instead.
 */
export function cleanPrice(price) {
  const cents = (Number(price) || 0) * 100
  return Math.abs(cents - Math.round(cents)) < 1e-6
}
