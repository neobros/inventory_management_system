import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { listProducts, findByBarcode } from '../services/products'
import { createSale } from '../services/sales'
import { calcTotals, lineNet } from '../utils/cart'
import { normaliseScan } from '../utils/barcode'
import { money } from '../utils/format'
import { printPortal, printBill, nextFrame } from '../utils/print'
import { Modal, Field, Empty, Loading } from '../components/ui'
import ReceiptPortal, { ReceiptBody } from '../components/Receipt'

export default function POS() {
  const { shopId, shop, profile, currency } = useAuth()
  const toast = useToast()

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
      toast.error('Could not load products.')
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
    (product) => (Number(product.stock) || 0) - (cart.find((c) => c.productId === product.id)?.qty || 0),
    [cart]
  )

  const addToCart = useCallback((product) => {
    if (available(product) <= 0) {
      toast.error(`${product.name} is out of stock.`)
      return
    }
    setCart((list) => {
      const idx = list.findIndex((c) => c.productId === product.id)
      if (idx >= 0) {
        const copy = [...list]
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 }
        return copy
      }
      return [...list, {
        productId: product.id,
        name: product.name,
        barcode: product.barcode || '',
        unit: product.unit || 'pcs',
        price: Number(product.price) || 0,
        stock: Number(product.stock) || 0,
        qty: 1,
        discountType: 'amount',
        discountValue: 0,
      }]
    })
  }, [available, toast])

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
      toast.error(`No product matches barcode ${code}`)
    }
  }

  const setQty = (productId, qty) => {
    const line = cart.find((c) => c.productId === productId)
    if (!line) return
    const wanted = Math.max(1, Number(qty) || 1)
    const capped = Math.min(wanted, line.stock || 9999)
    if (capped < wanted) toast.error(`Only ${line.stock} in stock.`)
    setCart((list) => list.map((c) => (c.productId === productId ? { ...c, qty: capped } : c)))
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
    if (!cart.length) return toast.error('Add at least one item to the bill.')
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
          ? `Invoice #${saved.invoiceNo} — printing…`
          : `Invoice #${saved.invoiceNo} saved.`
      )

      // Print before touching the cart or reloading stock, so nothing can
      // unmount the receipt while it is on its way to the printer. printBill
      // waits for the receipt to actually render rather than guessing.
      if (thenPrint) {
        const how = await printBill(shop)
        if (how === 'empty') {
          toast.error('The receipt did not render — nothing was sent to the printer.')
          setShowReceipt(true)
        }
      }

      clearCart()
      await load()
    } catch (err) {
      toast.error(err.message || 'Could not save the bill.')
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

  if (loading) return <Loading label="Loading catalogue…" />

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
              placeholder="Scan barcode here — or type a code and press Enter"
              autoFocus
              autoComplete="off"
            />
            <button type="submit" className="btn">Add</button>
          </form>

          <div className="card">
            <div className="card-head">
              <h2>Products</h2>
              <div className="search-box ml-auto">
                <span className="ico">🔍</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, SKU or barcode"
                />
              </div>
            </div>
            <div className="card-body">
              {visible.length === 0 ? (
                <Empty icon="📦" title="No products found"
                  message={products.length ? 'Try a different search.' : 'Add products before billing.'} />
              ) : (
                <div className="product-tiles">
                  {visible.map((p) => {
                    const left = available(p)
                    return (
                      <button key={p.id} type="button" className="tile" onClick={() => addToCart(p)} disabled={left <= 0}>
                        <div className="tile-name">{p.name}</div>
                        <div className="tile-price">{money(p.price, currency)}</div>
                        <div className="tile-stock">
                          {left > 0 ? `${left} ${p.unit || 'pcs'} available` : 'Out of stock'}
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
              <h2>Current Bill</h2>
              <span className="badge badge-brand">{totals.itemCount} items</span>
              <div className="spacer flex gap-2">
                {lastSale && (
                  <button type="button" className="btn btn-ghost btn-sm" title={`Reprint invoice #${lastSale.invoiceNo}`}
                    onClick={() => printBill(shop)}>
                    🖨 Last bill
                  </button>
                )}
                {cart.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearCart}>Clear</button>
                )}
              </div>
            </div>

            <div className="card-body tight">
              {cart.length === 0 ? (
                <Empty icon="🛒" title="Bill is empty" message="Scan a barcode or tap a product." />
              ) : (
                <div className="cart-lines">
                  {cart.map((item) => (
                    <div key={item.productId} className="cart-line">
                      <div className="cart-line-top">
                        <div className="cart-line-name">
                          {item.name}
                          <div className="cell-sub">{money(item.price, currency)} each</div>
                        </div>
                        <div className="qty-box">
                          <button type="button" onClick={() => setQty(item.productId, item.qty - 1)}>−</button>
                          <input
                            value={item.qty}
                            onChange={(e) => setQty(item.productId, e.target.value)}
                            inputMode="numeric"
                          />
                          <button type="button" onClick={() => setQty(item.productId, item.qty + 1)}>+</button>
                        </div>
                        <button type="button" className="btn btn-icon" onClick={() => removeLine(item.productId)}
                          title="Remove">🗑</button>
                      </div>

                      <div className="disc-row">
                        <select
                          value={item.discountType}
                          onChange={(e) => setLineDiscount(item.productId, { discountType: e.target.value })}
                        >
                          <option value="amount">{currency} off</option>
                          <option value="percent">% off</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.discountValue || ''}
                          onChange={(e) => setLineDiscount(item.productId, { discountValue: e.target.value })}
                          placeholder="Item discount"
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
                <label>Discount on whole bill</label>
                <div className="disc-row" style={{ marginTop: 0 }}>
                  <select value={billDiscountType} onChange={(e) => setBillDiscountType(e.target.value)}>
                    <option value="amount">{currency} off</option>
                    <option value="percent">% off</option>
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
                <span className="text-muted">Subtotal</span>
                <span>{money(totals.subtotal, currency)}</span>
              </div>
              {totals.itemDiscount > 0 && (
                <div className="totals-row">
                  <span className="text-muted">Item discounts</span>
                  <span className="text-red">−{money(totals.itemDiscount, currency)}</span>
                </div>
              )}
              {totals.billDiscount > 0 && (
                <div className="totals-row">
                  <span className="text-muted">Bill discount</span>
                  <span className="text-red">−{money(totals.billDiscount, currency)}</span>
                </div>
              )}
              {taxRate > 0 && (
                <div className="totals-row">
                  <span className="text-muted">Tax ({taxRate}%)</span>
                  <span>{money(totals.tax, currency)}</span>
                </div>
              )}
              <div className="totals-row grand">
                <span>Total</span>
                <span>{money(totals.total, currency)}</span>
              </div>

              <button type="button" className="btn btn-lg btn-block mt-4" onClick={openCheckout} disabled={!cart.length}>
                Charge {money(totals.total, currency)}
              </button>
              <p className="text-sm text-muted mt-2" style={{ textAlign: 'center' }}>
                F2 focus scanner · F9 checkout
              </p>
            </div>
          </div>
        </div>
      </div>

      {checkout && (
        <Modal
          title="Take payment"
          subtitle={`${totals.itemCount} items · ${money(totals.total, currency)}`}
          onClose={() => !saving && setCheckout(false)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setCheckout(false)} disabled={saving}>
                Back
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => completeSale(false)} disabled={saving}>
                Save only
              </button>
              <button type="button" className="btn btn-success" onClick={() => completeSale(true)} disabled={saving}>
                {saving && <span className="spinner" />} Save & print bill
              </button>
            </>
          }
        >
          <div className="row">
            <Field label="Payment method">
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="mobile">Mobile / QR</option>
                <option value="credit">Credit</option>
              </select>
            </Field>
            <Field label="Customer (optional)">
              <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Walk-in" />
            </Field>
          </div>

          <Field label="Amount received">
            <input
              type="number" step="0.01" min="0" className="input-lg mono"
              value={paid} onChange={(e) => setPaid(e.target.value)} autoFocus
            />
          </Field>

          <div className="flex gap-2 wrap mb-4">
            {[totals.total, 500, 1000, 2000, 5000].map((v, i) => (
              <button key={i} type="button" className="btn btn-ghost btn-sm"
                onClick={() => setPaid(String(i === 0 ? totals.total : v))}>
                {i === 0 ? 'Exact' : money(v, currency)}
              </button>
            ))}
          </div>

          <div className="card" style={{ background: change > 0 ? 'var(--green-soft)' : 'var(--surface-2)' }}>
            <div className="card-body">
              <div className="totals-row"><span>Total due</span><strong>{money(totals.total, currency)}</strong></div>
              <div className="totals-row"><span>Received</span><strong>{money(Number(paid) || 0, currency)}</strong></div>
              <div className="totals-row grand" style={{ fontSize: 17 }}>
                <span>{short ? 'Balance owing' : 'Change'}</span>
                <span className={short ? 'text-red' : 'text-green'}>
                  {money(short ? totals.total - (Number(paid) || 0) : change, currency)}
                </span>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Kept mounted after the modal closes so "Last bill" can reprint it. */}
      {lastSale && <ReceiptPortal sale={lastSale} shop={shop} />}

      {lastSale && showReceipt && (
        <Modal
          title={`Invoice #${lastSale.invoiceNo}`}
          subtitle={shop?.printerName ? `Prints to ${shop.printerName}` : undefined}
          onClose={() => setShowReceipt(false)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setShowReceipt(false)}>Done</button>
              <button type="button" className="btn" onClick={() => printBill(shop)}>
                🖨 Print bill
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
