import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { listSales } from '../services/sales'
import { money, formatDate, toDate, daysAgo } from '../utils/format'
import { printBill, nextFrame } from '../utils/print'
import { createReturn, returnableQty, calcRefund, isFullyReturned } from '../services/returns'
import { Modal, Field, Empty, Loading } from '../components/ui'
import Pagination, { usePagination } from '../components/Pagination'
import ReceiptPortal from '../components/Receipt'
import CreditNotePortal from '../components/CreditNote'

const RANGES = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
]

export default function Sales() {
  const { shopId, shop, currency } = useAuth()
  const toast = useToast()

  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('7')
  const [search, setSearch] = useState('')
  // The bill currently rendered into the print portal. Only ever one at a
  // time — two receipts sitting there would print on the same job.
  const [portalSale, setPortalSale] = useState(null)
  const [printingId, setPrintingId] = useState(null)

  // Returns: the bill being returned against, the quantities picked, and the
  // credit note waiting to be printed once it is saved.
  const [returning, setReturning] = useState(null)
  const [qtys, setQtys] = useState({})
  const [reason, setReason] = useState('')
  const [savingReturn, setSavingReturn] = useState(false)
  const [creditNote, setCreditNote] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSales(await listSales(shopId, { max: 500 }))
    } catch {
      toast.error('Could not load sales.')
    } finally {
      setLoading(false)
    }
  }, [shopId, toast])

  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    const cfg = RANGES.find((r) => r.key === range)
    const from = cfg?.days === null ? null : daysAgo(cfg.days)
    const q = search.trim().toLowerCase()

    return sales.filter((s) => {
      if (from && (toDate(s.createdAt) || 0) < from) return false
      if (!q) return true
      return String(s.invoiceNo).includes(q) ||
        (s.customer || '').toLowerCase().includes(q) ||
        (s.cashierName || '').toLowerCase().includes(q) ||
        s.items?.some((i) => i.name.toLowerCase().includes(q))
    })
  }, [sales, range, search])

  /** Sends a past bill straight to the printer. */
  const quickPrint = async (sale) => {
    setPrintingId(sale.id)
    try {
      // Clear first so the previously printed bill cannot go out again.
      setPortalSale(null)
      await nextFrame()
      setPortalSale(sale)

      const how = await printBill(shop)
      if (how === 'empty') toast.error('The receipt did not render — nothing was printed.')
      else if (how === 'direct') toast.success(`Invoice #${sale.invoiceNo} sent to ${shop.printerName}.`)
      else toast.success(`Invoice #${sale.invoiceNo} sent to the printer.`)
    } finally {
      setPrintingId(null)
    }
  }

  const openReturn = (sale) => {
    setReturning(sale)
    setReason('')
    setQtys({})
  }

  const setQty = (productId, value, maxQty) => {
    const n = Math.max(0, Math.min(Number(value) || 0, maxQty))
    setQtys((q) => ({ ...q, [productId]: n }))
  }

  /** Returns everything still outstanding on the bill. */
  const selectAll = () => {
    const all = {}
    returning.items.forEach((i) => { all[i.productId] = returnableQty(returning, i) })
    setQtys(all)
  }

  const returnLines = useMemo(() => {
    if (!returning) return []
    return returning.items
      .map((item) => ({ item, qty: Number(qtys[item.productId]) || 0 }))
      .filter((l) => l.qty > 0)
  }, [returning, qtys])

  const refund = useMemo(
    () => (returning ? calcRefund(returning, returnLines) : { total: 0 }),
    [returning, returnLines]
  )

  const submitReturn = async () => {
    if (!returnLines.length) return toast.error('Choose at least one item to return.')

    setSavingReturn(true)
    try {
      const saved = await createReturn(shopId, {
        sale: returning,
        lines: returnLines,
        reason,
        cashier: { name: profile?.name || profile?.email, uid: profile?.uid },
      })

      const printable = {
        ...saved,
        invoiceNo: returning.invoiceNo,
        type: returnLines.length === returning.items.length
          && returning.items.every((i) => (qtys[i.productId] || 0) >= returnableQty(returning, i))
          ? 'void' : 'return',
        items: returnLines.map((l) => ({
          productId: l.item.productId,
          name: l.item.name,
          unit: l.item.unit || 'pcs',
          price: Number(l.item.price) || 0,
          qty: l.qty,
          net: ((Number(l.item.net) || 0) / Math.max(1, Number(l.item.qty) || 1)) * l.qty,
        })),
        taxRate: returning.taxRate || 0,
        reason,
        cashierName: profile?.name || profile?.email,
        createdAt: new Date(),
      }

      setReturning(null)
      setCreditNote(printable)
      setPortalSale(null)
      await load()

      toast.success(`Credit #${saved.creditNo} — refund ${money(saved.total, currency)}. Stock restored.`)

      // Print the note straight away, the same as a bill.
      await nextFrame()
      const how = await printBill(shop)
      if (how === 'empty') toast.error('The credit note did not render — nothing was printed.')
    } catch (err) {
      toast.error(err.message || 'Could not save the return.')
    } finally {
      setSavingReturn(false)
    }
    return undefined
  }

  const summary = useMemo(() => ({
    count: rows.length,
    revenue: rows.reduce((sum, s) => sum + (Number(s.total) || 0), 0),
    discount: rows.reduce((sum, s) => sum + (Number(s.totalDiscount) || 0), 0),
    items: rows.reduce((sum, s) => sum + (Number(s.itemCount) || 0), 0),
  }), [rows])

  const pager = usePagination(rows)
  if (loading) return <Loading label="Loading sales…" />

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div className="search-box">
            <span className="ico">🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Invoice no, customer, cashier or item…" />
          </div>
          <select value={range} onChange={(e) => setRange(e.target.value)} style={{ width: 160 }}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <div className="spacer flex gap-2 wrap">
            <span className="badge badge-grey">{summary.count} bills</span>
            <span className="badge badge-green">{money(summary.revenue, currency)}</span>
            {summary.discount > 0 && (
              <span className="badge badge-amber">{money(summary.discount, currency)} discounted</span>
            )}
          </div>
        </div>

        <div className="card-body tight">
          {rows.length === 0 ? (
            <Empty icon="🧾" title="No bills in this period"
              message="Try a wider date range or clear the search." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th><th>Date</th><th>Customer</th><th>Cashier</th>
                    <th className="num">Items</th><th className="num">Discount</th>
                    <th className="num">Total</th><th>Status</th><th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-title">#{s.invoiceNo}</td>
                      <td className="text-sm text-muted nowrap">{formatDate(s.createdAt)}</td>
                      <td className="text-sm">{s.customer || 'Walk-in'}</td>
                      <td className="text-sm">{s.cashierName || '—'}</td>
                      <td className="num">{s.itemCount}</td>
                      <td className="num">
                        {s.totalDiscount > 0
                          ? <span className="text-red">−{money(s.totalDiscount, currency)}</span>
                          : '—'}
                      </td>
                      <td className="num strong">{money(s.total, currency)}</td>
                      <td>
                        {s.voided ? (
                          <span className="badge badge-red">Cancelled</span>
                        ) : s.refundedTotal > 0 ? (
                          <span className="badge badge-amber" title={`${money(s.refundedTotal, currency)} refunded`}>
                            Part returned
                          </span>
                        ) : (
                          <span className="badge badge-grey" style={{ textTransform: 'capitalize' }}>{s.paymentMethod}</span>
                        )}
                      </td>
                      <td className="num nowrap">
                        {!isFullyReturned(s) && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openReturn(s)}>
                              ↩ Return
                            </button>{' '}
                          </>
                        )}
                        <button type="button" className="btn btn-sm" onClick={() => quickPrint(s)}
                          disabled={printingId === s.id} title={`Print invoice #${s.invoiceNo}`}>
                          {printingId === s.id ? <span className="spinner" /> : '🖨'} Print
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination pager={pager} label="bills" />
        </div>
      </div>


      {returning && (
        <Modal
          wide
          title={`Return against invoice #${returning.invoiceNo}`}
          subtitle={`${formatDate(returning.createdAt)} · ${money(returning.total, currency)}`}
          onClose={() => setReturning(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setReturning(null)}
                disabled={savingReturn}>Cancel</button>
              <button type="button" className="btn btn-ghost" onClick={selectAll}
                disabled={savingReturn}>Return whole bill</button>
              <button type="button" className="btn btn-danger" onClick={submitReturn}
                disabled={savingReturn || !returnLines.length}>
                {savingReturn && <span className="spinner" />} Refund {money(refund.total, currency)}
              </button>
            </>
          }
        >
          <p className="text-sm text-muted mb-3">
            Choose how many of each item are coming back. Stock is put back and a credit
            note prints. The original bill is kept as it was.
          </p>

          <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Sold</th>
                  <th className="num">Already back</th>
                  <th className="num" style={{ width: 120 }}>Return</th>
                  <th className="num">Refund</th>
                </tr>
              </thead>
              <tbody>
                {returning.items.map((item) => {
                  const left = returnableQty(returning, item)
                  const back = (Number(item.qty) || 0) - left
                  const picked = Number(qtys[item.productId]) || 0
                  const unitNet = (Number(item.net) || 0) / Math.max(1, Number(item.qty) || 1)
                  return (
                    <tr key={item.productId}>
                      <td>
                        <div className="cell-title">{item.name}</div>
                        <div className="cell-sub">{money(item.price, currency)} each</div>
                      </td>
                      <td className="num">{item.qty}</td>
                      <td className="num">{back || '—'}</td>
                      <td className="num">
                        {left === 0 ? (
                          <span className="badge badge-grey">All returned</span>
                        ) : (
                          <div className="qty-box" style={{ marginLeft: 'auto', width: 'fit-content' }}>
                            <button type="button" onClick={() => setQty(item.productId, picked - 1, left)}>−</button>
                            <input value={picked}
                              onChange={(e) => setQty(item.productId, e.target.value, left)} />
                            <button type="button" onClick={() => setQty(item.productId, picked + 1, left)}>+</button>
                          </div>
                        )}
                      </td>
                      <td className="num strong">
                        {picked > 0 ? money(unitNet * picked, currency) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <Field label="Reason" hint="Printed on the credit note — e.g. damaged, wrong size, customer changed mind.">
              <input value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Why is it coming back?" />
            </Field>
          </div>

          {refund.total > 0 && (
            <div className="alert alert-amber">
              <span>↩</span>
              <span>
                Refunding <strong>{money(refund.total, currency)}</strong>
                {refund.tax > 0 && ` (including ${money(refund.tax, currency)} tax)`} and putting{' '}
                {returnLines.reduce((n, l) => n + l.qty, 0)} item(s) back into stock.
              </span>
            </div>
          )}
        </Modal>
      )}

      {portalSale && !creditNote && <ReceiptPortal sale={portalSale} shop={shop} />}
      {creditNote && <CreditNotePortal note={creditNote} shop={shop} />}

    </>
  )
}
