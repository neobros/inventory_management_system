import { createPortal } from 'react-dom'
import Barcode from './Barcode'
import { money, formatDate } from '../utils/format'

const WIDTH_CLASS = { '58mm': 'w58', '75mm': 'w75', '80mm': '', A4: 'wa4' }

/**
 * The printable bill. Rendered into #print-portal, which the print stylesheet
 * is the only thing that ever makes visible — so the same markup serves both
 * the on-screen preview and the thermal printer.
 */
export function ReceiptBody({ sale, shop }) {
  const cur = shop?.currency || 'Rs.'
  const cls = WIDTH_CLASS[shop?.paperSize] ?? ''
  const showDiscountColumn = sale.items.some((i) => i.discount > 0)

  return (
    <div className={`receipt ${cls}`}>
      <div className="receipt-head">
        {shop?.logo && <img src={shop.logo} alt="" className="receipt-logo" />}
        <div className="receipt-shop">{shop?.name || 'Shop'}</div>
        {shop?.address && <div className="receipt-meta">{shop.address}</div>}
        {shop?.phone && <div className="receipt-meta">Tel: {shop.phone}</div>}
      </div>

      <hr />

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px' }}>
        <span>Invoice #{sale.invoiceNo}</span>
        <span>{formatDate(sale.createdAt || new Date())}</span>
      </div>
      {sale.cashierName && (
        <div style={{ fontSize: '10.5px' }}>Served by: {sale.cashierName}</div>
      )}
      {sale.customer && <div style={{ fontSize: '10.5px' }}>Customer: {sale.customer}</div>}

      <hr />

      <table className="receipt-rows">
        <thead>
          <tr>
            <th style={{ width: '46%' }}>Item</th>
            <th className="r">Qty</th>
            <th className="r">Price</th>
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item, i) => (
            <tr key={`${item.productId}-${i}`}>
              <td colSpan={4} style={{ padding: 0 }}>
                <div className="receipt-item-name">{item.name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{item.qty} {item.unit || 'pcs'} × {money(item.price, cur)}</span>
                  <span>{money(item.gross, cur)}</span>
                </div>
                {item.discount > 0 && (
                  <div className="receipt-disc" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      Discount
                      {item.discountType === 'percent' ? ` (${item.discountValue}%)` : ''}
                    </span>
                    <span>-{money(item.discount, cur)}</span>
                  </div>
                )}
            </td>
            </tr>
          ))}
        </tbody>
      </table>

      <hr />

      <div className="receipt-total">
        <span>Subtotal ({sale.itemCount} items)</span>
        <span>{money(sale.subtotal, cur)}</span>
      </div>
      {showDiscountColumn && sale.itemDiscount > 0 && (
        <div className="receipt-total">
          <span>Item discounts</span>
          <span>-{money(sale.itemDiscount, cur)}</span>
        </div>
      )}
      {sale.billDiscount > 0 && (
        <div className="receipt-total">
          <span>
            Bill discount
            {sale.billDiscountType === 'percent' ? ` (${sale.billDiscountValue}%)` : ''}
          </span>
          <span>-{money(sale.billDiscount, cur)}</span>
        </div>
      )}
      {sale.tax > 0 && (
        <div className="receipt-total">
          <span>Tax ({sale.taxRate}%)</span>
          <span>{money(sale.tax, cur)}</span>
        </div>
      )}

      <div className="receipt-total grand">
        <span>TOTAL</span>
        <span>{money(sale.total, cur)}</span>
      </div>

      <div className="receipt-total">
        <span>Paid ({sale.paymentMethod})</span>
        <span>{money(sale.paid, cur)}</span>
      </div>
      {sale.change > 0 && (
        <div className="receipt-total">
          <span>Change</span>
          <span>{money(sale.change, cur)}</span>
        </div>
      )}
      {sale.totalDiscount > 0 && (
        <div className="receipt-total" style={{ marginTop: 4, fontWeight: 700 }}>
          <span>You saved</span>
          <span>{money(sale.totalDiscount, cur)}</span>
        </div>
      )}

      <hr />

      <div className="receipt-barcode">
        <Barcode value={String(sale.invoiceNo).padStart(6, '0')} height={30} width={1.3} fontSize={9} margin={0} />
      </div>

      <div className="receipt-foot">
        {shop?.receiptFooter || 'Thank you!'}
      </div>
    </div>
  )
}

/** Mounts the receipt into the print portal outside the app tree. */
export default function ReceiptPortal({ sale, shop }) {
  const host = document.getElementById('print-portal')
  if (!host || !sale) return null
  return createPortal(<ReceiptBody sale={sale} shop={shop} />, host)
}
