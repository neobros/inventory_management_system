import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useLang, translate as tr } from '../i18n/LanguageContext'
import { listProducts, findByBarcode } from '../services/products'
import { createSale } from '../services/sales'
import { calcTotals, lineGross, lineNet } from '../utils/cart'
import { normaliseScan } from '../utils/barcode'
import {
  isMeasured, entryUnits, quickAmounts, roundQty, toProductUnit, formatQty, perUnit,
} from '../utils/units'
import { money } from '../utils/format'
import { printPortal, printBill, nextFrame } from '../utils/print'
import { Modal, Field, Empty, Loading } from '../components/ui'
import ReceiptPortal, { ReceiptBody } from '../components/Receipt'

export default function POS() {
  const { shopId, shop, profile, currency } = useAuth()
  const toast = useToast()
  // t() for the screen; tr() inside callbacks, so switching language never reloads data.
  const { t } = useLang()

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [cart, setCart] = useState([])
  const [search, setSearch] = useState('')
  const [scan, setScan] = useState('')
  const [billDiscountType, setBillDiscountType] = useState('amount')
  const [billDiscountValue, setBillDiscountValue] = useState('')
  const [checkout, setCheckout] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSale, setLastSale] = useState(null)
  const [showReceipt, setShowReceipt] = useState(false)

  const [method, setMethod] = useState('cash')
  const [paid, setPaid] = useState('')
  const [customer, setCustomer] = useState('')

  // Weigh screen for kg / g / litre / ml / meter / feet / yard items: { product, mode: 'add' | 'set' }.
  const [weighing, setWeighing] = useState(null)
  const [weighAmount, setWeighAmount] = useState('')
  const [weighUnit, setWeighUnit] = useState('')

  const scanRef = useRef(null)

  /**
   * `initial` gates the full-page spinner. Refreshing stock after a sale must
   * NOT flip it: the loading branch returns early and would unmount the receipt
   * portal mid-print, sending a blank page to the printer.
   */
  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true)
    try {
      setProducts(await listProducts(shopId))
    } catch {
      toast.error(tr('Could not load products.'))
    } finally {
      if (initial) setLoading(false)
    }
  }, [shopId, toast])

  useEffect(() => { load(true) }, [load])

  const taxRate = Number(shop?.taxRate) || 0
  const totals = useMemo(
    () => calcTotals(cart, { billDiscountType, billDiscountValue, taxRate }),
    [cart, billDiscountType, billDiscountValue, taxRate]
  )

  /** Stock still on the shelf once what is already in the cart is accounted for. */
  const available = useCallback(
    (product) => roundQty((Number(product.stock) || 0) - (cart.find((c) => c.productId === product.id)?.qty || 0)),
    [cart]
  )

  const openWeigh = useCallback((product, mode = 'add') => {
    const line = cart.find((c) => c.productId === product.id)
    const first = entryUnits(product.unit)[0]
    setWeighUnit(first.unit)
    // When changing a line, start from what is already on it, in the entry unit.
    setWeighAmount(mode === 'set' && line ? String(roundQty(line.qty / first.factor)) : '')
    setWeighing({ product, mode })
  }, [cart])

  /**
   * Adds `qty` of a product, in the product's own unit. Weighed goods with no
   * qty given open the weigh screen instead — 1 kg is rarely what was bought.
   */
  const addToCart = useCallback((product, qty) => {
    if (qty === undefined && isMeasured(product.unit)) {
      if (available(product) <= 0) return toast.error(tr('{name} is out of stock.', { name: product.name }))
      openWeigh(product)
      return undefined
    }
    const amount = roundQty(qty ?? 1)
    if (available(product) < amount) {
      toast.error(available(product) <= 0
        ? tr('{name} is out of stock.', { name: product.name })
        : tr('Only {qty} of {name} left.', { qty: formatQty(available(product), product.unit), name: product.name }))
      return undefined
    }
    setCart((list) => {
      const idx = list.findIndex((c) => c.productId === product.id)
      if (idx >= 0) {
        const copy = [...list]
        copy[idx] = { ...copy[idx], qty: roundQty(copy[idx].qty + amount) }
        return copy
      }
      return [...list, {
        productId: product.id,
        name: product.name,
        barcode: product.barcode || '',
        unit: product.unit || 'pcs',
        price: Number(product.price) || 0,
        listPrice: Number(product.price) || 0,
        cost: Number(product.cost) || 0,
        stock: Number(product.stock) || 0,
        qty: amount,
        discountType: 'amount',
        discountValue: 0,
      }]
    })
    return undefined
  }, [available, openWeigh, toast])

  const weighQty = weighing ? toProductUnit(weighAmount, weighUnit, weighing.product.unit) : 0
  const weighPrice = weighing
    ? Number(cart.find((c) => c.productId === weighing.product.id)?.price ?? weighing.product.price) || 0
    : 0

  const confirmWeigh = (e) => {
    e?.preventDefault()
    const { product, mode } = weighing
    if (!(weighQty > 0)) return toast.error(tr('Enter how much is being sold.'))
    if (mode === 'set') {
      if (setQty(product.id, weighQty) !== null) setWeighing(null)
      return undefined
    }
    if (available(product) < weighQty) {
      return toast.error(tr('Only {qty} of {name} left.', { qty: formatQty(available(product), product.unit), name: product.name }))
    }
    addToCart(product, weighQty)
    setWeighing(null)
    scanRef.current?.focus()
    return undefined
  }

  /** Keyboard-wedge scanners type the code then press Enter. */
  const onScan = async (e) => {
    e.preventDefault()
    const code = normaliseScan(scan)
    if (!code) return
    setScan('')

    const local = products.find((p) => p.barcode === code || p.sku === code)
    if (local) {
      addToCart(local)
      return
    }
    // Fall back to the server in case the catalogue changed on another till.
    const remote = await findByBarcode(shopId, code)
    if (remote) {
      setProducts((list) => (list.some((p) => p.id === remote.id) ? list : [...list, remote]))
      addToCart(remote)
    } else {
      toast.error(tr('No product matches barcode {code}', { code }))
    }
  }

  /**
   * Sets a line's quantity, in the product's own unit. Pieces are whole numbers
   * (at least 1); weighed goods take decimals down to 0.001. Returns the value
   * kept, or null when the input was refused.
   */
  const setQty = (productId, qty) => {
    const line = cart.find((c) => c.productId === productId)
    if (!line) return null
    const measured = isMeasured(line.unit)
    const n = Number(qty)
    if (!Number.isFinite(n) || n <= 0) {
      toast.error(tr('Quantity must be more than zero.'))
      return null
    }
    const wanted = measured ? roundQty(n) : Math.max(1, Math.round(n))
    const capped = Math.min(wanted, line.stock || 9999)
    if (capped < wanted) toast.error(tr('Only {qty} in stock.', { qty: formatQty(line.stock, line.unit) }))
    setCart((list) => list.map((c) => (c.productId === productId ? { ...c, qty: capped } : c)))
    return capped
  }

  /**
   * Changes the selling price for this bill only (the product keeps its price).
   * Selling below cost is allowed — the line just shows a "Below cost" warning.
   * Returns the price kept, or null when refused.
   */
  const setPrice = (productId, value) => {
    const line = cart.find((c) => c.productId === productId)
    if (!line) return null
    const n = Math.round((Number(value) || 0) * 100) / 100
    if (!(n > 0)) {
      toast.error(tr('Price must be more than zero.'))
      return null
    }
    setCart((list) => list.map((c) => (c.productId === productId ? { ...c, price: n } : c)))
    return n
  }

  /**
   * Sets what a whole line sells for — what the 600 g or the 3 pcs cost. The
   * unit price is worked back from it (kept to 6 decimals so the line comes out
   * at exactly the typed amount). Below cost is allowed, with a warning on the
   * line. Returns the amount kept, or null when refused.
   */
  const setLineAmount = (productId, value) => {
    const line = cart.find((c) => c.productId === productId)
    if (!line || !(line.qty > 0)) return null
    const amount = Math.round((Number(value) || 0) * 100) / 100
    if (!(amount > 0)) {
      toast.error(tr('Price must be more than zero.'))
      return null
    }
    const price = Math.round((amount / line.qty) * 1e6) / 1e6
    setCart((list) => list.map((c) => (c.productId === productId ? { ...c, price } : c)))
    return amount
  }

  const setLineDiscount = (productId, patch) => {
    setCart((list) => list.map((c) => (c.productId === productId ? { ...c, ...patch } : c)))
  }

  const removeLine = (productId) => setCart((list) => list.filter((c) => c.productId !== productId))

  const clearCart = () => {
    setCart([])
    setBillDiscountValue('')
    setCustomer('')
    scanRef.current?.focus()
  }

  const openCheckout = () => {
    if (!cart.length) return toast.error(tr('Add at least one item to the bill.'))
    setPaid(String(totals.total))
    setCheckout(true)
  }

  const completeSale = async (thenPrint) => {
    setSaving(true)
    try {
      const saved = await createSale(shopId, {
        items: cart,
        billDiscountType,
        billDiscountValue,
        taxRate,
        payment: { method, paid: Number(paid) || totals.total, customer },
        cashier: { name: profile?.name || profile?.email, uid: profile?.uid },
      })

      const printable = {
        ...saved,
        items: cart.map((i) => ({
          ...i,
          gross: (Number(i.price) || 0) * i.qty,
          discount: (Number(i.price) || 0) * i.qty - lineNet(i),
          net: lineNet(i),
        })),
        billDiscountType,
        billDiscountValue: Number(billDiscountValue) || 0,
        taxRate,
        paymentMethod: method,
        paid: Number(paid) || saved.total,
        change: Math.max(0, (Number(paid) || saved.total) - saved.total),
        customer,
        cashierName: profile?.name || profile?.email,
        createdAt: new Date(),
      }
      setCheckout(false)

      // Take the previous customer's bill out of the print area before putting
      // this one in — the same sequence Sales History uses. Without it the old
      // bill is still in place when printing starts, so its height (and, with
      // unlucky timing, its contents) could go to the printer.
      setLastSale(null)
      await nextFrame()
      setLastSale(printable)

      // With auto-print on, the bill goes straight to paper and the cashier is
      // handed a fresh empty screen — no dialog to dismiss between customers.
      // Turn it off and the receipt preview opens instead.
      const straightToPaper = thenPrint && shop?.autoPrint !== false
      setShowReceipt(!straightToPaper)
      toast.success(
        straightToPaper
          ? tr('Invoice #{no} — printing…', { no: saved.invoiceNo })
          : tr('Invoice #{no} saved.', { no: saved.invoiceNo })
      )

      // Print before touching the cart or reloading stock, so nothing can
      // unmount the receipt while it is on its way to the printer. printBill
      // waits for the receipt to actually render rather than guessing.
      if (thenPrint) {
        const how = await printBill(shop)
        if (how === 'empty') {
          toast.error(tr('The receipt did not render — nothing was sent to the printer.'))
          setShowReceipt(true)
        }
      }

      // Take what was sold off the shelf on screen. Re-reading every product
      // after each sale cost one read per product in the shop, per bill.
      const sold = new Map(cart.map((c) => [c.productId, Number(c.qty) || 0]))
      setProducts((list) => list.map((p) => (sold.has(p.id)
        ? { ...p, stock: roundQty((Number(p.stock) || 0) - sold.get(p.id)) }
        : p)))
      clearCart()
    } catch (err) {
      toast.error(err.message || tr('Could not save the bill.'))
    } finally {
      setSaving(false)
    }
  }

  // F2 jumps back to the scanner, F9 opens checkout — muscle memory for tills.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2') { e.preventDefault(); scanRef.current?.focus() }
      if (e.key === 'F9') { e.preventDefault(); openCheckout() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const active = products.filter((p) => p.active !== false)
    if (!q) return active.slice(0, 60)
    return active.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').includes(q)
    ).slice(0, 60)
  }, [products, search])

  if (loading) return <Loading label={t('Loading catalogue…')} />

  const change = Math.max(0, (Number(paid) || 0) - totals.total)
  const short = (Number(paid) || 0) < totals.total

  return (
    <>
      <div className="pos">
        <div>
          <form className="scan-bar no-print" onSubmit={onScan}>
            <span style={{ fontSize: 20 }}>📷</span>
            <input
              ref={scanRef}
              className="input-lg mono"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder={t('Scan barcode here — or type a code and press Enter')}
              autoFocus
              autoComplete="off"
            />
            <button type="submit" className="btn">{t('Add')}</button>
          </form>

          <div className="card">
            <div className="card-head">
              <h2>{t('Products')}</h2>
              <div className="search-box ml-auto">
                <span className="ico">🔍</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('Search name, SKU or barcode')}
                />
              </div>
            </div>
            <div className="card-body">
              {visible.length === 0 ? (
                <Empty icon="📦" title={t('No products found')}
                  message={products.length ? t('Try a different search.') : t('Add products before billing.')} />
              ) : (
                <div className="product-tiles">
                  {visible.map((p) => {
                    const left = available(p)
                    return (
                      <button key={p.id} type="button" className="tile" onClick={() => addToCart(p)} disabled={left <= 0}>
                        <div className="tile-name">{p.name}</div>
                        <div className="tile-price">
                          {money(p.price, currency)}
                          {isMeasured(p.unit) && <span className="tile-per"> / {p.unit}</span>}
                        </div>
                        <div className="tile-stock">
                          {left > 0 ? t('{qty} available', { qty: formatQty(left, p.unit || 'pcs') }) : t('Out of stock')}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pos-cart">
          <div className="card">
            <div className="card-head">
              <h2>{t('Current Bill')}</h2>
              <span className="badge badge-brand">{t('{n} items', { n: totals.itemCount })}</span>
              <div className="spacer flex gap-2">
                {lastSale && (
                  <button type="button" className="btn btn-ghost btn-sm" title={t('Reprint invoice #{no}', { no: lastSale.invoiceNo })}
                    onClick={() => printBill(shop)}>
                    {t('🖨 Last bill')}
                  </button>
                )}
                {cart.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearCart}>{t('Clear')}</button>
                )}
              </div>
            </div>

            <div className="card-body tight">
              {cart.length === 0 ? (
                <Empty icon="🛒" title={t('Bill is empty')} message={t('Scan a barcode or tap a product.')} />
              ) : (
                <div className="cart-lines">
                  {cart.map((item) => (
                    <div key={item.productId} className="cart-line">
                      <div className="cart-line-top">
                        <div className="cart-line-name">
                          {item.name}
                          {/* Every item: edit the selling amount for this line (3 pcs → 160, 600 g → 650). */}
                          <div className="price-edit" title={t('Selling amount for this line, this bill only.')}>
                            <span>{currency}</span>
                            <NumberInput value={lineGross(item)} onCommit={(v) => setLineAmount(item.productId, v)}
                              aria-label={`Selling amount for ${formatQty(item.qty, item.unit)}`} />
                            <span>{t('for {qty}', { qty: formatQty(item.qty, item.unit) })}</span>
                            {item.price !== item.listPrice && (
                              <button type="button" className="price-reset"
                                title={t('Back to the normal price')}
                                onClick={() => setPrice(item.productId, item.listPrice)}>
                                {t('was {amount} ↺', { amount: money(Math.round(item.listPrice * item.qty * 100) / 100, currency) })}
                              </button>
                            )}
                          </div>
                          {!isMeasured(item.unit) && item.qty > 1 && (
                            <div className="cell-sub">{money(item.price, currency)} {perUnit(item.unit)}</div>
                          )}
                          {/* Warns without revealing the cost figure — the sale can still go ahead. */}
                          {belowCost(item) && <div className="below-cost">{t('⚠ Below cost')}</div>}
                        </div>
                        {isMeasured(item.unit) ? (
                          <button type="button" className="weigh-btn" title={t('Change amount')}
                            onClick={() => openWeigh({ id: item.productId, name: item.name, unit: item.unit, price: item.price }, 'set')}>
                            ⚖ {formatQty(item.qty, item.unit)}
                          </button>
                        ) : (
                          <div className="qty-box">
                            <button type="button" onClick={() => setQty(item.productId, item.qty - 1)}>−</button>
                            <NumberInput value={item.qty} onCommit={(v) => setQty(item.productId, v)}
                              inputMode="numeric" aria-label={t('Quantity')} />
                            <button type="button" onClick={() => setQty(item.productId, item.qty + 1)}>+</button>
                          </div>
                        )}
                        <button type="button" className="btn btn-icon" onClick={() => removeLine(item.productId)}
                          title={t('Remove')}>🗑</button>
                      </div>

                      <div className="disc-row">
                        <select
                          value={item.discountType}
                          onChange={(e) => setLineDiscount(item.productId, { discountType: e.target.value })}
                        >
                          <option value="amount">{t('{currency} off', { currency })}</option>
                          <option value="percent">{t('% off')}</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.discountValue || ''}
                          onChange={(e) => setLineDiscount(item.productId, { discountValue: e.target.value })}
                          placeholder={t('Item discount')}
                        />
                        <strong className="nowrap" style={{ minWidth: 78, textAlign: 'right' }}>
                          {money(lineNet(item), currency)}
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>{t('Discount on whole bill')}</label>
                <div className="disc-row" style={{ marginTop: 0 }}>
                  <select value={billDiscountType} onChange={(e) => setBillDiscountType(e.target.value)}>
                    <option value="amount">{t('{currency} off', { currency })}</option>
                    <option value="percent">{t('% off')}</option>
                  </select>
                  <input
                    type="number" min="0" step="0.01"
                    value={billDiscountValue}
                    onChange={(e) => setBillDiscountValue(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="totals-row">
                <span className="text-muted">{t('Subtotal')}</span>
                <span>{money(totals.subtotal, currency)}</span>
              </div>
              {totals.itemDiscount > 0 && (
                <div className="totals-row">
                  <span className="text-muted">{t('Item discounts')}</span>
                  <span className="text-red">−{money(totals.itemDiscount, currency)}</span>
                </div>
              )}
              {totals.billDiscount > 0 && (
                <div className="totals-row">
                  <span className="text-muted">{t('Bill discount')}</span>
                  <span className="text-red">−{money(totals.billDiscount, currency)}</span>
                </div>
              )}
              {taxRate > 0 && (
                <div className="totals-row">
                  <span className="text-muted">{t('Tax ({rate}%)', { rate: taxRate })}</span>
                  <span>{money(totals.tax, currency)}</span>
                </div>
              )}
              <div className="totals-row grand">
                <span>{t('Total')}</span>
                <span>{money(totals.total, currency)}</span>
              </div>

              <button type="button" className="btn btn-lg btn-block mt-4" onClick={openCheckout} disabled={!cart.length}>
                {t('Charge {amount}', { amount: money(totals.total, currency) })}
              </button>
              <p className="text-sm text-muted mt-2" style={{ textAlign: 'center' }}>
                {t('F2 focus scanner · F9 checkout')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {checkout && (
        <Modal
          title={t('Take payment')}
          subtitle={t('{n} items · {amount}', { n: totals.itemCount, amount: money(totals.total, currency) })}
          onClose={() => !saving && setCheckout(false)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setCheckout(false)} disabled={saving}>
                {t('Back')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => completeSale(false)} disabled={saving}>
                {t('Save only')}
              </button>
              <button type="button" className="btn btn-success" onClick={() => completeSale(true)} disabled={saving}>
                {saving && <span className="spinner" />} {t('Save & print bill')}
              </button>
            </>
          }
        >
          <div className="row">
            <Field label={t('Payment method')}>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">{t('Cash')}</option>
                <option value="card">{t('Card')}</option>
                <option value="mobile">{t('Mobile / QR')}</option>
                <option value="credit">{t('Credit')}</option>
              </select>
            </Field>
            <Field label={t('Customer (optional)')}>
              <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder={t('Walk-in')} />
            </Field>
          </div>

          <Field label={t('Amount received')}>
            <input
              type="number" step="0.01" min="0" className="input-lg mono"
              value={paid} onChange={(e) => setPaid(e.target.value)} autoFocus
            />
          </Field>

          <div className="flex gap-2 wrap mb-4">
            {[totals.total, 500, 1000, 2000, 5000].map((v, i) => (
              <button key={i} type="button" className="btn btn-ghost btn-sm"
                onClick={() => setPaid(String(i === 0 ? totals.total : v))}>
                {i === 0 ? t('Exact') : money(v, currency)}
              </button>
            ))}
          </div>

          <div className="card" style={{ background: change > 0 ? 'var(--green-soft)' : 'var(--surface-2)' }}>
            <div className="card-body">
              <div className="totals-row"><span>{t('Total due')}</span><strong>{money(totals.total, currency)}</strong></div>
              <div className="totals-row"><span>{t('Received')}</span><strong>{money(Number(paid) || 0, currency)}</strong></div>
              <div className="totals-row grand" style={{ fontSize: 17 }}>
                <span>{short ? t('Balance owing') : t('Change')}</span>
                <span className={short ? 'text-red' : 'text-green'}>
                  {money(short ? totals.total - (Number(paid) || 0) : change, currency)}
                </span>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {weighing && (
        <Modal
          title={weighing.product.name}
          subtitle={t('{price} per {unit}', { price: money(weighPrice, currency), unit: weighing.product.unit })}
          onClose={() => setWeighing(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setWeighing(null)}>{t('Cancel')}</button>
              <button type="submit" form="weigh-form" className="btn btn-success" disabled={!(weighQty > 0)}>
                {weighing.mode === 'set' ? t('Update') : t('Add to bill')}
                {weighQty > 0 && ` — ${money(Math.round(weighQty * weighPrice * 100) / 100, currency)}`}
              </button>
            </>
          }
        >
          <form id="weigh-form" onSubmit={confirmWeigh}>
            <Field label={t('How much?')}>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="number" step="any" min="0" className="input-lg mono" autoFocus
                  value={weighAmount} onChange={(e) => setWeighAmount(e.target.value)} placeholder="0"
                />
                <select value={weighUnit} onChange={(e) => setWeighUnit(e.target.value)} style={{ flex: 'none', width: 100 }}>
                  {entryUnits(weighing.product.unit).map((o) => <option key={o.unit} value={o.unit}>{o.unit}</option>)}
                </select>
              </div>
            </Field>
            <div className="flex gap-2 wrap">
              {quickAmounts(weighing.product.unit).map((a) => {
                const unit = entryUnits(weighing.product.unit)[0].unit
                return (
                  <button key={a} type="button" className="btn btn-ghost btn-sm"
                    onClick={() => { setWeighUnit(unit); setWeighAmount(String(a)) }}>
                    {formatQty(toProductUnit(a, unit, weighing.product.unit), weighing.product.unit)}
                  </button>
                )
              })}
            </div>
            {weighQty > 0 && (
              <p className="text-sm text-muted mt-3" style={{ marginBottom: 0 }}>
                {t('= {qty} {unit} taken off stock', { qty: weighQty, unit: weighing.product.unit })}
              </p>
            )}
          </form>
        </Modal>
      )}

      {/* Kept mounted after the modal closes so "Last bill" can reprint it. */}
      {lastSale && <ReceiptPortal sale={lastSale} shop={shop} />}

      {lastSale && showReceipt && (
        <Modal
          title={t('Invoice #{no}', { no: lastSale.invoiceNo })}
          subtitle={shop?.printerName ? t('Prints to {printer}', { printer: shop.printerName }) : undefined}
          onClose={() => setShowReceipt(false)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setShowReceipt(false)}>{t('Done')}</button>
              <button type="button" className="btn" onClick={() => printBill(shop)}>
                {t('🖨 Print bill')}
              </button>
            </>
          }
        >
          <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 8, overflowX: 'auto' }}>
            <ReceiptBody sale={lastSale} shop={shop} />
          </div>
        </Modal>
      )}
    </>
  )
}

/**
 * Number box that lets the cashier finish typing ("0.", "12") before the value
 * is checked. Commits on Enter or when focus leaves; a refused value snaps back.
 */
function NumberInput({ value, onCommit, ...props }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])

  const commit = () => {
    if (text.trim() === '' || Number(text) === Number(value)) {
      setText(String(value))
      return
    }
    const kept = onCommit(text)
    setText(String(kept ?? value))
  }

  return (
    <input
      inputMode="decimal"
      {...props}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
      onFocus={(e) => e.target.select()}
    />
  )
}

/** True when a line, after its own discount, sells for less than it cost. */
function belowCost(item) {
  const cost = Number(item.cost) || 0
  if (cost <= 0) return false
  return lineNet(item) < Math.round(cost * (Number(item.qty) || 0) * 100) / 100
}
