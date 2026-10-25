/**
 * Sales report aggregation.
 *
 * Kept out of the page so the arithmetic can be tested directly — a report that
 * is quietly wrong is worse than one that fails loudly.
 *
 * Profit is an estimate: bills record what was charged, not what the goods cost
 * at the time, so the product's current cost is used. Changing a cost price
 * therefore changes historical profit figures.
 */

import { toDate, startOfDay } from './format'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export const isoDay = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/** Bills falling inside the period. `to` is inclusive of the whole day. */
export function filterByPeriod(sales, { from, to }) {
  const fromDate = from ? startOfDay(new Date(from)) : null
  const toBound = to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : null

  return sales.filter((s) => {
    const when = toDate(s.createdAt)
    if (!when) return false
    if (fromDate && when < fromDate) return false
    if (toBound && when > toBound) return false
    return true
  })
}

export function buildReport(sales, { from, to, costByProduct = {}, categoryByProduct = {}, returns = [] } = {}) {
  const scoped = filterByPeriod(sales, { from, to })
  const scopedReturns = filterByPeriod(returns, { from, to })

  const revenue = scoped.reduce((sum, s) => sum + (Number(s.total) || 0), 0)
  const discount = scoped.reduce((sum, s) => sum + (Number(s.totalDiscount) || 0), 0)
  const tax = scoped.reduce((sum, s) => sum + (Number(s.tax) || 0), 0)
  const bills = scoped.length

  const byProduct = {}
  const byDay = {}
  const byMethod = {}
  const byCategory = {}
  const byHour = Array(24).fill(0)
  let itemsSold = 0
  let cogs = 0

  scoped.forEach((sale) => {
    const when = toDate(sale.createdAt) || new Date()
    const day = isoDay(when)
    byDay[day] = (byDay[day] || 0) + (Number(sale.total) || 0)
    byHour[when.getHours()] += Number(sale.total) || 0

    const method = sale.paymentMethod || 'cash'
    byMethod[method] = (byMethod[method] || 0) + (Number(sale.total) || 0)

    ;(sale.items || []).forEach((item) => {
      const qty = Number(item.qty) || 0
      const net = Number(item.net) || 0
      const cost = (costByProduct[item.productId] || 0) * qty

      itemsSold += qty
      cogs += cost

      const category = categoryByProduct[item.productId] || 'Uncategorised'
      const entry = byProduct[item.productId] || {
        id: item.productId,
        name: item.name,
        barcode: item.barcode || '',
        category,
        qty: 0,
        revenue: 0,
        cost: 0,
        discount: 0,
        bills: 0,
      }
      entry.qty += qty
      entry.revenue += net
      entry.cost += cost
      entry.discount += Number(item.discount) || 0
      entry.bills += 1
      byProduct[item.productId] = entry

      const c = byCategory[category] || { name: category, qty: 0, revenue: 0 }
      c.qty += qty
      c.revenue += net
      byCategory[category] = c
    })
  })

  // Refunds are money that came back, and stock that came back with it. Leaving
  // them out overstates both revenue and units sold.
  const refunds = scopedReturns.reduce((sum, r) => sum + (Number(r.total) || 0), 0)
  let refundedUnits = 0

  scopedReturns.forEach((r) => {
    ;(r.items || []).forEach((line) => {
      const qty = Number(line.qty) || 0
      const net = Number(line.net) || 0
      refundedUnits += qty

      const entry = byProduct[line.productId]
      if (!entry) return
      entry.qty -= qty
      entry.revenue -= net
      entry.cost -= (costByProduct[line.productId] || 0) * qty
      entry.returned = (entry.returned || 0) + qty
    })
  })

  const netRevenue = round2(revenue - refunds)

  // Item figures are already net of returns, so share is against net revenue.
  const items = Object.values(byProduct).map((p) => ({
    ...p,
    revenue: round2(p.revenue),
    cost: round2(p.cost),
    profit: round2(p.revenue - p.cost),
    margin: p.revenue ? ((p.revenue - p.cost) / p.revenue) * 100 : 0,
    share: netRevenue ? (p.revenue / netRevenue) * 100 : 0,
  }))

  scopedReturns.forEach((r) => {
    const when = toDate(r.createdAt)
    if (!when) return
    const day = isoDay(when)
    if (day in byDay) byDay[day] = round2(byDay[day] - (Number(r.total) || 0))
  })

  const peakHour = Math.max(...byHour)

  return {
    scoped,
    returns: scopedReturns,
    refunds: round2(refunds),
    refundedUnits,
    // Revenue before refunds; netRevenue is what the shop actually kept.
    grossRevenue: revenue,
    revenue: netRevenue,
    discount,
    tax,
    bills,
    itemsSold: itemsSold - refundedUnits,
    cogs,
    // Tax is collected on behalf of the state, so it is not profit. Refunds are
    // already out of netRevenue, and the returned goods are back out of cogs.
    profit: round2(netRevenue - tax - cogs),
    margin: netRevenue ? ((netRevenue - tax - cogs) / netRevenue) * 100 : 0,
    average: bills ? round2(netRevenue / bills) : 0,
    days: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)),
    byMethod,
    categories: Object.values(byCategory).sort((a, b) => b.revenue - a.revenue),
    items,
    byHour,
    busiestHour: peakHour > 0 ? byHour.indexOf(peakHour) : null,
  }
}

/**
 * Expands day totals to one entry per calendar day in the period.
 *
 * `byDay` only contains days that had a sale, so plotting it directly puts a
 * quiet Tuesday right beside a busy Friday and the time axis silently lies —
 * gaps have to be drawn as zero, not skipped.
 */
export function fillDailySeries(days, { from, to } = {}) {
  if (!days.length && !(from && to)) return []

  const map = Object.fromEntries(days)
  const start = new Date(from || days[0][0])
  const end = new Date(to || days[days.length - 1][0])
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return days

  const out = []
  const cursor = new Date(start)
  // A guard rail: an absurd range should not lock the page up.
  for (let i = 0; cursor <= end && i < 1100; i += 1) {
    const key = isoDay(cursor)
    out.push([key, map[key] || 0])
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/**
 * Round a tick step up to 1 / 2 / 2.5 / 5 × a power of ten.
 *
 * 2.5 earns its place: without it a rough step of 2.4 jumps to 5, halving the
 * number of gridlines and leaving the axis coarse.
 */
export function niceStep(rough) {
  if (rough <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(rough))
  const norm = rough / power
  if (norm <= 1) return power
  if (norm <= 2) return 2 * power
  if (norm <= 2.5) return 2.5 * power
  if (norm <= 5) return 5 * power
  return 10 * power
}

/**
 * Axis ticks from 0 up to at least `max`, at clean intervals.
 *
 * The top tick must sit at or above the largest value — stopping below it puts
 * the highest point above the last gridline, where it reads as clipped.
 */
export function axisTicks(max, count = 4) {
  if (!max || max <= 0) return [0]
  const step = niceStep(max / count)
  const top = Math.ceil(max / step) * step

  const ticks = []
  for (let v = 0; v <= top + step * 1e-6; v += step) ticks.push(Number(v.toFixed(6)))
  return ticks
}

export const SORTS = {
  revenue: (a, b) => b.revenue - a.revenue,
  profit: (a, b) => b.profit - a.profit,
  qty: (a, b) => b.qty - a.qty,
  name: (a, b) => a.name.localeCompare(b.name),
  margin: (a, b) => b.margin - a.margin,
}
