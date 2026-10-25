import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { listProducts, listMovements, adjustStock } from '../services/products'
import { formatDate, num } from '../utils/format'
import { normaliseScan } from '../utils/barcode'
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
    setLoading(true)
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

  const openFor = (product, type = 'in') => {
    setForm({ product, type, quantity: '', note: '' })
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
    const qty = Number(form.quantity)
    if (!Number.isFinite(qty) || (form.type !== 'adjust' && qty <= 0)) {
      return toast.error('Enter a quantity greater than zero.')
    }
    if (form.type === 'out' && qty > Number(form.product.stock || 0)) {
      return toast.error(`Only ${form.product.stock} in stock.`)
    }

    setSaving(true)
    try {
      await adjustStock(shopId, form.product, {
        type: form.type,
        quantity: qty,
        note: form.note,
        actor: profile?.name || profile?.email,
      })
      toast.success('Stock updated.')
      setForm(null)
      await load()
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
                      <td><StockBadge stock={p.stock} lowAt={p.lowStockAt} /></td>
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
                        <td className="num strong">{meta.sign}{num(Math.abs(m.quantity))}</td>
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
          subtitle={`Currently ${form.product.stock ?? 0} ${form.product.unit || 'pcs'} in stock`}
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
              <input
                type="number" step="1" min="0" className="input-lg"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                autoFocus required
              />
            </Field>

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
