/**
 * Cost batches — first in, first out.
 *
 * Every delivery is kept as its own batch with the cost paid for it:
 *
 *   batches: [{ qty: 5, cost: 20, at: 1731300000000 }, { qty: 10, cost: 25, at: ... }]
 *
 * Sales take from the oldest batch first, so the 5 bought at 20 are sold (and
 * costed) before any of the 10 bought at 25. Each sale line stores the cost it
 * actually used, which keeps old reports fixed when costs change later.
 *
 * The product's `cost` field always holds the cost of the batch that sells
 * next, and `lastCost` the most recent purchase cost.
 *
 * Products saved before batches existed have no `batches` field; their whole
 * stock is treated as one batch at the product's cost.
 */

import { roundQty } from './units.js'

const money4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000

/** The product's most recent purchase cost. */
export function lastCostOf(product) {
  const last = Number(product?.lastCost)
  if (Number.isFinite(last) && product?.lastCost !== undefined && product?.lastCost !== null) return last
  return Number(product?.cost) || 0
}

/**
 * Batches that add up to the product's stock.
 *
 * The stock figure can move without the batches (an older till that does not
 * know about batches, an import), so the two are reconciled here: missing stock
 * is added as a batch at the last cost, extra batches are taken off the oldest.
 */
export function batchesOf(product) {
  const stock = Math.max(0, roundQty(product?.stock))
  const list = Array.isArray(product?.batches)
    ? product.batches
      .map((b) => ({ qty: roundQty(b.qty), cost: Number(b.cost) || 0, at: b.at || null }))
      .filter((b) => b.qty > 0)
    : []

  if (!Array.isArray(product?.batches)) {
    return stock > 0 ? [{ qty: stock, cost: Number(product?.cost) || 0, at: null }] : []
  }

  const held = roundQty(list.reduce((sum, b) => sum + b.qty, 0))
  if (held < stock) return [...list, { qty: roundQty(stock - held), cost: lastCostOf(product), at: null }]
  if (held > stock) return take(list, roundQty(held - stock), lastCostOf(product)).batches
  return list
}

/**
 * Takes `qty` off the oldest batches first.
 * Returns what is left, the total cost of what was taken, and the unit cost.
 * Selling more than is held costs the extra at `fallbackCost`.
 */
export function take(batches, qty, fallbackCost = 0) {
  let need = roundQty(qty)
  let total = 0
  const left = []

  batches.forEach((b) => {
    if (need <= 0) { left.push({ ...b }); return }
    const used = Math.min(b.qty, need)
    total += used * b.cost
    need = roundQty(need - used)
    const rest = roundQty(b.qty - used)
    if (rest > 0) left.push({ ...b, qty: rest })
  })

  if (need > 0) total += need * (Number(fallbackCost) || 0)

  const q = roundQty(qty)
  return {
    batches: left,
    totalCost: money4(total),
    unitCost: q > 0 ? money4(total / q) : 0,
  }
}

/**
 * Adds a batch. A new delivery goes to the back of the queue; goods coming
 * back from a customer go to the front, so they sell first.
 */
export function addBatch(batches, qty, cost, { front = false } = {}) {
  const q = roundQty(qty)
  if (q <= 0) return batches.map((b) => ({ ...b }))
  const batch = { qty: q, cost: Number(cost) || 0, at: Date.now() }
  return front ? [batch, ...batches] : [...batches, batch]
}

/** Cost of the batch that sells next — what the product's `cost` field shows. */
export function headCost(batches, fallback = 0) {
  return batches.length ? batches[0].cost : (Number(fallback) || 0)
}

/** Value of the stock on hand at what it cost. */
export function stockValue(product) {
  return Math.round(batchesOf(product).reduce((sum, b) => sum + b.qty * b.cost, 0) * 100) / 100
}

/**
 * The product fields to save after the batches change: the batches, the stock
 * they add up to, and the next-to-sell cost.
 */
export function batchFields(batches, lastCost) {
  return {
    batches: batches.map((b) => ({ qty: roundQty(b.qty), cost: money4(b.cost), at: b.at || null })),
    cost: money4(headCost(batches, lastCost)),
  }
}
