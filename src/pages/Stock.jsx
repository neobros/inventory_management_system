import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { listProducts, listMovements, adjustStock } from '../services/products'
import { formatDate } from '../utils/format'
import { normaliseScan } from '../utils/barcode'
import { entryUnits, formatQty, isMeasured, roundQty, toProductUnit } from '../utils/units'
import { Modal, Field, Empty, Loading, StockBadge } from '../components/ui'
import Pagination, { usePagination } from '../components/Pagination'

const TYPE_META = {
  in: { label: 'Stock in', badge: 'badge-green', sign: '+' },
  out: { label: 'Stock out', badge: 'badge-red', sign: '−' },
  adjust: { label: 'Adjustment', badge: 'badge-blue', sign: '' },
  sale: { label: 'Sale', badge: 'badge-grey', sign: '−' },
}

export default function Stock() {
  const { shopId, profile } = useAuth()
  const toast = useToast()

  const [products, setProducts] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [scan, setScan] = useState('')

  const load = useCallback(async () => {
    // No setLoading(true) here: the spinner is for the first load only. Refreshing
    // after a save must not swap the page for a spinner — that looked like a reload.
    try {
      const [p, m] = await Promise.all([listProducts(shopId), listMovements(shopId, 250)])
      setProducts(p)
      setMovements(m)
    } catch {
      toast.error('Could not load stock data.')
    } finally {
      setLoading(false)
    }
  }, [shopId, toast])

  useEffect(() => { load() }, [load])

  /**
   * Weighed goods default to their own unit (kg) but can be entered in the
   * other one (g); the amount is converted before it touches the stock.
   */
  const openFor = (product, type = 'in') => {
    const unit = product.unit || 'pcs'
    setForm({ product, type, quantity: '', entryUnit: unit, note: '' })
  }

  /** Scanning a barcode on this screen jumps straight to a stock-in entry. */
  const onScan = (e) => {
    e.preventDefault()
    const code = normaliseScan(scan)
    if (!code) return
    setScan('')
    const hit = products.find((p) => p.barcode === code || p.sku === code)
    if (hit) openFor(hit, 'in')
    else toast.error(`No product matches ${code}`)
  }

  const submit = async (e) => {
    e.preventDefault()
    const unit = form.product.unit || 'pcs'
    const typed = Number(form.quantity)
    if (form.quantity === '' || !Number.isFinite(typed) || typed < 0 || (form.type !== 'adjust' && typed <= 0)) {
      return toast.error('Enter a quantity greater than zero.')
    }
    if (!isMeasured(unit) && !Number.isInteger(typed)) {
      return toast.error(`${unit} must be a whole number. Use kg, g, litre, ml or metre for part amounts.`)
    }
    const qty = toProductUnit(typed, form.entryUnit, unit)
    if (form.type === 'out' && qty > roundQty(form.product.stock)) {
      return toast.error(`Only ${formatQty(form.product.stock, unit)} in stock.`)
    }

    setSaving(true)
    try {
      const done = await adjustStock(shopId, form.product, {
        type: form.type,
        quantity: qty,
        note: form.note,
        actor: profile?.name || profile?.email,
      })
      // Update the screen from what was written instead of re-reading every
      // product and the last 250 movements.
      const id = form.product.id
      setProducts((list) => list.map((p) => (p.id === id ? { ...p, stock: done.stock } : p)))
      setMovements((list) => [done.movement, ...list].slice(0, 250))
      toast.success('Stock updated.')
      setForm(null)
    } catch (err) {
      toast.error(err.message || 'Could not update stock.')
    } finally {
      setSaving(false)
    }
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return movements.filter((m) => {
      if (filter !== 'all' && m.type !== filter) return false
      if (!q) return true
      return (m.productName || '').toLowerCase().includes(q) ||
        (m.note || '').toLowerCase().includes(q) ||
        (m.barcode || '').includes(q)
    })
  }, [movements, filter, search])

  const productRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products.slice(0, 8)
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q)
    ).slice(0, 8)
  }, [products, search])

  const pager = usePagination(rows, 50)

  // Older movements did not store a unit; fall back to the product's.
  const unitOf = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p.unit || 'pcs']))
    return (m) => m.unit || map.get(m.productId) || 'pcs'
  }, [products])

  if (loading) return <Loading label="Loading stock movements…" />

  return (
    <>
      <form className="scan-bar no-print" onSubmit={onScan}>
        <span style={{ fontSize: 20 }}>📷</span>
        <input className="input-lg mono" value={scan} onChange={(e) => setScan(e.target.value)}
          placeholder="Scan a product barcode to receive stock" autoComplete="off" />
        <button type="submit" className="btn">Find</button>
      </form>

      <div className="card mb-4">
        <div className="card-head">
          <h2>Quick stock update</h2>
          <div className="search-box spacer">
            <span className="ico">🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products or movements…" />
          </div>
        </div>
        <div className="card-body tight">
          {productRows.length === 0 ? (
            <Empty icon="📦" title="No products found" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Product</th><th>Barcode</th><th>Stock</th><th className="num">Update</th></tr>
                </thead>
                <tbody>
                  {productRows.map((p) => (
                    <tr key={p.id}>
                      <td className="cell-title">{p.name}</td>
                      <td className="mono text-sm">{p.barcode || '—'}</td>
                      <td><StockBadge stock={p.stock} lowAt={p.lowStockAt} unit={p.unit} /></td>
                      <td className="num nowrap">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openFor(p, 'in')}>+ In</button>{' '}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openFor(p, 'out')}>− Out</button>{' '}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openFor(p, 'adjust')}>Set</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Movement history</h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 160 }} className="spacer">
            <option value="all">All movements</option>
            <option value="in">Stock in</option>
            <option value="out">Stock out</option>
            <option value="adjust">Adjustments</option>
            <option value="sale">Sales</option>
          </select>
        </div>
        <div className="card-body tight">
          {rows.length === 0 ? (
            <Empty icon="🔄" title="No movements recorded"
              message="Receiving stock, selling and adjustments all show up here." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>When</th><th>Product</th><th>Type</th><th className="num">Qty</th><th>Note</th><th>By</th></tr>
                </thead>
                <tbody>
                  {pager.slice.map((m) => {
                    const meta = TYPE_META[m.type] || TYPE_META.adjust
                    return (
                      <tr key={m.id}>
                        <td className="text-sm text-muted nowrap">{formatDate(m.createdAt)}</td>
                        <td className="cell-title">{m.productName}</td>
                        <td><span className={`badge ${meta.badge}`}>{meta.label}</span></td>
                        <td className="num strong nowrap">{meta.sign}{formatQty(Math.abs(m.quantity), unitOf(m))}</td>
                        <td className="text-sm text-muted">{m.note || '—'}</td>
                        <td className="text-sm">{m.actor || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination pager={pager} label="movements" />
        </div>
      </div>

      {form && (
        <Modal
          title={form.product.name}
          subtitle={`Currently ${formatQty(form.product.stock ?? 0, form.product.unit || 'pcs')} in stock`}
          onClose={() => setForm(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
              <button type="submit" form="stock-form" className="btn" disabled={saving}>
                {saving && <span className="spinner" />} Update stock
              </button>
            </>
          }
        >
          <form id="stock-form" onSubmit={submit}>
            <Field label="Movement type">
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                <option value="in">Stock in — goods received</option>
                <option value="out">Stock out — damage, return, wastage</option>
                <option value="adjust">Set exact count — stock take</option>
              </select>
            </Field>

            <Field
              label={form.type === 'adjust' ? 'Counted quantity' : 'Quantity'}
              required
              hint={form.type === 'adjust' ? 'The stock level will be set to exactly this number.' : undefined}
            >
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="number" min="0" className="input-lg"
                  step={isMeasured(form.product.unit) ? 'any' : '1'}
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  placeholder={isMeasured(form.product.unit) ? 'e.g. 0.5' : '0'}
                  autoFocus required
                />
                <select value={form.entryUnit} style={{ flex: 'none', width: 100 }}
                  onChange={(e) => setForm((f) => ({ ...f, entryUnit: e.target.value }))}
                  disabled={!isMeasured(form.product.unit)}>
                  {[...entryUnits(form.product.unit)].reverse().map((o) => (
                    <option key={o.unit} value={o.unit}>{o.unit}</option>
                  ))}
                </select>
              </div>
            </Field>
            {isMeasured(form.product.unit) && Number(form.quantity) > 0 && form.entryUnit !== form.product.unit && (
              <p className="text-sm text-muted" style={{ marginTop: -8 }}>
                = {toProductUnit(form.quantity, form.entryUnit, form.product.unit)} {form.product.unit}
              </p>
            )}

            <Field label="Note" hint="Supplier name, invoice number, reason for wastage…">
              <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Optional" />
            </Field>
          </form>
        </Modal>
      )}
    </>
  )
}
