import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { listProducts } from '../services/products'
import { printPortal, nextFrame, portalReady } from '../utils/print'
import { Empty, Field, Loading } from '../components/ui'
import { money } from '../utils/format'

// Real page margins: the shared print rule sets margin 0, which is right for
// receipts but would run a multi-page list into the paper edge.
const A4_CSS = '@page { size: A4 portrait; margin: 12mm 10mm; }'

/**
 * Printable A4 sheet of the shop's products. Default is cut-out blocks — name on
 * line 1, SKU on line 2 — laid out several across; a numbered table is the
 * alternative. For shop owners and managers.
 */
export default function ItemList() {
  const { shopId, shop, currency } = useAuth()
  const toast = useToast()

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(false)
  const [printing, setPrinting] = useState(false)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [groupByCategory, setGroupByCategory] = useState(false)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [extra, setExtra] = useState({ barcode: false, category: false, price: false, stock: false })
  const [style, setStyle] = useState('cards')
  const [columns, setColumns] = useState(3)
  const [showHeading, setShowHeading] = useState(false)

  useEffect(() => {
    if (!shopId) { setProducts([]); return }
    setLoading(true)
    listProducts(shopId)
      .then(setProducts)
      .catch(() => toast.error('Could not load products.'))
      .finally(() => setLoading(false))
  }, [shopId, toast])

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [products]
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = products.filter((p) => {
      if (!includeInactive && p.active === false) return false
      if (category && p.category !== category) return false
      if (!q) return true
      return (p.name || '').toLowerCase().includes(q)
        || (p.sku || '').toLowerCase().includes(q)
        || (p.barcode || '').includes(q)
    })
    const key = (p) => String(p[sortBy] || '').toLowerCase()
    return list.sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }))
  }, [products, search, category, sortBy, includeInactive])

  // [[heading, rows]] — one untitled group unless grouping is on.
  const groups = useMemo(() => {
    if (!groupByCategory) return [['', rows]]
    const map = new Map()
    rows.forEach((p) => {
      const g = p.category || 'Uncategorised'
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(p)
    })
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [rows, groupByCategory])

  const toggle = (key) => () => setExtra((e) => ({ ...e, [key]: !e[key] }))

  const doPrint = async () => {
    if (!rows.length) return toast.error('Nothing to print.')
    setPrinting(true)
    try {
      await nextFrame()
      if (!(await portalReady())) return toast.error('The list did not render — nothing was printed.')
      await printPortal('A4', A4_CSS)
    } finally {
      setPrinting(false)
    }
    return undefined
  }

  const sheet = (
    <ItemSheet shop={shop} groups={groups} count={rows.length} extra={extra} currency={currency}
      style={style} columns={columns} showHeading={showHeading}
      filterNote={[category && `Category: ${category}`, search && `Search: "${search}"`].filter(Boolean).join(' · ')} />
  )

  return (
    <div className="grid" style={{ gridTemplateColumns: '320px minmax(0,1fr)', alignItems: 'start', gap: 16 }}>
      <div className="card">
        <div className="card-head"><h3>What to print</h3></div>
        <div className="card-body">
          <Field label="Search">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, SKU or barcode" />
          </Field>

          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          <Field label="Sort by">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="name">Product name</option>
              <option value="sku">SKU / item code</option>
            </select>
          </Field>

          <Field label="Print as">
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="cards">Cut-out blocks (name, then SKU)</option>
              <option value="table">Table with row numbers</option>
            </select>
          </Field>

          {style === 'cards' && (
            <Field label="Blocks across the page">
              <select value={columns} onChange={(e) => setColumns(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} across</option>)}
              </select>
            </Field>
          )}

          <Field label="Also show" hint="Name and SKU are always printed.">
            <div style={{ display: 'grid', gap: 6 }}>
              <label className="checkbox"><input type="checkbox" checked={extra.barcode} onChange={toggle('barcode')} /> Barcode</label>
              <label className="checkbox"><input type="checkbox" checked={extra.category} onChange={toggle('category')} /> Category</label>
              <label className="checkbox"><input type="checkbox" checked={extra.price} onChange={toggle('price')} /> Selling price</label>
              <label className="checkbox"><input type="checkbox" checked={extra.stock} onChange={toggle('stock')} /> Stock</label>
            </div>
          </Field>

          <Field label="Layout">
            <div style={{ display: 'grid', gap: 6 }}>
              <label className="checkbox">
                <input type="checkbox" checked={groupByCategory} onChange={(e) => setGroupByCategory(e.target.checked)} />
                Group by category
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={showHeading} onChange={(e) => setShowHeading(e.target.checked)} />
                Shop name and date at the top
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
                Include inactive products
              </label>
            </div>
          </Field>

          <button type="button" className="btn btn-block" onClick={doPrint} disabled={printing || !rows.length}>
            {printing && <span className="spinner" />} 🖨 Print {rows.length || ''} items (A4)
          </button>
          <p className="text-sm mt-2" style={{ color: 'var(--text-3)', marginBottom: 0 }}>
            Choose “Save as PDF” in the print dialog to get a file instead.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Preview</h3>
          <span className="spacer text-sm" style={{ color: 'var(--text-3)' }}>{rows.length} items</span>
        </div>
        <div className="card-body" style={{ background: 'var(--surface-2)', overflowX: 'auto' }}>
          {shopId && loading && <Loading label="Loading products…" />}
          {shopId && !loading && !rows.length && (
            <Empty icon="📦" title="No products" message="Nothing matches — clear the filters or add products." />
          )}
          {shopId && !loading && rows.length > 0 && (
            <div className="item-sheet-preview">{sheet}</div>
          )}
        </div>
      </div>

      {printing && document.getElementById('print-portal') && createPortal(sheet, document.getElementById('print-portal'))}
    </div>
  )
}

function ItemSheet({ shop, groups, count, extra, currency, filterNote, style, columns, showHeading }) {
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  let n = 0

  const heading = showHeading && (
    <div className="item-sheet-head">
      <div>
        <div className="item-sheet-title">{shop?.name || 'Product list'}</div>
        <div className="item-sheet-sub">Item list · {count} items{filterNote ? ` · ${filterNote}` : ''}</div>
      </div>
      <div className="item-sheet-sub">{date}</div>
    </div>
  )

  if (style === 'cards') {
    return (
      <div className="item-sheet">
        {heading}
        {groups.map(([title, items]) => (
          <div key={title || 'all'}>
            {title && <div className="item-card-group">{title} <span>({items.length})</span></div>}
            <div className="item-cards" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {items.map((p) => {
                const more = [
                  extra.barcode && p.barcode,
                  extra.category && p.category,
                  extra.price && money(p.price, currency),
                  extra.stock && `Stock ${p.stock ?? 0} ${p.unit || ''}`.trim(),
                ].filter(Boolean)
                return (
                  <div key={p.id} className="item-card">
                    <div className="item-card-name">{p.name}</div>
                    <div className="item-card-sku">{p.sku || '—'}</div>
                    {more.length > 0 && <div className="item-card-more">{more.join(' · ')}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="item-sheet">
      {heading}

      <table className="item-sheet-table">
        <thead>
          <tr>
            <th className="c-no">#</th>
            <th>Product name</th>
            <th className="c-sku">SKU / item code</th>
            {extra.barcode && <th className="c-code">Barcode</th>}
            {extra.category && <th>Category</th>}
            {extra.price && <th className="c-num">Price</th>}
            {extra.stock && <th className="c-num">Stock</th>}
          </tr>
        </thead>
        {groups.map(([title, items]) => (
          <tbody key={title || 'all'}>
            {title && (
              <tr className="item-sheet-group">
                <td colSpan={7}>{title} <span>({items.length})</span></td>
              </tr>
            )}
            {items.map((p) => {
              n += 1
              return (
                <tr key={p.id}>
                  <td className="c-no">{n}</td>
                  <td>{p.name}</td>
                  <td className="c-sku">{p.sku || '—'}</td>
                  {extra.barcode && <td className="c-code">{p.barcode || '—'}</td>}
                  {extra.category && <td>{p.category || '—'}</td>}
                  {extra.price && <td className="c-num">{money(p.price, currency)}</td>}
                  {extra.stock && <td className="c-num">{p.stock ?? 0} {p.unit || ''}</td>}
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
    </div>
  )
}
