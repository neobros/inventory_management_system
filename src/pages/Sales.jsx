import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useLang, translate as tr } from '../i18n/LanguageContext'
import { listSales } from '../services/sales'
import { money, formatDate, toDate, daysAgo } from '../utils/format'
import { formatQty, isMeasured, perUnit, roundQty } from '../utils/units'
import { printBill, nextFrame } from '../utils/print'
import { createReturn, returnableQty, calcRefund, isFullyReturned } from '../services/returns'
import { Modal, Field, Empty, Loading } from '../components/ui'
import Pagination, { usePagination } from '../components/Pagination'
import ReceiptPortal from '../components/Receipt'

const RANGES = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
]

export default function Sales() {
  // profile names the cashier on the return; without it every return crashed.
  const { shopId, shop, profile, currency } = useAuth()
  const toast = useToast()
  const { t } = useLang()

  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('7')
  const [search, setSearch] = useState('')
  // The bill currently rendered into the print portal. Only ever one at a
  // time — two receipts sitting there would print on the same job.
  const [portalSale, setPortalSale] = useState(null)
  const [printingId, setPrintingId] = useState(null)

  // Returns: the bill being returned against and the quantities picked.
  const [returning, setReturning] = useState(null)
  const [qtys, setQtys] = useState({})
  const [reason, setReason] = useState('')
  const [savingReturn, setSavingReturn] = useState(false)

  const load = useCallback(async () => {
    // No setLoading(true) here: the spinner is for the first load only. Refreshing
    // after a save must not swap the page for a spinner — that looked like a reload.
    try {
      setSales(await listSales(shopId, { max: 500 }))
    } catch {
      toast.error(tr('Could not load sales.'))
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
      if (how === 'empty') toast.error(tr('The receipt did not render — nothing was printed.'))
      else if (how === 'direct') toast.success(tr('Invoice #{no} sent to {printer}.', { no: sale.invoiceNo, printer: shop.printerName }))
      else toast.success(tr('Invoice #{no} sent to the printer.', { no: sale.invoiceNo }))
    } finally {
      setPrintingId(null)
    }
  }

  const openReturn = (sale) => {
    setReturning(sale)
    setReason('')
    setQtys({})
  }

  /**
   * Typed text is kept as-is while it is still a valid partial number ("0.",
   * "0.2"), so weighed lines can take decimals; anything over what is left is
   * capped. Pieces are whole numbers.
   */
  const setQty = (productId, value, maxQty, measured = false) => {
    if (typeof value === 'string' && measured && /^\d*\.?\d*$/.test(value) && (Number(value) || 0) <= maxQty) {
      setQtys((q) => ({ ...q, [productId]: value }))
      return
    }
    const raw = Number(value) || 0
    const n = Math.max(0, Math.min(measured ? roundQty(raw) : Math.round(raw), maxQty))
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
    if (!returnLines.length) return toast.error(tr('Choose at least one item to return.'))

    setSavingReturn(true)
    try {
      const saved = await createReturn(shopId, {
        sale: returning,
        lines: returnLines,
        reason,
        cashier: { name: profile?.name || profile?.email, uid: profile?.uid },
      })

      // Nothing is printed after a return — the shop asked for that. The credit
      // note is still saved and the stock is restored.
      // Mark the bill as returned on screen instead of re-reading 500 sales.
      const saleId = returning.id
      setSales((list) => list.map((s) => (s.id === saleId ? { ...s, ...saved.sale } : s)))
      setReturning(null)

      toast.success(tr('Credit #{no} — refund {amount}. Stock restored.', { no: saved.creditNo, amount: money(saved.total, currency) }))
    } catch (err) {
      toast.error(err.message || tr('Could not save the return.'))
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
  if (loading) return <Loading label={t('Loading sales…')} />

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div className="search-box">
            <span className="ico">🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t('Invoice no, customer, cashier or item…')} />
          </div>
          <select value={range} onChange={(e) => setRange(e.target.value)} style={{ width: 160 }}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{t(r.label)}</option>)}
          </select>
          <div className="spacer flex gap-2 wrap">
            <span className="badge badge-grey">{t('{n} bills', { n: summary.count })}</span>
            <span className="badge badge-green">{money(summary.revenue, currency)}</span>
            {summary.discount > 0 && (
              <span className="badge badge-amber">{t('{amount} discounted', { amount: money(summary.discount, currency) })}</span>
            )}
          </div>
        </div>

        <div className="card-body tight">
          {rows.length === 0 ? (
            <Empty icon="🧾" title={t('No bills in this period')}
              message={t('Try a wider date range or clear the search.')} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Invoice')}</th><th>{t('Date')}</th><th>{t('Customer')}</th><th>{t('Cashier')}</th>
                    <th className="num">{t('Items')}</th><th className="num">{t('Discount')}</th>
                    <th className="num">{t('Total')}</th><th>{t('Status')}</th><th className="num">{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-title">#{s.invoiceNo}</td>
                      <td className="text-sm text-muted nowrap">{formatDate(s.createdAt)}</td>
                      <td className="text-sm">{s.customer || t('Walk-in')}</td>
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
                          <span className="badge badge-red">{t('Cancelled')}</span>
                        ) : s.refundedTotal > 0 ? (
                          <span className="badge badge-amber" title={t('{amount} refunded', { amount: money(s.refundedTotal, currency) })}>
                            {t('Part returned')}
                          </span>
                        ) : (
                          <span className="badge badge-grey" style={{ textTransform: 'capitalize' }}>{t(s.paymentMethod || 'cash')}</span>
                        )}
                      </td>
                      <td className="num nowrap">
                        {!isFullyReturned(s) && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openReturn(s)}>
                              {t('↩ Return')}
                            </button>{' '}
                          </>
                        )}
                        <button type="button" className="btn btn-sm" onClick={() => quickPrint(s)}
                          disabled={printingId === s.id} title={t('Print invoice #{no}', { no: s.invoiceNo })}>
                          {printingId === s.id ? <span className="spinner" /> : '🖨'} {t('Print')}
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
          title={t('Return against invoice #{no}', { no: returning.invoiceNo })}
          subtitle={`${formatDate(returning.createdAt)} · ${money(returning.total, currency)}`}
          onClose={() => setReturning(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setReturning(null)}
                disabled={savingReturn}>{t('Cancel')}</button>
              <button type="button" className="btn btn-ghost" onClick={selectAll}
                disabled={savingReturn}>{t('Return whole bill')}</button>
              <button type="button" className="btn btn-danger" onClick={submitReturn}
                disabled={savingReturn || !returnLines.length}>
                {savingReturn && <span className="spinner" />} {t('Refund {amount}', { amount: money(refund.total, currency) })}
              </button>
            </>
          }
        >
          <p className="text-sm text-muted mb-3">
            {t('Choose how many of each item are coming back. Stock is put back and a credit note prints. The original bill is kept as it was.')}
          </p>

          <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>{t('Item')}</th>
                  <th className="num">{t('Sold')}</th>
                  <th className="num">{t('Already back')}</th>
                  <th className="num" style={{ width: 120 }}>{t('Return')}</th>
                  <th className="num">{t('Refund')}</th>
                </tr>
              </thead>
              <tbody>
                {returning.items.map((item) => {
                  const left = returnableQty(returning, item)
                  const back = (Number(item.qty) || 0) - left
                  const picked = Number(qtys[item.productId]) || 0
                  const unitNet = (Number(item.net) || 0) / (Number(item.qty) || 1)
                  const measured = isMeasured(item.unit)
                  return (
                    <tr key={item.productId}>
                      <td>
                        <div className="cell-title">{item.name}</div>
                        <div className="cell-sub">{money(item.price, currency)} {perUnit(item.unit)}</div>
                      </td>
                      <td className="num">{formatQty(item.qty, item.unit || 'pcs')}</td>
                      <td className="num">{back > 0 ? formatQty(back, item.unit || 'pcs') : '—'}</td>
                      <td className="num">
                        {left === 0 ? (
                          <span className="badge badge-grey">{t('All returned')}</span>
                        ) : (
                          <div className="qty-box" style={{ marginLeft: 'auto', width: 'fit-content' }}>
                            {!measured && <button type="button" onClick={() => setQty(item.productId, picked - 1, left)}>−</button>}
                            <input value={qtys[item.productId] ?? 0} inputMode="decimal"
                              style={measured ? { width: 64 } : undefined}
                              onChange={(e) => setQty(item.productId, e.target.value, left, measured)} />
                            {measured && <span className="text-sm" style={{ padding: '0 6px' }}>{item.unit}</span>}
                            {!measured && <button type="button" onClick={() => setQty(item.productId, picked + 1, left)}>+</button>}
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
            <Field label={t('Reason')} hint={t('Printed on the credit note — e.g. damaged, wrong size, customer changed mind.')}>
              <input value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={t('Why is it coming back?')} />
            </Field>
          </div>

          {refund.total > 0 && (
            <div className="alert alert-amber">
              <span>↩</span>
              <span>
                {t('Refunding {amount}{tax} and putting {n} item(s) back into stock.', {
                  amount: money(refund.total, currency),
                  tax: refund.tax > 0 ? t(' (including {tax} tax)', { tax: money(refund.tax, currency) }) : '',
                  n: returnLines.length,
                })}
              </span>
            </div>
          )}
        </Modal>
      )}

      {portalSale && <ReceiptPortal sale={portalSale} shop={shop} />}

    </>
  )
}
