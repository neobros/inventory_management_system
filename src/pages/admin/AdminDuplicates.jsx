import { useEffect, useState } from 'react'
import { useToast } from '../../context/ToastContext'
import { listShops } from '../../services/shops'
import { listProducts } from '../../services/products'
import { deleteProductsByIds } from '../../services/productDelete'
import { findDuplicates } from '../../utils/productDuplicates'
import { formatDate, money } from '../../utils/format'
import { ConfirmDialog, Empty, Field, Loading, Stat } from '../../components/ui'
import { useLang, translate as tr } from '../../i18n/LanguageContext'

const ALL = '__all__'

const KINDS = [
  { key: 'sku', label: 'Same SKU / item code', tone: 'red', serious: true },
  { key: 'barcode', label: 'Same barcode', tone: 'red', serious: true },
  { key: 'name', label: 'Same product name', tone: 'amber', serious: false },
]

/**
 * Scans a shop (or every shop) for products that share a SKU, barcode or name.
 * SKU and barcode clashes are real problems — the till cannot tell the items
 * apart. Same-name rows are only shown for review.
 */
export default function AdminDuplicates() {
  const toast = useToast()
  const { t } = useLang()

  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [shopId, setShopId] = useState('')
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState(null)   // [{ shop, total, dup }]
  const [deleting, setDeleting] = useState(null) // { shop, product }
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listShops()
      .then((list) => {
        setShops(list)
        setShopId(list.length === 1 ? list[0].id : ALL)
      })
      .catch(() => toast.error(tr('Could not load shops.')))
      .finally(() => setLoading(false))
  }, [toast])

  const scan = async () => {
    setScanning(true)
    setResults(null)
    try {
      const targets = shopId === ALL ? shops : shops.filter((s) => s.id === shopId)
      const out = []
      for (const shop of targets) {
        // eslint-disable-next-line no-await-in-loop -- one shop at a time keeps reads gentle
        const products = await listProducts(shop.id)
        out.push({ shop, total: products.length, dup: findDuplicates(products) })
      }
      setResults(out)
      const bad = out.reduce((n, r) => n + r.dup.sku.length + r.dup.barcode.length, 0)
      if (bad) toast.error(t('{n} duplicate SKU/barcode group(s) found.', { n: bad }))
      else toast.success(t('No duplicate SKUs or barcodes.'))
    } catch (err) {
      toast.error(err.message || t('Scan failed.'))
    } finally {
      setScanning(false)
    }
  }

  const removeOne = async () => {
    setBusy(true)
    try {
      await deleteProductsByIds(deleting.shop.id, [deleting.product.id])
      toast.success(t('Deleted "{name}".', { name: deleting.product.name }))
      // Re-run the check for that shop so the groups reflect the delete.
      const products = await listProducts(deleting.shop.id)
      setResults((rs) => rs.map((r) => (r.shop.id === deleting.shop.id
        ? { ...r, total: products.length, dup: findDuplicates(products) } : r)))
      setDeleting(null)
    } catch (err) {
      toast.error(err.message || t('Delete failed.'))
    } finally {
      setBusy(false)
    }
  }

  const copyJson = async () => {
    const data = results.map(({ shop, total, dup }) => ({
      shopId: shop.id,
      shopName: shop.name || '',
      products: total,
      ...Object.fromEntries(KINDS.map(({ key }) => [key, dup[key].map((g) => ({
        value: g.key,
        count: g.products.length,
        products: g.products.map((p) => ({ id: p.id, productName: p.name, sku: p.sku || '', barcode: p.barcode || '' })),
      }))])),
    }))
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    toast.success(t('Report copied as JSON.'))
  }

  if (loading) return <Loading label="Loading shops…" />
  if (!shops.length) return <Empty icon="🏬" title={t('No shops yet')} message={t('Create a shop first.')} />

  const totals = results && {
    products: results.reduce((n, r) => n + r.total, 0),
    sku: results.reduce((n, r) => n + r.dup.sku.length, 0),
    barcode: results.reduce((n, r) => n + r.dup.barcode.length, 0),
    name: results.reduce((n, r) => n + r.dup.name.length, 0),
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="card-head">
          <h2>{t('Check for duplicate products')}</h2>
          {results && (
            <button type="button" className="btn btn-ghost btn-sm spacer" onClick={copyJson}>{t('Copy report as JSON')}</button>
          )}
        </div>
        <div className="card-body">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label={t('Shop')}>
              <select value={shopId} onChange={(e) => { setShopId(e.target.value); setResults(null) }}>
                <option value={ALL}>{t('All shops ({n})', { n: shops.length })}</option>
                {shops.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
              </select>
            </Field>
            <div style={{ flex: 'none', marginBottom: 14 }}>
              <button type="button" className="btn" onClick={scan} disabled={scanning}>
                {scanning && <span className="spinner" />} {t('🔍 Check now')}
              </button>
            </div>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-3)', margin: 0 }}>
            {t('Each shop is checked on its own — the same SKU in two different shops is fine. SKU letter case and extra spaces are ignored.')}
          </p>
        </div>
      </div>

      {totals && (
        <div className="grid grid-4">
          <Stat label={t('Products checked')} value={totals.products} icon="📦" tone="blue" />
          <Stat label={t('Duplicate SKUs')} value={totals.sku} icon="🔁" tone={totals.sku ? 'red' : 'green'} />
          <Stat label={t('Duplicate barcodes')} value={totals.barcode} icon="▮▯▮" tone={totals.barcode ? 'red' : 'green'} />
          <Stat label={t('Same names')} value={totals.name} icon="📝" tone={totals.name ? 'amber' : 'green'} foot={t('For review only')} />
        </div>
      )}

      {results && results.map(({ shop, total, dup }) => {
        const any = dup.sku.length || dup.barcode.length || dup.name.length
        return (
          <div className="card" key={shop.id}>
            <div className="card-head">
              <h3>{shop.name || shop.id}</h3>
              <span className="spacer text-sm" style={{ color: 'var(--text-3)' }}>{t('{n} products', { n: total })}</span>
              {!any && <span className="badge badge-green">{t('No duplicates')}</span>}
            </div>
            {any > 0 && (
              <div className="card-body" style={{ display: 'grid', gap: 18 }}>
                {KINDS.filter(({ key }) => dup[key].length).map(({ key, label, tone, serious }) => (
                  <div key={key}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <span className={`badge badge-${tone}`}>{t(label)}</span>
                      <span className="text-sm" style={{ color: 'var(--text-3)' }}>
                        {t('{n} group(s)', { n: dup[key].length })}
                        {!serious && t(' — may be fine if they are different sizes or colours')}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {dup[key].map((g) => (
                        <Group key={g.key} group={g} kind={key} currency={shop.currency}
                          onDelete={(product) => setDeleting({ shop, product })} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {deleting && (
        <ConfirmDialog
          title={t('Delete "{name}"?', { name: deleting.product.name })}
          message={t('SKU {sku} · barcode {barcode} · stock {stock}. It will be removed from {shop} for good. Past sales and stock history are kept.', {
            sku: deleting.product.sku || '—', barcode: deleting.product.barcode || '—',
            stock: deleting.product.stock ?? 0, shop: deleting.shop.name || deleting.shop.id,
          })}
          confirmLabel={t('Delete')}
          busy={busy}
          onConfirm={removeOne}
          onClose={() => !busy && setDeleting(null)}
        />
      )}
    </div>
  )
}

function Group({ group, kind, currency, onDelete }) {
  const { t } = useLang()
  const shown = kind === 'barcode' ? group.key : group.products[0][kind === 'sku' ? 'sku' : 'name']
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div className="text-sm" style={{ padding: '7px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
        <strong className={kind === 'name' ? '' : 'mono'}>{shown}</strong>
        <span style={{ color: 'var(--text-3)' }}>{t(' — used by {n} products', { n: group.products.length })}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>{t('Product')}</th><th>SKU</th><th>{t('Barcode')}</th><th className="num">{t('Price')}</th><th className="num">{t('Stock')}</th><th>{t('Added')}</th><th className="num" /></tr>
          </thead>
          <tbody>
            {group.products.map((p) => (
              <tr key={p.id}>
                <td className="cell-title">
                  {p.name}
                  {p.active === false && <span className="badge badge-grey" style={{ marginLeft: 6 }}>{t('Inactive')}</span>}
                </td>
                <td className="mono text-sm">{p.sku || '—'}</td>
                <td className="mono text-sm">{p.barcode || '—'}</td>
                <td className="num">{money(p.price, currency || 'Rs.')}</td>
                <td className="num">{p.stock ?? 0}</td>
                <td className="text-sm nowrap">{formatDate(p.createdAt, false)}</td>
                <td className="num">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDelete(p)}>{t('Delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
