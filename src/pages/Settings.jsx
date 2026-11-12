import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { updateShop } from '../services/shops'
import { fileToLogo } from '../utils/image'
import { printBill, getLastPrintError } from '../utils/print'
import { Field, Loading } from '../components/ui'
import { ReceiptBody } from '../components/Receipt'
import { createPortal } from 'react-dom'
import { shopMarkup } from '../utils/pricing'
import { useLang } from '../i18n/LanguageContext'

const CURRENCIES = ['Rs.', '$', '€', '£', '₹', '₦', '¥', 'AED', 'PKR', 'BDT', 'KES']

/**
 * Fills {key} markers in an already-translated sentence with React nodes, so a
 * sentence with <code>/<strong> inside it can still be translated as a whole.
 */
function rich(text, parts) {
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const key = piece.slice(1, -1)
    return piece.startsWith('{') && parts[key] !== undefined
      ? <span key={i}>{parts[key]}</span>
      : piece
  })
}

/** A representative bill used to preview receipt formatting changes live. */
const SAMPLE = {
  invoiceNo: 1042,
  createdAt: new Date(),
  cashierName: 'Preview',
  itemCount: 3,
  items: [
    { productId: 'a', name: 'Basmati Rice 5kg', unit: 'pcs', price: 2450, qty: 1, gross: 2450, discount: 200, net: 2250, discountType: 'amount', discountValue: 200 },
    { productId: 'b', name: 'Sunflower Oil 1L', unit: 'pcs', price: 890, qty: 2, gross: 1780, discount: 89, net: 1691, discountType: 'percent', discountValue: 5 },
  ],
  subtotal: 4230, itemDiscount: 289, billDiscount: 100, totalDiscount: 389,
  billDiscountType: 'amount', billDiscountValue: 100,
  taxable: 3841, tax: 0, taxRate: 0, total: 3841,
  paymentMethod: 'cash', paid: 4000, change: 159,
}

export default function Settings() {
  const { shop, shopId, refreshShop } = useAuth()
  const toast = useToast()
  const fileRef = useRef(null)
  const { t } = useLang()

  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  // Printers detected on this machine through QZ Tray, when it is installed.
  const [printers, setPrinters] = useState([])
  const [qzState, setQzState] = useState('idle') // idle | checking | ready | absent
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (shop) {
      setForm({
        name: shop.name || '',
        logo: shop.logo || '',
        currency: shop.currency || 'Rs.',
        paperSize: shop.paperSize || '80mm',
        taxRate: shop.taxRate ?? 0,
        address: shop.address || '',
        phone: shop.phone || '',
        receiptFooter: shop.receiptFooter || '',
        printerName: shop.printerName || '',
        autoPrint: shop.autoPrint !== false,
        printCopies: shop.printCopies || 1,
        markupPercent: shopMarkup(shop),
      })
    }
  }, [shop])

  if (!form) return <Loading />

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const toggle = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.checked }))

  const pickLogo = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const logo = await fileToLogo(file)
      setForm((f) => ({ ...f, logo }))
      toast.info(t('Logo ready — remember to save.'))
    } catch (err) {
      toast.error(err.message)
    } finally {
      e.target.value = ''
    }
  }

  const save = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error(t('Shop name is required.'))
    setSaving(true)
    try {
      await updateShop(shopId, {
        ...form,
        taxRate: Number(form.taxRate) || 0,
        printCopies: Number(form.printCopies) || 1,
        // Empty = switched off (stored as null so it does not fall back to 25 %).
        markupPercent: form.markupPercent === '' ? null : Number(form.markupPercent) || 0,
      })
      await refreshShop()
      toast.success(t('Settings saved.'))
    } catch (err) {
      toast.error(err.message || t('Could not save settings.'))
    } finally {
      setSaving(false)
    }
  }

  /** Asks QZ Tray for the machine's printer list. */
  const detectPrinters = async () => {
    setQzState('checking')
    try {
      // The desktop till reads printers straight from Windows; the web build
      // needs QZ Tray running to see them at all.
      const { isDesktop, listPrinters: listDesktopPrinters } = await import('../utils/desktop')

      let found = []
      let fallback = ''

      if (isDesktop()) {
        const detected = await listDesktopPrinters()
        found = detected.map((p) => p.name)
        fallback = detected.find((p) => p.isDefault)?.name || found[0] || ''
      } else {
        const { listPrinters, defaultPrinter } = await import('../utils/qz')
        found = await listPrinters()
        fallback = (await defaultPrinter()) || found[0] || ''
      }

      if (!found.length) {
        setQzState('absent')
        toast.error(
          isDesktop()
            ? t('No printers are installed on this computer.')
            : t('QZ Tray is not running on this computer. See docs/PRINTER-SETUP.md')
        )
        return
      }

      setPrinters(found)
      setQzState('ready')
      if (!form.printerName && fallback) setForm((f) => ({ ...f, printerName: fallback }))
      toast.success(found.length > 1 ? t('Found {n} printers.', { n: found.length }) : t('Found 1 printer.'))
    } catch {
      setQzState('absent')
      toast.error(t('Could not reach QZ Tray on this computer.'))
    }
  }

  const testPrint = async () => {
    setTesting(true)
    try {
      const how = await printBill({ ...shop, ...form })

      // Every outcome gets reported. Saying nothing is what made a failed test
      // print look identical to a button that does not work.
      if (how === 'direct') {
        toast.success(form.printerName
          ? t('Sent straight to {printer}.', { printer: form.printerName })
          : t('Sent straight to the default printer.'))
      } else if (how === 'empty') {
        toast.error(t('The receipt did not render — nothing was sent to the printer.'))
      } else {
        const why = getLastPrintError()
        toast.info(why ? t('Printed through the browser instead — {why}', { why }) : t('Sent to the browser print dialog.'))
      }
    } finally {
      setTesting(false)
    }
  }

  const previewShop = { ...shop, ...form }
  const host = document.getElementById('print-portal')

  return (
    <div className="grid grid-2" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px', alignItems: 'start' }}>
      <form className="card" onSubmit={save}>
        <div className="card-head">
          <h2>{t('Shop profile')}</h2>
          <button type="submit" className="btn spacer" disabled={saving}>
            {saving && <span className="spinner" />} {t('Save changes')}
          </button>
        </div>

        <div className="card-body">
          <Field label={t('Logo / icon')} hint={t('Shown in the sidebar and printed on receipts. Square images work best.')}>
            <div className="flex gap-3 items-center">
              <div className="sidebar-logo" style={{ width: 60, height: 60, fontSize: 24 }}>
                {form.logo
                  ? <img src={form.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (form.name || 'S').charAt(0).toUpperCase()}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                  {t('Upload image')}
                </button>
                {form.logo && (
                  <button type="button" className="btn btn-ghost" onClick={() => setForm((f) => ({ ...f, logo: '' }))}>
                    {t('Remove')}
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={pickLogo} style={{ display: 'none' }} />
            </div>
          </Field>

          <Field label={t('Shop name')} required>
            <input value={form.name} onChange={set('name')} required />
          </Field>

          <div className="row">
            <Field label={t('Phone')}><input value={form.phone} onChange={set('phone')} placeholder="+94 71 234 5678" /></Field>
            <Field label={t('Currency symbol')}>
              <input value={form.currency} onChange={set('currency')} list="cur-list" maxLength={5} />
              <datalist id="cur-list">{CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
          </div>

          <Field label={t('Address')}><textarea value={form.address} onChange={set('address')} placeholder={t('Street, city')} /></Field>

          <div className="row">
            <Field label={t('Receipt paper size')} hint={t('Match your bill printer')}>
              <select value={form.paperSize} onChange={set('paperSize')}>
                <option value="80mm">{t('80mm thermal (standard POS)')}</option>
                <option value="75mm">{t('75mm roll')}</option>
                <option value="58mm">{t('58mm thermal (compact)')}</option>
                <option value="A4">{t('A4 (office printer)')}</option>
              </select>
            </Field>
            <Field label={t('Tax rate %')} hint={t('0 to hide tax on bills')}>
              <input type="number" step="0.01" min="0" max="100" value={form.taxRate} onChange={set('taxRate')} />
            </Field>
          </div>

          <Field label={t('Default profit %')}
            hint={form.markupPercent === ''
              ? t('Off — selling price is typed by hand on new products.')
              : t('New products: selling price = cost + {pct}%. Clear it to switch off.', { pct: form.markupPercent || 0 })}>
            <div className="flex gap-2">
              <input type="number" step="0.01" min="0" value={form.markupPercent} onChange={set('markupPercent')}
                placeholder={t('Off')} style={{ maxWidth: 160 }} />
              {form.markupPercent !== '' && (
                <button type="button" className="btn btn-ghost" onClick={() => setForm((f) => ({ ...f, markupPercent: '' }))}>
                  {t('Remove')}
                </button>
              )}
            </div>
          </Field>

          <Field label={t('Receipt footer message')}>
            <input value={form.receiptFooter} onChange={set('receiptFooter')}
              placeholder={t('Thank you for shopping with us!')} />
          </Field>

          <h3 style={{ marginTop: 26, marginBottom: 14, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
            {t('Receipt printer')}
          </h3>

          <Field
            label={t('Printer')}
            hint={
              form.printerName
                ? t('Bills go straight to this printer with no dialog, as long as QZ Tray is running on the till.')
                : t('Leave empty to print to the computer’s default printer instead.')
            }
          >
            <div className="flex gap-2">
              {printers.length > 0 ? (
                <select value={form.printerName} onChange={set('printerName')}>
                  <option value="">{t('Default printer')}</option>
                  {printers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <input value={form.printerName} onChange={set('printerName')} list="printer-list"
                  placeholder={t('e.g. {model}', { model: 'Xprinter XP-80C' })} />
              )}
              <button type="button" className="btn btn-ghost nowrap" onClick={detectPrinters}
                disabled={qzState === 'checking'}>
                {qzState === 'checking' && <span className="spinner spinner-dark" />} {t('Detect printers')}
              </button>
            </div>
            <datalist id="printer-list">
              {['Xprinter XP-80C', 'Xprinter XP-58', 'POS-80', 'POS-58', 'EPSON TM-T82'].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>

          {qzState === 'ready' && (
            <div className="alert alert-blue" style={{ marginTop: -6, marginBottom: 14 }}>
              <span>✓</span>
              <span>
                {rich(t('QZ Tray connected — {count} found. Bills print directly, with no dialog box.'), {
                  count: <strong>{t('{n} printers', { n: printers.length })}</strong>,
                })}
              </span>
            </div>
          )}
          {qzState === 'absent' && (
            <div className="alert alert-amber" style={{ marginTop: -6, marginBottom: 14 }}>
              <span>!</span>
              <span>
                {rich(t('QZ Tray was not found on this computer. Install it to print directly to a named printer — see {doc}. Until then bills print through the browser.'), {
                  doc: <code>docs/PRINTER-SETUP.md</code>,
                })}
              </span>
            </div>
          )}

          <div className="row">
            <Field label={t('Copies per bill')} hint={t('2 if you keep a merchant copy')}>
              <select value={form.printCopies} onChange={set('printCopies')}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label={t('After taking payment')}>
              <label className="checkbox" style={{ paddingTop: 9 }}>
                <input type="checkbox" checked={form.autoPrint} onChange={toggle('autoPrint')} />
                {t('Print straight away')}
              </label>
              <div className="hint">
                {t('On: the bill prints and the till clears for the next customer. Off: a receipt preview opens first.')}
              </div>
            </Field>
          </div>

          <div className="alert alert-blue">
            <span>🖨</span>
            <span>
              <strong>{t('Two ways to skip the print dialog.')}</strong>{' '}
              {rich(t('Best: install QZ Tray on the till, hit {detect} and pick your printer above — bills then go to that exact printer. Simpler: open the app with {bat}, which prints to the Windows default printer. Both are covered in {doc}.'), {
                detect: <em>{t('Detect printers')}</em>,
                bat: <code>start-pos.bat</code>,
                doc: <code>docs/PRINTER-SETUP.md</code>,
              })}
            </span>
          </div>
        </div>
      </form>

      <div className="card" style={{ position: 'sticky', top: 76 }}>
        <div className="card-head">
          <h2>{t('Receipt preview')}</h2>
          <button type="button" className="btn btn-ghost btn-sm spacer"
            onClick={testPrint} disabled={testing}>
            {testing && <span className="spinner spinner-dark" />} {t('🖨 Test print')}
          </button>
        </div>
        <div className="card-body" style={{ background: 'var(--surface-2)', overflowX: 'auto' }}>
          <div style={{ background: '#fff', boxShadow: 'var(--shadow)', display: 'inline-block' }}>
            <ReceiptBody sale={SAMPLE} shop={previewShop} />
          </div>
        </div>
      </div>

      {host && createPortal(<ReceiptBody sale={SAMPLE} shop={previewShop} />, host)}
    </div>
  )
}
