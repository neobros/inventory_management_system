import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  listProducts, createProduct, updateProduct, deleteProduct,
  listCategories, createCategory, barcodeExists,
} from '../services/products'
import { generateBarcode } from '../utils/barcode'
import { money } from '../utils/format'
import { printLabels, nextFrame } from '../utils/print'
import { Modal, ConfirmDialog, Field, Empty, Loading, StockBadge } from '../components/ui'
import Pagination, { usePagination } from '../components/Pagination'
import Barcode from '../components/Barcode'
import LabelSheetPortal, { LABEL_SIZES } from '../components/LabelSheet'

const BLANK = {
  name: '', sku: '', barcode: '', category: '', unit: 'pcs',
  cost: '', price: '', stock: '', lowStockAt: '', supplier: '', active: true,
}

export default function Products() {
  const { shopId, shop, profile, currency } = useAuth()
  const toast = useToast()

  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [labelTarget, setLabelTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, c] = await Promise.all([listProducts(shopId), listCategories(shopId)])
      setProducts(p)
      setCategories(c)
    } catch {
      toast.error('Could not load products.')
    } finally {
      setLoading(false)
    }
  }, [shopId, toast])

  useEffect(() => { load() }, [load])

  const openNew = () => {
    setForm({ ...BLANK, barcode: generateBarcode() })
    setEditing('new')
  }

  const openEdit = (p) => {
    setForm({
      name: p.name || '', sku: p.sku || '', barcode: p.barcode || '',
      category: p.category || '', unit: p.unit || 'pcs',
      cost: p.cost ?? '', price: p.price ?? '', stock: p.stock ?? '',
      lowStockAt: p.lowStockAt ?? '', supplier: p.supplier || '', active: p.active !== false,
    })
    setEditing(p)
  }

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [key]: value }))
  }

  const save = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Product name is required.')
    if (Number(form.price) <= 0) return toast.error('Selling price must be greater than zero.')

    setSaving(true)
    try {
      const code = form.barcode.trim()
      if (code && await barcodeExists(shopId, code, editing === 'new' ? undefined : editing.id)) {
        toast.error('Another product already uses that barcode.')
        return
      }

      if (editing === 'new') {
        await createProduct(shopId, form, profile?.name || profile?.email)
        toast.success('Product added.')
      } else {
        // Stock is only moved from the Stock Movements screen so every change
        // there leaves an audit trail; editing here keeps the count untouched.
        const { stock, ...rest } = form
        await updateProduct(shopId, editing.id, {
          ...rest,
          cost: Number(rest.cost) || 0,
          price: Number(rest.price) || 0,
          lowStockAt: Number(rest.lowStockAt) || 0,
        })
        toast.success('Product updated.')
      }

      if (form.category && !categories.some((c) => c.name === form.category)) {
        await createCategory(shopId, form.category)
      }
      setEditing(null)
      await load()
    } catch (err) {
      toast.error(err.message || 'Could not save the product.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    try {
      await deleteProduct(shopId, deleting.id)
      toast.success('Product deleted.')
      setDeleting(null)
      await load()
    } catch {
      toast.error('Could not delete the product.')
    }
  }

  const printOne = async (product) => {
    // Clear first: portalReady only checks that the portal has content, so a
    // previously printed label still sitting there would be printed again.
    setLabelTarget(null)
    await nextFrame()
    setLabelTarget({ product, copies: 1 })
    // Same preset the sheet renders with, so the grid and the page rule agree.
    if (!(await printLabels(LABEL_SIZES.small.columns))) {
      toast.error('The label did not render — nothing was sent to the printer.')
    }
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (filter === 'low' && !(p.lowStockAt > 0 && p.stock <= p.lowStockAt && p.stock > 0)) return false
      if (filter === 'out' && Number(p.stock) > 0) return false
      if (filter === 'inactive' && p.active !== false) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.barcode || '').includes(q) ||
        (p.category || '').toLowerCase().includes(q)
    })
  }, [products, search, filter])

  const pager = usePagination(rows)
  if (loading) return <Loading label="Loading products…" />

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div className="search-box">
            <span className="ico">🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, SKU, barcode…" />
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 170 }}>
            <option value="all">All products</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="spacer flex gap-2">
            <span className="badge badge-grey">{rows.length} shown</span>
            <button type="button" className="btn" onClick={openNew}>+ New product</button>
          </div>
        </div>

        <div className="card-body tight">
          {rows.length === 0 ? (
            <Empty
              icon="📦"
              title={products.length ? 'Nothing matches that filter' : 'No products yet'}
              message={products.length ? 'Try clearing the search.' : 'Add your first product to start selling.'}
              action={!products.length && <button type="button" className="btn" onClick={openNew}>+ New product</button>}
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Barcode</th>
                    <th>Category</th>
                    <th className="num">Cost</th>
                    <th className="num">Price</th>
                    <th>Stock</th>
                    <th className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="cell-title">
                          {p.name}
                          {p.active === false && <span className="badge badge-grey" style={{ marginLeft: 7 }}>Inactive</span>}
                        </div>
                        {p.sku && <div className="cell-sub">SKU {p.sku}</div>}
                      </td>
                      <td>
                        <button type="button" className="btn btn-ghost btn-sm mono" onClick={() => setViewing(p)}>
                          {p.barcode || '—'}
                        </button>
                      </td>
                      <td className="text-sm">{p.category || '—'}</td>
                      <td className="num">{money(p.cost, currency)}</td>
                      <td className="num strong">{money(p.price, currency)}</td>
                      <td><StockBadge stock={p.stock} lowAt={p.lowStockAt} /></td>
                      <td className="num nowrap">
                        <button type="button" className="btn btn-icon" title="Print label" onClick={() => printOne(p)}>🏷</button>
                        <button type="button" className="btn btn-icon" title="Edit" onClick={() => openEdit(p)}>✎</button>
                        <button type="button" className="btn btn-icon" title="Delete" onClick={() => setDeleting(p)}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination pager={pager} label="products" />
        </div>
      </div>

      {editing && (
        <Modal
          wide
          title={editing === 'new' ? 'New product' : `Edit — ${editing.name}`}
          subtitle={editing === 'new' ? 'A unique barcode is generated for you.' : 'Stock is changed from Stock Movements.'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button type="submit" form="product-form" className="btn" disabled={saving}>
                {saving && <span className="spinner" />} {editing === 'new' ? 'Create product' : 'Save changes'}
              </button>
            </>
          }
        >
          <form id="product-form" onSubmit={save}>
            <Field label="Product name" required>
              <input value={form.name} onChange={set('name')} autoFocus required placeholder="e.g. Basmati Rice 5kg" />
            </Field>

            <div className="row">
              <Field label="SKU / item code"><input value={form.sku} onChange={set('sku')} placeholder="Optional" /></Field>
              <Field label="Category">
                <input value={form.category} onChange={set('category')} list="cat-list" placeholder="e.g. Groceries" />
                <datalist id="cat-list">
                  {categories.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </Field>
            </div>

            <Field label="Barcode (CODE128)" hint="Scanned at the till. Leave as generated unless the item already carries a printed barcode.">
              <div className="flex gap-2">
                <input className="mono" value={form.barcode} onChange={set('barcode')} placeholder="Auto-generated" />
                <button type="button" className="btn btn-ghost nowrap"
                  onClick={() => setForm((f) => ({ ...f, barcode: generateBarcode() }))}>
                  ↻ Regenerate
                </button>
              </div>
            </Field>

            {form.barcode && (
              <div style={{ textAlign: 'center', padding: 10, background: 'var(--surface-2)', borderRadius: 8, marginBottom: 14 }}>
                <Barcode value={form.barcode} height={40} />
              </div>
            )}

            <div className="row">
              <Field label="Cost price" hint="What you pay your supplier">
                <input type="number" step="0.01" min="0" value={form.cost} onChange={set('cost')} placeholder="0.00" />
              </Field>
              <Field label="Selling price" required>
                <input type="number" step="0.01" min="0" value={form.price} onChange={set('price')} placeholder="0.00" required />
              </Field>
            </div>

            <div className="row">
              <Field label={editing === 'new' ? 'Opening stock' : 'Current stock'}>
                <input type="number" step="1" value={form.stock} onChange={set('stock')}
                  placeholder="0" disabled={editing !== 'new'} />
              </Field>
              <Field label="Unit">
                <select value={form.unit} onChange={set('unit')}>
                  {['pcs', 'kg', 'g', 'litre', 'ml', 'box', 'pack', 'metre'].map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </Field>
              <Field label="Low-stock alert at" hint="Warns below this">
                <input type="number" step="1" min="0" value={form.lowStockAt} onChange={set('lowStockAt')} placeholder="0" />
              </Field>
            </div>

            <Field label="Supplier"><input value={form.supplier} onChange={set('supplier')} placeholder="Optional" /></Field>

            <label className="checkbox">
              <input type="checkbox" checked={form.active} onChange={set('active')} />
              Active — show this product on the billing screen
            </label>
          </form>
        </Modal>
      )}

      {viewing && (
        <Modal
          title={viewing.name}
          subtitle="Barcode preview"
          onClose={() => setViewing(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setViewing(null)}>Close</button>
              <button type="button" className="btn" onClick={() => { setViewing(null); printOne(viewing) }}>
                🖨 Print label
              </button>
            </>
          }
        >
          <div style={{ textAlign: 'center', padding: 20, background: '#fff', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div className="label-shop">{shop?.name}</div>
            <div style={{ fontWeight: 600, margin: '4px 0' }}>{viewing.name}</div>
            <Barcode value={viewing.barcode} height={60} width={2} />
            <div style={{ fontWeight: 700, marginTop: 6 }}>{money(viewing.price, currency)}</div>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete product"
          message={`“${deleting.name}” will be removed from your catalogue. Past sales that include it are not affected.`}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}

      {labelTarget && (
        <LabelSheetPortal
          shop={shop}
          currency={currency}
          items={[{ product: labelTarget.product, copies: labelTarget.copies }]}
        />
      )}
    </>
  )
}
