/**
 * Agent invoice — a price list / invoice for big buyers, saved as a PDF.
 *
 * Nothing here is written to the database: no bill, no stock change, no
 * report figure. The draft is kept in this browser only, so it survives a
 * refresh.
 *
 *   unit price = cost × (1 + markup %)          editable per line
 *   amount     = (unit price − unit price × rate %) × qty
 *
 * Markup and rate can be set for every line at once, then changed line by line.
 * The screen is the invoice itself: what you edit is what goes in the PDF.
 */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { listProducts } from '../services/products'
import { money } from '../utils/format'
import { isMeasured } from '../utils/units'
import { shopMarkup } from '../utils/pricing'
import { printPortal, nextFrame, portalReady } from '../utils/print'
import { isDesktop, revealFile } from '../utils/desktop'
import { Field, Loading } from '../components/ui'
import { useLang, translate as tr } from '../i18n/LanguageContext'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const today = () => new Date().toISOString().slice(0, 10)
const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0)

export const unitFromCost = (cost, markup) => r2(num(cost) * (1 + num(markup) / 100))
export const lineAmount = (l) => r2((num(l.unitPrice) - num(l.unitPrice) * (num(l.rate) / 100)) * num(l.qty))

const INVOICE_CSS = `
.inv { background: #fff; color: #111; font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px;
  width: 210mm; min-height: 297mm; padding: 14mm 12mm; box-sizing: border-box; margin: 0 auto; }
.inv * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.inv-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
  border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
.inv-shop { display: flex; gap: 10px; align-items: flex-start; }
.inv-logo { width: 54px; height: 54px; object-fit: contain; }
.inv-shop-name { font-size: 18px; font-weight: 700; }
.inv-muted { color: #555; }
.inv-title { font-size: 26px; font-weight: 800; letter-spacing: 0.06em; text-align: right; }
.inv-meta { text-align: right; margin-top: 4px; line-height: 1.6; }
.inv-to { margin-bottom: 14px; line-height: 1.5; }
.inv-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #666; font-weight: 700; }
.inv table { width: 100%; border-collapse: collapse; }
.inv th { background: #f1f1f1; text-align: left; font-size: 11px; padding: 6px; border-bottom: 1px solid #999; }
.inv td { padding: 5px 6px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
.inv .n { text-align: right; white-space: nowrap; }
.inv tr { break-inside: avoid; page-break-inside: avoid; }
.inv-totals { margin-left: auto; width: 260px; margin-top: 10px; }
.inv-totals div { display: flex; justify-content: space-between; padding: 3px 6px; }
.inv-grand { border-top: 2px solid #111; font-weight: 800; font-size: 14px; margin-top: 4px; padding-top: 6px !important; }
.inv-notes { margin-top: 22px; white-space: pre-wrap; line-height: 1.5; }
.inv-sign { margin-top: 48px; display: flex; justify-content: space-between; }
.inv-sign div { border-top: 1px solid #555; width: 180px; text-align: center; padding-top: 4px; font-size: 11px; }
.inv-in { font: inherit; color: inherit; background: transparent; border: 1px dashed transparent;
  border-radius: 3px; padding: 1px 3px; width: 100%; }
.inv-in:hover { border-color: #bbb; }
.inv-in:focus { border-color: #4f46e5; outline: none; background: #f7f7ff; }
.inv-in.n { text-align: right; }
textarea.inv-in { resize: vertical; min-height: 40px; }
.inv-x { border: 0; background: none; color: #b91c1c; cursor: pointer; font-size: 14px; padding: 0 4px; }
`

/** Standalone page for the desktop PDF writer, which has none of the app's CSS. */
function pdfDocument(innerHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    ${INVOICE_CSS}
    .inv { min-height: 0; }
  </style></head><body>${innerHtml}</body></html>`
}

const draftKey = (shopId) => `agentInvoice:${shopId}`
const counterKey = (shopId) => `agentInvoiceNo:${shopId}`

function nextNumber(shopId) {
  let n = 1
  try { n = (Number(localStorage.getItem(counterKey(shopId))) || 0) + 1 } catch { /* private mode */ }
  return `AGT-${String(n).padStart(4, '0')}`
}

function blankDraft(shopId, markup) {
  return {
    number: nextNumber(shopId), date: today(), agent: '', agentDetails: '',
    markup: markup === '' ? 0 : markup, rate: 0, lines: [],
    notes: 'Prices valid for 14 days.',
  }
}

export default function AgentInvoice() {
  const { shopId, shop, currency } = useAuth()
  const toast = useToast()
  const { t } = useLang()

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState(null)
  const [search, setSearch] = useState('')
  const [printing, setPrinting] = useState(false)
  const [bulkCat, setBulkCat] = useState('')

  useEffect(() => {
    listProducts(shopId)
      .then(setProducts)
      .catch(() => toast.error(tr('Could not load products.')))
      .finally(() => setLoading(false))
  }, [shopId, toast])

  // Pick up the draft from last time, or start a new one.
  useEffect(() => {
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(draftKey(shopId)) || 'null') } catch { /* ignore */ }
    setDraft(saved?.lines ? saved : blankDraft(shopId, shopMarkup(shop)))
  }, [shopId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!draft) return
    try { localStorage.setItem(draftKey(shopId), JSON.stringify(draft)) } catch { /* ignore */ }
  }, [draft, shopId])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return products.filter((p) => p.active !== false && (
      (p.name || '').toLowerCase().includes(q)
      || (p.sku || '').toLowerCase().includes(q)
      || (p.barcode || '').includes(q)
    )).slice(0, 8)
  }, [products, search])

  const categories = useMemo(() => {
    const counts = new Map()
    products.forEach((p) => {
      if (p.active === false) return
      const c = p.category || 'Uncategorised'
      counts.set(c, (counts.get(c) || 0) + 1)
    })
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [products])

  if (loading || !draft) return <Loading label="Loading products…" />

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }))
  const setLine = (i, key, value) => setDraft((d) => ({
    ...d,
    lines: d.lines.map((l, j) => {
      if (j !== i) return l
      const next = { ...l, [key]: value }
      // Typing a markup on one line works its unit price out again.
      if (key === 'markup' && l.cost !== null) next.unitPrice = String(unitFromCost(l.cost, value))
      return next
    }),
  }))
  const removeLine = (i) => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))

  const lineFor = (p, d) => {
    const cost = Number(p.cost) || 0
    return {
      productId: p.id,
      description: [p.name, p.sku && `(${p.sku})`].filter(Boolean).join(' '),
      unit: p.unit || 'pcs',
      cost,
      markup: String(d.markup),
      unitPrice: String(unitFromCost(cost, d.markup)),
      qty: '1',
      rate: String(d.rate),
    }
  }

  const addProduct = (p) => {
    setDraft((d) => {
      const at = d.lines.findIndex((l) => l.productId === p.id)
      if (at >= 0) {
        return { ...d, lines: d.lines.map((l, j) => (j === at ? { ...l, qty: String(num(l.qty) + 1) } : l)) }
      }
      return { ...d, lines: [...d.lines, lineFor(p, d)] }
    })
    setSearch('')
  }

  /**
   * Adds every active product, or every product in one category, in name
   * order. Items already on the invoice are left as they are.
   */
  const addMany = (category) => {
    const list = products
      .filter((p) => p.active !== false && (!category || (p.category || 'Uncategorised') === category))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    const have = new Set(draft.lines.map((l) => l.productId))
    const fresh = list.filter((p) => !have.has(p.id))
    if (!fresh.length) {
      toast.info(list.length ? t('Those items are already on the invoice.') : t('No products to add.'))
      return
    }
    setDraft((d) => ({ ...d, lines: [...d.lines, ...fresh.map((p) => lineFor(p, d))] }))
    toast.success(category
      ? t('Added {n} item(s) from {category}.', { n: fresh.length, category: category === 'Uncategorised' ? t('Uncategorised') : category })
      : t('Added {n} item(s).', { n: fresh.length }))
  }

  const clearLines = () => setDraft((d) => ({ ...d, lines: [] }))

  const addBlank = () => setDraft((d) => ({
    ...d,
    lines: [...d.lines, { productId: null, description: '', unit: 'pcs', cost: null, markup: '', unitPrice: '', qty: '1', rate: String(d.rate) }],
  }))

  /** Markup for every line: unit prices are worked out again from cost. */
  const applyMarkupAll = (value) => setDraft((d) => ({
    ...d,
    markup: value,
    lines: d.lines.map((l) => (l.cost === null ? l : { ...l, markup: value, unitPrice: String(unitFromCost(l.cost, value)) })),
  }))

  /** Rate % for every line. */
  const applyRateAll = (value) => setDraft((d) => ({ ...d, rate: value, lines: d.lines.map((l) => ({ ...l, rate: value })) }))

  const startNew = () => {
    setDraft(blankDraft(shopId, shopMarkup(shop)))
    toast.info(t('New invoice started.'))
  }

  const gross = r2(draft.lines.reduce((s, l) => s + num(l.unitPrice) * num(l.qty), 0))
  const total = r2(draft.lines.reduce((s, l) => s + lineAmount(l), 0))
  const discount = r2(gross - total)

  const check = () => {
    if (!draft.lines.length) { toast.error(t('Add at least one item.')); return false }
    const bad = draft.lines.findIndex((l) => !String(l.description).trim() || !(num(l.qty) > 0))
    if (bad >= 0) { toast.error(t('Line {n} needs a description and a quantity.', { n: bad + 1 })); return false }
    return true
  }

  /** Counts this number as used, so the next invoice gets the next one. */
  const markNumberUsed = () => {
    const n = Number(String(draft.number).replace(/\D/g, ''))
    try {
      const cur = Number(localStorage.getItem(counterKey(shopId))) || 0
      if (n > cur) localStorage.setItem(counterKey(shopId), String(n))
    } catch { /* ignore */ }
  }

  const fileName = `Invoice ${draft.number}${draft.agent ? ` - ${draft.agent}` : ''}`.replace(/[\\/:*?"<>|]/g, '-')

  const savePdf = async () => {
    if (!check()) return
    setPrinting(true)
    try {
      await nextFrame()
      if (!(await portalReady())) { toast.error(t('The invoice did not render.')); return }
      const portal = document.getElementById('print-portal')
      if (isDesktop() && window.stockpilot?.savePdf) {
        const res = await window.stockpilot.savePdf({ html: pdfDocument(portal.innerHTML), fileName })
        if (!res?.ok) { toast.error(res?.error || t('Could not save the PDF.')); return }
        toast.success(t('PDF saved to Downloads.'))
        revealFile(res.path)
      } else {
        // Browser: choose "Save as PDF" as the printer in the dialog.
        const title = document.title
        document.title = fileName
        await printPortal('A4', '@page { size: A4 portrait; margin: 0; }')
        document.title = title
      }
      markNumberUsed()
    } finally {
      setPrinting(false)
    }
  }

  const sheet = (edit) => (
    <InvoiceSheet edit={edit} draft={draft} shop={shop} currency={currency}
      gross={gross} discount={discount} total={total}
      set={set} setLine={setLine} removeLine={removeLine} />
  )
  const host = document.getElementById('print-portal')

  return (
    <div className="grid" style={{ gridTemplateColumns: '300px minmax(0,1fr)', alignItems: 'start', gap: 16 }}>
      <style>{INVOICE_CSS}</style>

      <div className="card no-print" style={{ position: 'sticky', top: 76 }}>
        <div className="card-head"><h2>{t('Agent invoice')}</h2></div>
        <div className="card-body">
          <p className="text-sm text-muted" style={{ marginTop: 0 }}>
            {t('A price list or invoice for agents, saved as a PDF. It is not a bill: stock, sales and reports are not changed.')}
          </p>

          <Field label={t('Add item')} hint={t('Name, SKU or barcode')}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search products…')}
              onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { e.preventDefault(); addProduct(matches[0]) } }} />
          </Field>
          {matches.length > 0 && (
            <div className="card" style={{ marginTop: -8, marginBottom: 14, maxHeight: 260, overflow: 'auto' }}>
              {matches.map((p) => (
                <button key={p.id} type="button" className="btn btn-ghost btn-sm"
                  style={{ display: 'flex', width: '100%', justifyContent: 'space-between', borderRadius: 0 }}
                  onClick={() => addProduct(p)}>
                  <span style={{ textAlign: 'left' }}>{p.name}{p.sku ? <span className="text-muted"> · {p.sku}</span> : null}</span>
                  <span className="text-muted">{money(p.cost, currency)}</span>
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={addBlank} style={{ marginBottom: 16 }}>
            {t('+ Add a line by hand')}
          </button>

          <Field label={t('Add many at once')}>
            <div className="flex gap-2">
              <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}>
                <option value="">{t('All items ({n})', { n: products.filter((p) => p.active !== false).length })}</option>
                {categories.map(([c, n]) => <option key={c} value={c}>{c === 'Uncategorised' ? t('Uncategorised') : c} ({n})</option>)}
              </select>
              <button type="button" className="btn btn-ghost nowrap" onClick={() => addMany(bulkCat)}>{t('+ Add')}</button>
            </div>
          </Field>
          {draft.lines.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearLines}
              style={{ marginTop: -6, marginBottom: 16 }}>
              {t('Remove all {n} lines', { n: draft.lines.length })}
            </button>
          )}

          <div className="row">
            <Field label={t('Markup % (all)')} hint={t('Unit price = cost + this %')}>
              <input type="number" step="0.01" value={draft.markup} onChange={(e) => applyMarkupAll(e.target.value)} />
            </Field>
            <Field label={t('Rate % (all)')} hint={t('Discount off unit price')}>
              <input type="number" step="0.01" min="0" max="100" value={draft.rate} onChange={(e) => applyRateAll(e.target.value)} />
            </Field>
          </div>
          <p className="text-sm text-muted" style={{ marginTop: -6 }}>
            {t('Changing these sets every line. Each line can then be changed on the invoice.')}
          </p>

          <div className="flex gap-2" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={savePdf} disabled={printing} style={{ flex: 1 }}>
              {printing && <span className="spinner" />} {isDesktop() ? t('⬇ Save PDF') : t('🖨 Save as PDF')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={startNew}>{t('New')}</button>
          </div>
          {!isDesktop() && (
            <p className="text-sm text-muted" style={{ marginBottom: 0 }}>
              {t('In the print window, choose')} <strong>Save as PDF</strong> {t('as the printer.')}
            </p>
          )}
        </div>
      </div>

      <div style={{ overflowX: 'auto', background: 'var(--surface-2)', padding: 16, borderRadius: 12 }}>
        <div style={{ boxShadow: 'var(--shadow)', width: '210mm', margin: '0 auto' }}>
          {sheet(true)}
        </div>
        <div className="text-sm text-muted" style={{ textAlign: 'center', marginTop: 8 }}>
          {t('Line cost (not printed) is shown when you hover over a unit price.')}
        </div>
      </div>

      {printing && host && createPortal(sheet(false), host)}
    </div>
  )
}

/** The invoice page. `edit` shows inputs; without it, plain text for the PDF. */
function InvoiceSheet({ edit, draft, shop, currency, gross, discount, total, set, setLine, removeLine }) {
  // Only the edit-only hints are translated; the printed invoice stays in English.
  const { t } = useLang()
  const text = (value, onChange, opts = {}) => (edit
    ? <input className={`inv-in ${opts.n ? 'n' : ''}`} value={value} onChange={onChange}
      type={opts.type || 'text'} step={opts.step} placeholder={opts.placeholder} title={opts.title} />
    : <span>{opts.show ?? value}</span>)

  return (
    <div className="inv">
      <div className="inv-top">
        <div className="inv-shop">
          {shop?.logo && <img className="inv-logo" src={shop.logo} alt="" />}
          <div>
            <div className="inv-shop-name">{shop?.name}</div>
            {shop?.address && <div className="inv-muted" style={{ whiteSpace: 'pre-wrap' }}>{shop.address}</div>}
            {shop?.phone && <div className="inv-muted">Tel: {shop.phone}</div>}
          </div>
        </div>
        <div>
          <div className="inv-title">INVOICE</div>
          <div className="inv-meta">
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
              <span className="inv-muted">No.</span>
              <span style={{ width: edit ? 110 : 'auto' }}>{text(draft.number, set('number'), { n: true })}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
              <span className="inv-muted">Date</span>
              <span style={{ width: edit ? 140 : 'auto' }}>
                {text(draft.date, set('date'), { n: true, type: 'date', show: new Date(draft.date).toLocaleDateString() })}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="inv-to">
        <div className="inv-label">Bill to</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{text(draft.agent, set('agent'), { placeholder: t('Agent / customer name') })}</div>
        {edit
          ? <textarea className="inv-in" value={draft.agentDetails} onChange={set('agentDetails')} placeholder={t('Address, phone (optional)')} rows={2} />
          : draft.agentDetails && <div className="inv-muted" style={{ whiteSpace: 'pre-wrap' }}>{draft.agentDetails}</div>}
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 34 }}>No.</th>
            <th>Description</th>
            {edit && <th className="n" style={{ width: 70 }} title={t('Not printed')}>Markup %</th>}
            <th className="n" style={{ width: 105 }}>Unit price</th>
            <th className="n" style={{ width: 70 }}>Qty</th>
            <th className="n" style={{ width: 62 }}>Rate %</th>
            <th className="n" style={{ width: 110 }}>Amount</th>
            {edit && <th style={{ width: 24 }} />}
          </tr>
        </thead>
        <tbody>
          {draft.lines.length === 0 && (
            <tr><td colSpan={edit ? 8 : 6} className="inv-muted" style={{ textAlign: 'center', padding: 20 }}>
              {t('Search for a product on the left to add it.')}
            </td></tr>
          )}
          {draft.lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{text(l.description, (e) => setLine(i, 'description', e.target.value), { placeholder: t('Description') })}</td>
              {edit && (
                <td className="n">
                  {l.cost === null
                    ? <span className="inv-muted">—</span>
                    : <input className="inv-in n" type="number" step="0.01" value={l.markup}
                      onChange={(e) => setLine(i, 'markup', e.target.value)} />}
                </td>
              )}
              <td className="n">
                {text(l.unitPrice, (e) => setLine(i, 'unitPrice', e.target.value), {
                  n: true, type: 'number', step: '0.01', show: money(l.unitPrice, ''),
                  title: l.cost === null ? undefined : t('Cost {amount}', { amount: money(l.cost, currency) }),
                })}
              </td>
              <td className="n">
                {text(l.qty, (e) => setLine(i, 'qty', e.target.value), {
                  n: true, type: 'number', step: isMeasured(l.unit) ? 'any' : '1',
                  show: `${num(l.qty)}${l.unit && l.unit !== 'pcs' ? ` ${l.unit}` : ''}`,
                })}
              </td>
              <td className="n">{text(l.rate, (e) => setLine(i, 'rate', e.target.value), { n: true, type: 'number', step: '0.01', show: `${num(l.rate)}%` })}</td>
              <td className="n" style={{ fontWeight: 600 }}>{money(lineAmount(l), '')}</td>
              {edit && <td><button type="button" className="inv-x" title={t('Remove')} onClick={() => removeLine(i)}>✕</button></td>}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="inv-totals">
        <div><span>Gross</span><span>{money(gross, currency)}</span></div>
        {discount > 0 && <div><span>Discount</span><span>− {money(discount, currency)}</span></div>}
        <div className="inv-grand"><span>Total</span><span>{money(total, currency)}</span></div>
      </div>

      {(edit || draft.notes) && (
        <div className="inv-notes">
          <div className="inv-label">Notes</div>
          {edit
            ? <textarea className="inv-in" value={draft.notes} onChange={set('notes')} rows={2} />
            : draft.notes}
        </div>
      )}

      <div className="inv-sign">
        <div>Prepared by</div>
        <div>Received by</div>
      </div>
    </div>
  )
}
