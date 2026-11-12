import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { listShops } from '../../services/shops'
import { importProducts } from '../../services/productImport'
import { Field, Loading, Stat } from '../../components/ui'
import { useLang, translate as tr } from '../../i18n/LanguageContext'

const SAMPLE = `[
  {
    "productName": "MASON TROWEL R/G 4\\" POINT",
    "sku": "MTR-102041",
    "category": "Hand Tools",
    "barcode": "912434284721",
    "costPrice": 395.0,
    "sellingPrice": 1896.0,
    "openingStock": 6,
    "unit": "pcs",
    "lowStockAlertAt": 5,
    "supplier": "BR & DC Distributors"
  }
]`

const SAMPLE_WITH_IDS = `{
  "categories": { "1": "Hand Tools" },
  "products": [
    { "productName": "...", "categoryId": 1, "sellingPrice": 1896.0 }
  ]
}`

// Mirrors the checks in src/utils/productImport.js.
const FIELDS = [
  ['productName', 'text', 'Required', 'Product name, up to 200 characters'],
  ['sellingPrice', 'number', 'Required', 'Price charged at the till, 0 or more'],
  ['sku', 'text', 'Optional', 'Must be unique in the shop'],
  ['barcode', 'text', 'Optional', '4–48 letters/digits, unique. Left empty → one is generated'],
  ['costPrice', 'number', 'Optional', 'What you pay the supplier. Default 0'],
  ['openingStock', 'number', 'Optional', 'Starting quantity. Whole number for pcs/box/pack; decimals OK for kg, g, litre, ml, meter, feet, yard. Default 0'],
  ['lowStockAlertAt', 'number', 'Optional', 'Warn when stock falls to this. Same rule as openingStock. Default 0'],
  ['unit', 'text', 'Optional', 'pcs, kg, g, litre, ml, box, pack, meter, feet, yard. Default pcs'],
  ['category', 'text', 'Optional', 'Category name — created if new'],
  ['categoryId', 'number', 'Optional', 'Only with a "categories" map (see below) or an existing category'],
  ['supplier', 'text', 'Optional', 'Supplier name'],
]

/**
 * Paste or upload a JSON list of products and add them to one shop in a single
 * go, using the signed-in admin's own Firebase login. Valid rows are saved and
 * every rejected row comes back with its reasons.
 */
export default function AdminImport() {
  const { profile } = useAuth()
  const toast = useToast()
  const { t } = useLang()
  const fileInput = useRef(null)

  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [shopId, setShopId] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState(null)

  useEffect(() => {
    listShops()
      .then((list) => {
        setShops(list)
        if (list.length === 1) setShopId(list[0].id)
      })
      .catch(() => toast.error(tr('Could not load shops.')))
      .finally(() => setLoading(false))
  }, [toast])

  // Parsed here first so a typo is pointed out before anything is sent.
  let parsed = null
  let parseError = ''
  let rowCount = 0
  if (text.trim()) {
    try {
      parsed = JSON.parse(text)
      const rows = Array.isArray(parsed) ? parsed : parsed?.products
      if (!Array.isArray(rows)) parseError = t('JSON must be a list [ ... ] or { "products": [ ... ] }.')
      else rowCount = rows.length
    } catch (err) {
      parseError = t('Not valid JSON: {error}', { error: err.message })
    }
  }

  const loadFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setText(await file.text())
    setReport(null)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!shopId) return toast.error(t('Choose a shop first.'))
    if (!parsed || parseError) return toast.error(parseError || t('Paste the product JSON first.'))

    setBusy(true)
    setReport(null)
    try {
      const result = await importProducts(shopId, parsed, profile?.email || 'admin-import')
      setReport(result)
      if (result.rejectedCount === 0) toast.success(t('{n} products added.', { n: result.createdCount }))
      else if (result.createdCount > 0) toast.error(t('{added} added, {rejected} rejected.', { added: result.createdCount, rejected: result.rejectedCount }))
      else toast.error(t('Nothing added — all {n} rows were rejected.', { n: result.rejectedCount }))
    } catch (err) {
      toast.error(err.message || t('Import failed.'))
    } finally {
      setBusy(false)
    }
    return undefined
  }

  const copyRejected = async () => {
    const rows = report.rejected.map((r) => r.data)
    await navigator.clipboard.writeText(JSON.stringify(rows, null, 2))
    toast.success(t('Rejected rows copied — fix them and paste back in.'))
  }

  if (loading) return <Loading label="Loading shops…" />

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-2" style={{ gridTemplateColumns: 'minmax(0,1fr) 400px', alignItems: 'start' }}>
        <form className="card" onSubmit={submit}>
          <div className="card-head">
            <h2>{t('Import products')}</h2>
            <button type="submit" className="btn spacer" disabled={busy || !shopId || !parsed || !!parseError}>
              {busy && <span className="spinner" />} {rowCount ? t('Submit {n} rows', { n: rowCount }) : t('Submit')}
            </button>
          </div>

          <div className="card-body">
            <Field label={t('Shop')} required>
              <select value={shopId} onChange={(e) => { setShopId(e.target.value); setReport(null) }} required>
                <option value="">{t('Choose a shop…')}</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>{s.name || s.id}</option>
                ))}
              </select>
            </Field>

            <Field label={t('Product JSON')} required hint={t('Paste the list, or load a .json file.')}>
              <textarea
                className="mono"
                value={text}
                onChange={(e) => { setText(e.target.value); setReport(null) }}
                rows={18}
                spellCheck={false}
                placeholder={SAMPLE}
                style={{ fontSize: 12.5 }}
              />
            </Field>

            <div className="row" style={{ flex: 'none', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 'none' }}
                onClick={() => fileInput.current?.click()}>{t('Load .json file')}</button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 'none' }}
                onClick={() => { setText(SAMPLE); setReport(null) }}>{t('Insert example')}</button>
              {text && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 'none' }}
                  onClick={() => { setText(''); setReport(null) }}>{t('Clear')}</button>
              )}
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={loadFile} />
            </div>

            {parseError && (
              <div className="alert alert-red mt-3"><span>!</span><span>{parseError}</span></div>
            )}
            {!parseError && rowCount > 0 && (
              <p className="text-sm mt-3" style={{ color: 'var(--text-2)' }}>
                {t('{n} row(s) ready to send.', { n: rowCount })}
              </p>
            )}
          </div>
        </form>

        <div className="card">
          <div className="card-head"><h3>{t('Required format')}</h3></div>
          <div className="card-body text-sm" style={{ color: 'var(--text-2)' }}>
            <p style={{ marginTop: 0 }}>{t('A JSON list, one object per product:')}</p>
            <pre className="mono" style={preStyle}>{SAMPLE}</pre>

            <div className="table-wrap mt-3">
              <table>
                <thead><tr><th>{t('Field')}</th><th>{t('Rule')}</th></tr></thead>
                <tbody>
                  {FIELDS.map(([name, type, need, rule]) => (
                    <tr key={name}>
                      <td className="nowrap">
                        <code>{name}</code>
                        <div className="cell-sub">{type}</div>
                      </td>
                      <td>
                        <span className={`badge ${need === 'Required' ? 'badge-red' : 'badge-grey'}`}>{t(need)}</span>{' '}
                        {t(rule)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="alert alert-amber mt-3">
              <span>!</span>
              <span>
                {t('Categories are saved by')} <strong>{t('name')}</strong>. {t('To use number')}{' '}
                <code>categoryId</code> {t('values, send an object that says what each number means:')}
              </span>
            </div>
            <pre className="mono mt-2" style={preStyle}>{SAMPLE_WITH_IDS}</pre>

            <p style={{ marginBottom: 0 }}>
              {t('A row is rejected if a required field is missing, a number is wrong, the unit is not listed, or its SKU/barcode is already used. Other rows are still saved.')}
            </p>
          </div>
        </div>
      </div>

      {report && <Report report={report} onCopyRejected={copyRejected} />}
    </div>
  )
}

function Report({ report, onCopyRejected }) {
  const { t } = useLang()
  return (
    <>
      <div className="grid grid-3">
        <Stat label={t('Received')} value={report.received} icon="📄" tone="blue" />
        <Stat label={t('Products added')} value={report.createdCount} icon="✅" tone="green" />
        <Stat label={t('Rejected')} value={report.rejectedCount} icon="⛔" tone={report.rejectedCount ? 'red' : 'green'} />
      </div>

      {report.rejected.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>{t('Rejected rows')}</h3>
            <button type="button" className="btn btn-ghost btn-sm spacer" onClick={onCopyRejected}>
              {t('Copy rejected rows as JSON')}
            </button>
          </div>
          <div className="card-body tight table-wrap">
            <table>
              <thead><tr><th className="num">{t('Row')}</th><th>{t('Product')}</th><th>SKU</th><th>{t('Why')}</th></tr></thead>
              <tbody>
                {report.rejected.map((r) => (
                  <tr key={r.index}>
                    <td className="num">{r.index + 1}</td>
                    <td className="cell-title">{r.productName || '—'}</td>
                    <td className="mono text-sm">{r.sku || '—'}</td>
                    <td>
                      <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--red)' }}>
                        {r.reasons.map((why) => <li key={why}>{why}</li>)}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.created.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>{t('Added products')}</h3></div>
          <div className="card-body tight table-wrap">
            <table>
              <thead><tr><th className="num">{t('Row')}</th><th>{t('Product')}</th><th>SKU</th><th>{t('Barcode')}</th></tr></thead>
              <tbody>
                {report.created.map((c) => (
                  <tr key={c.id}>
                    <td className="num">{c.index + 1}</td>
                    <td className="cell-title">{c.productName}</td>
                    <td className="mono text-sm">{c.sku || '—'}</td>
                    <td className="mono text-sm">{c.barcode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
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
