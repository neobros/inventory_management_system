import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { updateShop } from '../services/shops'
import { fileToLogo } from '../utils/image'
import { printBill, getLastPrintError } from '../utils/print'
import { Field, Loading } from '../components/ui'
import { ReceiptBody } from '../components/Receipt'
import { createPortal } from 'react-dom'

const CURRENCIES = ['Rs.', '$', '€', '£', '₹', '₦', '¥', 'AED', 'PKR', 'BDT', 'KES']

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
      toast.info('Logo ready — remember to save.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      e.target.value = ''
    }
  }

  const save = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Shop name is required.')
    setSaving(true)
    try {
      await updateShop(shopId, {
        ...form,
        taxRate: Number(form.taxRate) || 0,
        printCopies: Number(form.printCopies) || 1,
      })
      await refreshShop()
      toast.success('Settings saved.')
    } catch (err) {
      toast.error(err.message || 'Could not save settings.')
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
            ? 'No printers are installed on this computer.'
            : 'QZ Tray is not running on this computer. See docs/PRINTER-SETUP.md'
        )
        return
      }

      setPrinters(found)
      setQzState('ready')
      if (!form.printerName && fallback) setForm((f) => ({ ...f, printerName: fallback }))
      toast.success(`Found ${found.length} printer${found.length > 1 ? 's' : ''}.`)
    } catch {
      setQzState('absent')
      toast.error('Could not reach QZ Tray on this computer.')
    }
  }

  const testPrint = async () => {
    setTesting(true)
    try {
      const how = await printBill({ ...shop, ...form })

      // Every outcome gets reported. Saying nothing is what made a failed test
      // print look identical to a button that does not work.
      if (how === 'direct') {
        toast.success(`Sent straight to ${form.printerName || 'the default printer'}.`)
      } else if (how === 'empty') {
        toast.error('The receipt did not render — nothing was sent to the printer.')
      } else {
        const why = getLastPrintError()
        toast.info(why ? `Printed through the browser instead — ${why}` : 'Sent to the browser print dialog.')
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
          <h2>Shop profile</h2>
          <button type="submit" className="btn spacer" disabled={saving}>
            {saving && <span className="spinner" />} Save changes
          </button>
        </div>

        <div className="card-body">
          <Field label="Logo / icon" hint="Shown in the sidebar and printed on receipts. Square images work best.">
            <div className="flex gap-3 items-center">
              <div className="sidebar-logo" style={{ width: 60, height: 60, fontSize: 24 }}>
                {form.logo
                  ? <img src={form.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (form.name || 'S').charAt(0).toUpperCase()}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                  Upload image
                </button>
                {form.logo && (
                  <button type="button" className="btn btn-ghost" onClick={() => setForm((f) => ({ ...f, logo: '' }))}>
                    Remove
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={pickLogo} style={{ display: 'none' }} />
            </div>
          </Field>

          <Field label="Shop name" required>
            <input value={form.name} onChange={set('name')} required />
          </Field>

          <div className="row">
            <Field label="Phone"><input value={form.phone} onChange={set('phone')} placeholder="+94 71 234 5678" /></Field>
            <Field label="Currency symbol">
              <input value={form.currency} onChange={set('currency')} list="cur-list" maxLength={5} />
              <datalist id="cur-list">{CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
          </div>

          <Field label="Address"><textarea value={form.address} onChange={set('address')} placeholder="Street, city" /></Field>

          <div className="row">
            <Field label="Receipt paper size" hint="Match your bill printer">
              <select value={form.paperSize} onChange={set('paperSize')}>
                <option value="80mm">80mm thermal (standard POS)</option>
                <option value="75mm">75mm roll</option>
                <option value="58mm">58mm thermal (compact)</option>
                <option value="A4">A4 (office printer)</option>
              </select>
            </Field>
            <Field label="Tax rate %" hint="0 to hide tax on bills">
              <input type="number" step="0.01" min="0" max="100" value={form.taxRate} onChange={set('taxRate')} />
            </Field>
          </div>

          <Field label="Receipt footer message">
            <input value={form.receiptFooter} onChange={set('receiptFooter')}
              placeholder="Thank you for shopping with us!" />
          </Field>

          <h3 style={{ marginTop: 26, marginBottom: 14, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
            Receipt printer
          </h3>

          <Field
            label="Printer"
            hint={
              form.printerName
                ? 'Bills go straight to this printer with no dialog, as long as QZ Tray is running on the till.'
                : 'Leave empty to print to the computer’s default printer instead.'
            }
          >
            <div className="flex gap-2">
              {printers.length > 0 ? (
                <select value={form.printerName} onChange={set('printerName')}>
                  <option value="">Default printer</option>
                  {printers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <input value={form.printerName} onChange={set('printerName')} list="printer-list"
                  placeholder="e.g. Xprinter XP-80C" />
              )}
              <button type="button" className="btn btn-ghost nowrap" onClick={detectPrinters}
                disabled={qzState === 'checking'}>
                {qzState === 'checking' && <span className="spinner spinner-dark" />} Detect printers
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
                QZ Tray connected — <strong>{printers.length} printers</strong> found. Bills
                print directly, with no dialog box.
              </span>
            </div>
          )}
          {qzState === 'absent' && (
            <div className="alert alert-amber" style={{ marginTop: -6, marginBottom: 14 }}>
              <span>!</span>
              <span>
                QZ Tray was not found on this computer. Install it to print directly to a
                named printer — see <code>docs/PRINTER-SETUP.md</code>. Until then bills print
                through the browser.
              </span>
            </div>
          )}

          <div className="row">
            <Field label="Copies per bill" hint="2 if you keep a merchant copy">
              <select value={form.printCopies} onChange={set('printCopies')}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="After taking payment">
              <label className="checkbox" style={{ paddingTop: 9 }}>
                <input type="checkbox" checked={form.autoPrint} onChange={toggle('autoPrint')} />
                Print straight away
              </label>
              <div className="hint">
                On: the bill prints and the till clears for the next customer. Off: a
                receipt preview opens first.
              </div>
            </Field>
          </div>

          <div className="alert alert-blue">
            <span>🖨</span>
            <span>
              <strong>Two ways to skip the print dialog.</strong> Best: install QZ Tray on
              the till, hit <em>Detect printers</em> and pick your printer above — bills then
              go to that exact printer. Simpler: open the app with{' '}
              <code>start-pos.bat</code>, which prints to the Windows default printer.
              Both are covered in <code>docs/PRINTER-SETUP.md</code>.
            </span>
          </div>
        </div>
      </form>

      <div className="card" style={{ position: 'sticky', top: 76 }}>
        <div className="card-head">
          <h2>Receipt preview</h2>
          <button type="button" className="btn btn-ghost btn-sm spacer"
            onClick={testPrint} disabled={testing}>
            {testing && <span className="spinner spinner-dark" />} 🖨 Test print
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
