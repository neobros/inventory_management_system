import { useEffect, useRef, useState } from 'react'
import { useToast } from '../../context/ToastContext'
import { listShops } from '../../services/shops'
import { checkProductsToDelete, deleteProductsByIds } from '../../services/productDelete'
import { ConfirmDialog, Field, Loading, Stat } from '../../components/ui'
import { useLang, translate as tr } from '../../i18n/LanguageContext'

const SAMPLE = `[
  { "sku": "MTR-102042", "barcode": "891515307266" }
]`

/**
 * Paste a JSON list and delete the matching products from one shop.
 * Two steps on purpose: Check shows exactly what would go, Delete needs a
 * confirmation. Rows may be full product records — only sku and barcode count.
 */
export default function AdminDeleteProducts() {
  const toast = useToast()
  const { t } = useLang()
  const fileInput = useRef(null)

  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [shopId, setShopId] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState(null)       // result of step 1
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(null)         // result of step 2

  useEffect(() => {
    listShops()
      .then((list) => {
        setShops(list)
        if (list.length === 1) setShopId(list[0].id)
      })
      .catch(() => toast.error(tr('Could not load shops.')))
      .finally(() => setLoading(false))
  }, [toast])

  const reset = () => { setCheck(null); setDone(null) }

  let parsed = null
  let parseError = ''
  if (text.trim()) {
    try {
      parsed = JSON.parse(text)
      const rows = Array.isArray(parsed) ? parsed : parsed?.products
      if (!Array.isArray(rows)) parseError = t('JSON must be a list [ ... ] or { "products": [ ... ] }.')
    } catch (err) {
      parseError = t('Not valid JSON: {error}', { error: err.message })
    }
  }

  const loadFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setText(await file.text())
    reset()
  }

  const runCheck = async (e) => {
    e.preventDefault()
    if (!shopId) return toast.error(t('Choose a shop first.'))
    if (!parsed || parseError) return toast.error(parseError || t('Paste the JSON first.'))
    setBusy(true)
    reset()
    try {
      const result = await checkProductsToDelete(shopId, parsed)
      setCheck(result)
      if (!result.matches.length) toast.error(t('No matching products found — nothing to delete.'))
    } catch (err) {
      toast.error(err.message || t('Check failed.'))
    } finally {
      setBusy(false)
    }
    return undefined
  }

  const runDelete = async () => {
    setBusy(true)
    try {
      const ids = check.matches.map((m) => m.product.id)
      const deletedIds = await deleteProductsByIds(shopId, ids)
      const deleted = check.matches
        .filter((m) => deletedIds.includes(m.product.id))
        .map(({ index, product: p }) => ({ index, id: p.id, productName: p.name, sku: p.sku || '', barcode: p.barcode || '' }))
      setDone({
        ok: check.notFound.length === 0,
        shopId,
        received: check.received,
        deletedCount: deleted.length,
        notFoundCount: check.notFound.length,
        deleted,
        notFound: check.notFound,
      })
      setCheck(null)
      toast.success(t('{n} product(s) deleted.', { n: deleted.length }))
    } catch (err) {
      toast.error(err.message || t('Delete failed.'))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const copyJson = async (data, msg) => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    toast.success(msg)
  }

  if (loading) return <Loading label="Loading shops…" />

  const shopName = shops.find((s) => s.id === shopId)?.name || shopId

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-2" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px', alignItems: 'start' }}>
        <form className="card" onSubmit={runCheck}>
          <div className="card-head">
            <h2>{t('Delete products')}</h2>
            <button type="submit" className="btn spacer" disabled={busy || !shopId || !parsed || !!parseError}>
              {busy && !confirming && <span className="spinner" />} {t('Check list')}
            </button>
          </div>
          <div className="card-body">
            <Field label={t('Shop')} required>
              <select value={shopId} onChange={(e) => { setShopId(e.target.value); reset() }} required>
                <option value="">{t('Choose a shop…')}</option>
                {shops.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
              </select>
            </Field>

            <Field label={t('Products to delete (JSON)')} required hint={t('Paste the list, or load a .json file.')}>
              <textarea className="mono" value={text} rows={14} spellCheck={false} placeholder={SAMPLE}
                onChange={(e) => { setText(e.target.value); reset() }} style={{ fontSize: 12.5 }} />
            </Field>

            <div className="row" style={{ flex: 'none', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 'none' }}
                onClick={() => fileInput.current?.click()}>{t('Load .json file')}</button>
              {text && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 'none' }}
                  onClick={() => { setText(''); reset() }}>{t('Clear')}</button>
              )}
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={loadFile} />
            </div>

            {parseError && <div className="alert alert-red mt-3"><span>!</span><span>{parseError}</span></div>}
          </div>
        </form>

        <div className="card">
          <div className="card-head"><h3>{t('How matching works')}</h3></div>
          <div className="card-body text-sm" style={{ color: 'var(--text-2)' }}>
            <p style={{ marginTop: 0 }}>{t('A JSON list. Each row needs a')} <code>sku</code>, <code>barcode</code>, {t('or both:')}</p>
            <pre className="mono" style={preStyle}>{SAMPLE}</pre>
            <ul style={{ paddingLeft: 18, display: 'grid', gap: 6 }}>
              <li><strong>{t('Both given:')}</strong> {t('both must belong to the same product, or the row is skipped.')}</li>
              <li><strong>{t('One given:')}</strong> {t('matched on that one.')}</li>
              <li>{t('Full product records work too — other fields are ignored.')}</li>
              <li><strong>{t('Check list')}</strong> {t('changes nothing. You see what would be deleted first.')}</li>
            </ul>
            <div className="alert alert-amber" style={{ marginBottom: 0 }}>
              <span>!</span>
              <span>{t('A delete cannot be undone. Past sales and stock history are kept.')}</span>
            </div>
          </div>
        </div>
      </div>

      {check && (
        <>
          <div className="grid grid-3">
            <Stat label={t('Rows checked')} value={check.received} icon="📄" tone="blue" />
            <Stat label={t('Will be deleted')} value={check.matches.length} icon="🗑️" tone={check.matches.length ? 'red' : 'green'} />
            <Stat label={t('Not found / skipped')} value={check.notFound.length} icon="❔" tone={check.notFound.length ? 'amber' : 'green'} />
          </div>

          {check.matches.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h3>{t('Will be deleted from {shop}', { shop: shopName })}</h3>
                <button type="button" className="btn btn-danger spacer" disabled={busy} onClick={() => setConfirming(true)}>
                  {t('🗑 Delete {n} product(s)', { n: check.matches.length })}
                </button>
              </div>
              <ProductTable rows={check.matches.map(({ index, product: p }) => ({
                key: p.id, index, name: p.name, sku: p.sku, barcode: p.barcode, extra: `${p.stock ?? 0} ${p.unit || ''}`,
              }))} extraLabel={t('Stock')} />
            </div>
          )}

          {check.notFound.length > 0 && <NotFound rows={check.notFound} onCopy={() => copyJson(check.notFound, t('Copied as JSON.'))} />}
        </>
      )}

      {done && (
        <>
          <div className="grid grid-3">
            <Stat label={t('Rows checked')} value={done.received} icon="📄" tone="blue" />
            <Stat label={t('Deleted')} value={done.deletedCount} icon="✅" tone="green" />
            <Stat label={t('Not found / skipped')} value={done.notFoundCount} icon="❔" tone={done.notFoundCount ? 'amber' : 'green'} />
          </div>
          <div className="card">
            <div className="card-head">
              <h3>{t('Deleted')}</h3>
              <button type="button" className="btn btn-ghost btn-sm spacer" onClick={() => copyJson(done, t('Result copied as JSON.'))}>
                {t('Copy result as JSON')}
              </button>
            </div>
            <ProductTable rows={done.deleted.map((d) => ({ key: d.id, index: d.index, name: d.productName, sku: d.sku, barcode: d.barcode }))} />
          </div>
          {done.notFound.length > 0 && <NotFound rows={done.notFound} onCopy={() => copyJson(done.notFound, t('Copied as JSON.'))} />}
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title={t('Delete {n} product(s)?', { n: check.matches.length })}
          message={t('They will be removed from {shop} for good. This cannot be undone.', { shop: shopName })}
          confirmLabel={t('Delete')}
          busy={busy}
          onConfirm={runDelete}
          onClose={() => !busy && setConfirming(false)}
        />
      )}
    </div>
  )
}

function ProductTable({ rows, extraLabel }) {
  const { t } = useLang()
  return (
    <div className="card-body tight table-wrap">
      <table>
        <thead>
          <tr><th className="num">{t('Row')}</th><th>{t('Product')}</th><th>SKU</th><th>{t('Barcode')}</th>{extraLabel && <th className="num">{extraLabel}</th>}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="num">{r.index + 1}</td>
              <td className="cell-title">{r.name || '—'}</td>
              <td className="mono text-sm">{r.sku || '—'}</td>
              <td className="mono text-sm">{r.barcode || '—'}</td>
              {extraLabel && <td className="num">{r.extra}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NotFound({ rows, onCopy }) {
  const { t } = useLang()
  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('Not found / skipped — not deleted')}</h3>
        <button type="button" className="btn btn-ghost btn-sm spacer" onClick={onCopy}>{t('Copy as JSON')}</button>
      </div>
      <div className="card-body tight table-wrap">
        <table>
          <thead><tr><th className="num">{t('Row')}</th><th>SKU</th><th>{t('Barcode')}</th><th>{t('Why')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.index}>
                <td className="num">{r.index + 1}</td>
                <td className="mono text-sm">{r.sku || '—'}</td>
                <td className="mono text-sm">{r.barcode || '—'}</td>
                <td style={{ color: 'var(--amber)' }}>{r.reasons.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const preStyle = {
  margin: 0,
  padding: 10,
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 11.5,
  overflowX: 'auto',
  whiteSpace: 'pre',
}
