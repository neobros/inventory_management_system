import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { listSales } from '../services/sales'
import { listProducts } from '../services/products'
import { listReturns } from '../services/returns'
import { money, num, formatDate } from '../utils/format'
import { buildReport, isoDay, SORTS, fillDailySeries } from '../utils/report'
import { Empty, Loading, Stat } from '../components/ui'
import Pagination, { usePagination } from '../components/Pagination'
import RevenueChart from '../components/RevenueChart'

const PRESETS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7', label: 'Last 7 days', days: 6 },
  { key: '30', label: 'Last 30 days', days: 29 },
  { key: '90', label: 'Last 90 days', days: 89 },
  { key: 'month', label: 'This month', days: null },
  { key: 'all', label: 'All time', days: null },
]

const iso = isoDay

/** Start and end dates for a preset, as yyyy-mm-dd strings. */
function presetRange(key) {
  const today = new Date()
  if (key === 'all') return { from: '', to: '' }
  if (key === 'month') {
    return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) }
  }
  const cfg = PRESETS.find((p) => p.key === key)
  const from = new Date(today)
  from.setDate(from.getDate() - (cfg?.days ?? 0))
  return { from: iso(from), to: iso(today) }
}

export default function Reports() {
  const { shopId, currency } = useAuth()
  const toast = useToast()

  const [sales, setSales] = useState([])
  const [products, setProducts] = useState([])
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)

  const [preset, setPreset] = useState('30')
  const [from, setFrom] = useState(() => presetRange('30').from)
  const [to, setTo] = useState(() => presetRange('30').to)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('revenue')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, p, r] = await Promise.all([
        listSales(shopId, { max: 2000 }),
        listProducts(shopId),
        listReturns(shopId, { max: 1000 }).catch(() => []),
      ])
      setSales(s)
      setProducts(p)
      setReturns(r)
    } catch {
      toast.error('Could not load report data.')
    } finally {
      setLoading(false)
    }
  }, [shopId, toast])

  useEffect(() => { load() }, [load])

  const applyPreset = (key) => {
    setPreset(key)
    const r = presetRange(key)
    setFrom(r.from)
    setTo(r.to)
  }

  /** Current cost per product — used to estimate profit. */
  const costByProduct = useMemo(() => {
    const map = {}
    products.forEach((p) => { map[p.id] = Number(p.cost) || 0 })
    return map
  }, [products])

  const categoryByProduct = useMemo(() => {
    const map = {}
    products.forEach((p) => { map[p.id] = p.category || 'Uncategorised' })
    return map
  }, [products])

  const report = useMemo(
    () => buildReport(sales, { from, to, costByProduct, categoryByProduct, returns }),
    [sales, from, to, costByProduct, categoryByProduct, returns]
  )

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? report.items.filter((i) =>
        i.name.toLowerCase().includes(q)
        || i.barcode.includes(q)
        || i.category.toLowerCase().includes(q))
      : report.items
    return [...list].sort(SORTS[sortKey] || SORTS.revenue)
  }, [report.items, search, sortKey])

  /** Per-item figures as a spreadsheet, for accounting or stock-taking. */
  const exportCsv = () => {
    if (!visibleItems.length) return toast.error('Nothing to export for this period.')

    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`
    const rows = [
      ['Product', 'Barcode', 'Category', 'Qty sold', 'Revenue', 'Cost', 'Profit', 'Margin %', 'Discount given', '% of revenue'],
      ...visibleItems.map((i) => [
        i.name, i.barcode, i.category, i.qty,
        i.revenue.toFixed(2), i.cost.toFixed(2), i.profit.toFixed(2),
        i.margin.toFixed(1), i.discount.toFixed(2), i.share.toFixed(1),
      ]),
      [],
      ['Period', `${from || 'start'} to ${to || 'today'}`],
      ['Revenue', report.revenue.toFixed(2)],
      ['Estimated profit', report.profit.toFixed(2)],
      ['Bills', report.bills],
      ['Items sold', report.itemsSold],
    ]

    const csv = rows.map((r) => r.map(esc).join(',')).join('\n')
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sales-report-${from || 'all'}-to-${to || 'today'}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success('Report exported.')
    return undefined
  }

  // Zero-filled so the time axis is continuous; see fillDailySeries.
  const daily = useMemo(
    () => fillDailySeries(report.days, { from, to }),
    [report.days, from, to]
  )

  const pager = usePagination(visibleItems, 50)

  if (loading) return <Loading label="Building report…" />

  const peak = Math.max(1, ...report.days.map(([, v]) => v))
  const methodTotal = Object.values(report.byMethod).reduce((a, b) => a + b, 0)

  return (
    <>
      {/* --- Period picker ------------------------------------------------- */}
      <div className="card mb-4 no-print">
        <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 170 }}>
            <label className="text-sm strong" style={{ display: 'block', marginBottom: 6, color: 'var(--text-2)' }}>
              Period
            </label>
            <select value={preset} onChange={(e) => applyPreset(e.target.value)}>
              {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              <option value="custom">Custom range…</option>
            </select>
          </div>

          <div>
            <label className="text-sm strong" style={{ display: 'block', marginBottom: 6, color: 'var(--text-2)' }}>
              From
            </label>
            <input type="date" value={from} max={to || undefined}
              onChange={(e) => { setFrom(e.target.value); setPreset('custom') }} />
          </div>

          <div>
            <label className="text-sm strong" style={{ display: 'block', marginBottom: 6, color: 'var(--text-2)' }}>
              To
            </label>
            <input type="date" value={to} min={from || undefined}
              onChange={(e) => { setTo(e.target.value); setPreset('custom') }} />
          </div>

          <div className="ml-auto flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={exportCsv}>⬇ Export CSV</button>
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>🖨 Print</button>
          </div>
        </div>
      </div>

      {report.bills === 0 ? (
        <div className="card">
          <Empty icon="📈" title="No sales in this period"
            message="Pick a wider date range, or start billing to see figures here." />
        </div>
      ) : (
        <>
          {/* --- Headline figures ----------------------------------------- */}
          <div className="grid grid-4 mb-4">
            <Stat label="Net revenue" value={money(report.revenue, currency)}
              foot={report.refunds > 0
                ? `${money(report.grossRevenue, currency)} less ${money(report.refunds, currency)} refunded`
                : `${num(report.bills)} bills · ${num(report.itemsSold)} items`}
              icon="💰" tone="green" />
            <Stat label="Gross profit (est.)" value={money(report.profit, currency)}
              foot={`${report.margin.toFixed(1)}% margin`} icon="📈" tone="brand" />
            <Stat label="Average bill" value={money(report.average, currency)}
              foot={report.busiestHour !== null ? `Busiest at ${report.busiestHour}:00` : undefined}
              icon="🧾" tone="blue" />
            <Stat label="Discounts given" value={money(report.discount, currency)}
              foot={report.tax > 0 ? `Tax collected ${money(report.tax, currency)}` : 'No tax applied'}
              icon="🏷️" tone="amber" />
            {report.refunds > 0 && (
              <Stat label="Refunded" value={money(report.refunds, currency)}
                foot={`${num(report.returns.length)} returns · ${num(report.refundedUnits)} items back`}
                icon="↩" tone="red" />
            )}
          </div>

          {/* --- Daily revenue -------------------------------------------- */}
          <div className="card mb-4">
            <div className="card-head">
              <h2>Daily revenue</h2>
              <span className="badge badge-grey spacer">
                {formatDate(from || report.days[0]?.[0], false)} – {formatDate(to || new Date(), false)}
              </span>
            </div>
            <div className="card-body">
              <RevenueChart series={daily} currency={currency} />
              <div className="flex items-center gap-3 mt-3 wrap">
                <span className="chart-legend"><span className="chart-key" /> Revenue per day</span>
                <span className="text-sm text-muted ml-auto">
                  Peak {money(peak, currency)} · {daily.length} days
                </span>
              </div>
            </div>
          </div>

          {/* --- Split: payment + categories ------------------------------ */}
          <div className="grid grid-2 mb-4">
            <div className="card">
              <div className="card-head"><h2>Payment methods</h2></div>
              <div className="card-body">
                {Object.entries(report.byMethod).sort(([, a], [, b]) => b - a).map(([method, value]) => {
                  const pct = methodTotal ? (value / methodTotal) * 100 : 0
                  return (
                    <div key={method} className="mb-3">
                      <div className="flex text-sm" style={{ justifyContent: 'space-between' }}>
                        <span style={{ textTransform: 'capitalize' }}>{method}</span>
                        <span className="strong">{money(value, currency)} · {pct.toFixed(0)}%</span>
                      </div>
                      <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, marginTop: 5 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green)', borderRadius: 999 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h2>Categories</h2></div>
              <div className="card-body">
                {report.categories.length === 0 && <p className="text-sm text-muted">No categories set.</p>}
                {report.categories.slice(0, 8).map((c) => {
                  const pct = report.revenue ? (c.revenue / report.revenue) * 100 : 0
                  return (
                    <div key={c.name} className="mb-3">
                      <div className="flex text-sm" style={{ justifyContent: 'space-between' }}>
                        <span>{c.name}</span>
                        <span className="strong">{money(c.revenue, currency)} · {num(c.qty)} sold</span>
                      </div>
                      <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, marginTop: 5 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--brand)', borderRadius: 999 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* --- Per-item detail ------------------------------------------ */}
          <div className="card">
            <div className="card-head">
              <h2>Product performance</h2>
              <div className="search-box">
                <span className="ico">🔍</span>
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by product, barcode or category…" />
              </div>
              <div className="spacer flex gap-2 items-center">
                <span className="text-sm text-muted">Sort by</span>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={{ width: 150 }}>
                  <option value="revenue">Revenue</option>
                  <option value="profit">Profit</option>
                  <option value="qty">Units sold</option>
                  <option value="margin">Margin %</option>
                  <option value="name">Name</option>
                </select>
              </div>
            </div>

            <div className="card-body tight">
              {visibleItems.length === 0 ? (
                <Empty icon="🔍" title="Nothing matches that filter" />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Category</th>
                        <th className="num">Units</th>
                        <th className="num">Revenue</th>
                        <th className="num">Cost</th>
                        <th className="num">Profit</th>
                        <th className="num">Margin</th>
                        <th className="num">Discount</th>
                        <th className="num">% of sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pager.slice.map((i) => (
                        <tr key={i.id}>
                          <td>
                            <div className="cell-title">{i.name}</div>
                            {i.barcode && <div className="cell-sub mono">{i.barcode}</div>}
                          </td>
                          <td className="text-sm">{i.category}</td>
                          <td className="num">{num(i.qty)}</td>
                          <td className="num strong">{money(i.revenue, currency)}</td>
                          <td className="num text-muted">{money(i.cost, currency)}</td>
                          <td className={`num ${i.profit < 0 ? 'text-red' : 'text-green'}`}>
                            {money(i.profit, currency)}
                          </td>
                          <td className="num">{i.margin.toFixed(1)}%</td>
                          <td className="num">
                            {i.discount > 0 ? <span className="text-red">−{money(i.discount, currency)}</span> : '—'}
                          </td>
                          <td className="num">
                            <span className="flex items-center gap-2" style={{ justifyContent: 'flex-end' }}>
                              <span style={{ width: 44, height: 5, background: 'var(--surface-2)', borderRadius: 999 }}>
                                <span style={{
                                  display: 'block', width: `${Math.min(100, i.share)}%`, height: '100%',
                                  background: 'var(--brand)', borderRadius: 999,
                                }} />
                              </span>
                              {i.share.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--surface-2)', fontWeight: 650 }}>
                        <td colSpan={2}>{visibleItems.length} products</td>
                        <td className="num">{num(visibleItems.reduce((s, i) => s + i.qty, 0))}</td>
                        <td className="num">{money(visibleItems.reduce((s, i) => s + i.revenue, 0), currency)}</td>
                        <td className="num">{money(visibleItems.reduce((s, i) => s + i.cost, 0), currency)}</td>
                        <td className="num">{money(visibleItems.reduce((s, i) => s + i.profit, 0), currency)}</td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <Pagination pager={pager} label="products" />
            </div>
          </div>

          <p className="text-sm text-muted mt-3">
            Profit is estimated using each product's <strong>current</strong> cost price, since
            historical cost is not stored on past bills. Changing a cost changes past figures.
          </p>
        </>
      )}
    </>
  )
}
