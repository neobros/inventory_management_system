import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { listProducts } from '../services/products'
import { printLabels, nextFrame, portalReady } from '../utils/print'
import { isDesktop, saveLabelsPdf, revealFile } from '../utils/desktop'
import { Empty, Loading, Field } from '../components/ui'
import Pagination, { usePagination } from '../components/Pagination'
import LabelSheetPortal, { LabelCell, LABEL_SIZES, BAR_WIDTHS, barMm } from '../components/LabelSheet'

/**
 * Batch barcode label printing: pick products, set how many stickers each
 * needs, preview the sheet, print.
 */
export default function Labels() {
  const { shopId, shop, currency } = useAuth()
  const toast = useToast()

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [copies, setCopies] = useState({})       // productId -> count
  const [size, setSize] = useState('small')
  const [showName, setShowName] = useState(true)
  const [showPrice, setShowPrice] = useState(true)
  const [showShop, setShowShop] = useState(true)

  // Remembered per till: once a shop finds the narrowest width its scanner reads,
  // it should not have to set it again every time.
  const [barWidth, setBarWidthState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('sp-label-bar-width'))
      return BAR_WIDTHS.some((b) => b.value === saved) ? saved : 0
    } catch {
      return 0
    }
  })
  const setBarWidth = (v) => {
    setBarWidthState(v)
    try { localStorage.setItem('sp-label-bar-width', String(v)) } catch { /* private mode */ }
  }
  const barStep = BAR_WIDTHS.find((b) => b.value === barWidth) || BAR_WIDTHS[0]
  // What actually prints: the override, or the chosen label size's own width.
  const effectiveBar = barWidth || (LABEL_SIZES[size] || LABEL_SIZES.small).barWidth
  const [printing, setPrinting] = useState(false)
  const [savedPath, setSavedPath] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setProducts(await listProducts(shopId))
    } catch {
      toast.error('Could not load products.')
    } finally {
      setLoading(false)
    }
  }, [shopId, toast])

  useEffect(() => { load() }, [load])

  const setCount = (id, value) => {
    const n = Math.max(0, Math.min(Number(value) || 0, 200))
    setCopies((c) => ({ ...c, [id]: n }))
  }

  const selected = useMemo(
    () => products
      .filter((p) => (copies[p.id] || 0) > 0 && p.barcode)
      .map((p) => ({ product: p, copies: copies[p.id] })),
    [products, copies]
  )

  const totalLabels = selected.reduce((sum, s) => sum + s.copies, 0)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').includes(q)
    )
  }, [products, search])

  /** Writes the sheet to Downloads as an A4 PDF. */
  const doDownload = async () => {
    if (!totalLabels) return toast.error('Set a label count on at least one product.')

    setPrinting(true)
    setSavedPath('')
    try {
      // The sheet is rendered into the print portal; wait for it to commit.
      await nextFrame()
      if (!(await portalReady())) {
        toast.error('The label sheet did not render.')
        return
      }

      const result = await saveLabelsPdf({
        columns: LABEL_SIZES[size].columns,
        fileName: `barcode-labels-${new Date().toISOString().slice(0, 10)}`,
      })

      if (!result.ok) {
        toast.error(result.error || 'Could not save the PDF.')
        return
      }
      setSavedPath(result.path)
      toast.success('Saved to your Downloads folder.')
    } finally {
      setPrinting(false)
    }
    return undefined
  }

  /** Browser fallback — the print dialog offers "Save as PDF". */
  const doPrint = async () => {
    if (!totalLabels) return toast.error('Set a label count on at least one product.')
    setPrinting(true)
    try {
      if (!(await printLabels(LABEL_SIZES[size].columns))) {
        toast.error('The label sheet did not render — nothing was sent to the printer.')
      }
    } finally {
      setPrinting(false)
    }
    return undefined
  }

  const fillFromStock = () => {
    const next = {}
    products.forEach((p) => { if (p.stock > 0) next[p.id] = Math.min(p.stock, 200) })
    setCopies(next)
    toast.info('Label counts set to match current stock.')
  }

  const pager = usePagination(rows)
  if (loading) return <Loading label="Loading products…" />

  const previewItems = selected.slice(0, 3)

  return (
    <>
      <div className="grid grid-2 mb-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px', alignItems: 'start' }}>
        <div className="card">
          <div className="card-head">
            <div className="search-box">
              <span className="ico">🔍</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" />
            </div>
            <div className="spacer flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={fillFromStock}>Match stock</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCopies({})}>Clear</button>
            </div>
          </div>
          <div className="card-body tight">
            {rows.length === 0 ? (
              <Empty icon="🏷️" title="No products" message="Add products before printing labels." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Barcode</th>
                      <th className="num">In stock</th>
                      <th className="num" style={{ width: 120 }}>Labels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pager.slice.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="cell-title">{p.name}</div>
                          <div className="cell-sub">{p.category || 'Uncategorised'}</div>
                        </td>
                        <td className="mono text-sm">{p.barcode || <span className="text-red">missing</span>}</td>
                        <td className="num">{p.stock ?? 0}</td>
                        <td className="num">
                          <input
                            type="number" min="0" max="200"
                            value={copies[p.id] || ''}
                            onChange={(e) => setCount(p.id, e.target.value)}
                            placeholder="0"
                            disabled={!p.barcode}
                            style={{ textAlign: 'right' }}
                          />
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

        <div className="card" style={{ position: 'sticky', top: 76 }}>
          <div className="card-head"><h2>Label setup</h2></div>
          <div className="card-body">
            <Field label="Label size">
              <select value={size} onChange={(e) => setSize(e.target.value)}>
                {Object.entries(LABEL_SIZES).map(([key, v]) => (
                  <option key={key} value={key}>{v.label}</option>
                ))}
              </select>
            </Field>

            <Field
              label="Barcode width"
              hint={`Bars ${barMm(effectiveBar).toFixed(2)}mm thick. Narrower bars are harder to scan.`}
            >
              <select value={barWidth} onChange={(e) => setBarWidth(Number(e.target.value))}>
                {BAR_WIDTHS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.value ? `${b.label} — ${barMm(b.value).toFixed(2)}mm bars` : b.label}
                  </option>
                ))}
              </select>
            </Field>

            {barStep.risk !== 'none' && (
              <div className={`alert ${barStep.risk === 'high' ? 'alert-red' : 'alert-amber'}`}
                style={{ marginTop: -6, marginBottom: 14 }}>
                <span>!</span>
                <span>
                  {barStep.risk === 'high'
                    ? 'Many scanners cannot read bars this thin. '
                    : 'Some scanners struggle with bars this thin. '}
                  Print one label and scan it before printing a full sheet.
                </span>
              </div>
            )}

            <div className="field">
              <label>Show on label</label>
              <label className="checkbox mb-3">
                <input type="checkbox" checked={showShop} onChange={(e) => setShowShop(e.target.checked)} /> Shop name
              </label>
              <label className="checkbox mb-3">
                <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} /> Product name
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Price
              </label>
            </div>

            {previewItems.length > 0 && (
              <div className="field">
                <label>Preview</label>
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                  {previewItems.map(({ product }) => (
                    <LabelCell
                      key={product.id}
                      product={product}
                      shop={shop}
                      currency={currency}
                      size={size}
                      showName={showName}
                      showPrice={showPrice}
                      showShop={showShop}
                      barWidth={barWidth}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="alert alert-blue mb-4">
              <span>🖨</span>
              <span>
                Print at 100% scale with margins set to “None” so the barcodes keep their
                exact width — scanners are sensitive to this.
              </span>
            </div>

            <div className="totals-row grand" style={{ fontSize: 16 }}>
              <span>Labels</span>
              <span>{totalLabels}</span>
            </div>

            {isDesktop() ? (
              <>
                <button type="button" className="btn btn-lg btn-block mt-3" onClick={doDownload}
                  disabled={!totalLabels || printing}>
                  {printing && <span className="spinner" />} ⬇ Download A4 PDF
                  {totalLabels ? ` (${totalLabels} labels)` : ''}
                </button>

                {savedPath && (
                  <div className="alert alert-blue mt-3" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                    <span style={{ wordBreak: 'break-all' }}>Saved to <strong>{savedPath}</strong></span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => revealFile(savedPath)}>
                      Open folder
                    </button>
                  </div>
                )}

                <button type="button" className="btn btn-ghost btn-block mt-2" onClick={doPrint}
                  disabled={!totalLabels || printing}>
                  🖨 Print instead
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-lg btn-block mt-3" onClick={doPrint}
                disabled={!totalLabels || printing}>
                {printing && <span className="spinner" />} 🖨 Print {totalLabels || ''} labels
              </button>
            )}
          </div>
        </div>
      </div>

      <LabelSheetPortal
        items={selected}
        shop={shop}
        currency={currency}
        size={size}
        options={{ showName, showPrice, showShop, barWidth }}
      />
    </>
  )
}
