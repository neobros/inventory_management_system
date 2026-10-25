/**
 * Bill maths, shared by the POS screen and the printed receipt so the numbers
 * on paper can never drift from the numbers on screen.
 *
 * Order of operations: line discounts first, then a bill-wide discount on what
 * remains, then tax on the discounted figure.
 */

const round = (n) => Math.round((Number(n) || 0) * 100) / 100

export function lineGross(item) {
  return round((Number(item.price) || 0) * (Number(item.qty) || 0))
}

export function lineDiscount(item) {
  const gross = lineGross(item)
  const value = Number(item.discountValue) || 0
  if (value <= 0) return 0
  const amount = item.discountType === 'percent' ? (gross * value) / 100 : value
  return round(Math.min(Math.max(amount, 0), gross))
}

export function lineNet(item) {
  return round(lineGross(item) - lineDiscount(item))
}

export function calcTotals(items, { billDiscountType = 'amount', billDiscountValue = 0, taxRate = 0 } = {}) {
  const subtotal = round(items.reduce((sum, i) => sum + lineGross(i), 0))
  const itemDiscount = round(items.reduce((sum, i) => sum + lineDiscount(i), 0))
  const afterItems = round(subtotal - itemDiscount)

  const rawBill = Number(billDiscountValue) || 0
  let billDiscount = 0
  if (rawBill > 0) {
    billDiscount = billDiscountType === 'percent' ? (afterItems * rawBill) / 100 : rawBill
    billDiscount = round(Math.min(Math.max(billDiscount, 0), afterItems))
  }

  const taxable = round(afterItems - billDiscount)
  const tax = round((taxable * (Number(taxRate) || 0)) / 100)
  const total = round(taxable + tax)

  return {
    subtotal,
    itemDiscount,
    billDiscount,
    totalDiscount: round(itemDiscount + billDiscount),
    taxable,
    tax,
    total,
    itemCount: items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0),
  }
}
