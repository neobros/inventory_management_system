import { Fragment } from 'react'
import { createPortal } from 'react-dom'
import Barcode from './Barcode'
import { money, formatDate } from '../utils/format'

const WIDTH_CLASS = { '58mm': 'w58', '75mm': 'w75', '80mm': '', A4: 'wa4' }

/**
 * The printable credit note for a return or a voided bill.
 *
 * Deliberately not a corrected copy of the original bill: the customer already
 * holds that, and reprinting a different version of an invoice that has been
 * paid is how disputes start. This is a separate document that refers back to
 * the invoice and states what went back and what was refunded.
 */
export function CreditNoteBody({ note, shop }) {
  const cur = shop?.currency || 'Rs.'
  const cls = WIDTH_CLASS[shop?.paperSize] ?? ''
  const voided = note.type === 'void'

  return (
    <div className={`receipt ${cls}`}>
      <div className="receipt-head">
        {shop?.logo && <img src={shop.logo} alt="" className="receipt-logo" />}
        <div className="receipt-shop">{shop?.name || 'Shop'}</div>
        {shop?.address && <div className="receipt-meta">{shop.address}</div>}
        {shop?.phone && <div className="receipt-meta">Tel: {shop.phone}</div>}
      </div>

      <hr />

      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '13px', letterSpacing: '0.04em' }}>
        {voided ? 'BILL CANCELLED' : 'RETURN / CREDIT NOTE'}
      </div>

      <hr />

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px' }}>
        <span>Credit #{note.creditNo}</span>
        <span>{formatDate(note.createdAt || new Date())}</span>
      </div>
      <div style={{ fontSize: '10.5px' }}>Against invoice #{note.invoiceNo}</div>
      {note.cashierName && <div style={{ fontSize: '10.5px' }}>Handled by: {note.cashierName}</div>}
      {note.reason && <div style={{ fontSize: '10.5px' }}>Reason: {note.reason}</div>}

      <hr />

      <table className="receipt-rows">
        <thead>
          <tr>
            <th>Item returned</th>
            <th className="r">Qty</th>
            <th className="r">Refund</th>
          </tr>
        </thead>
        <tbody>
          {note.items.map((item, i) => (
            // eslint-disable-next-line react/no-array-index-key -- lines carry no id
            <Fragment key={`${item.productId}-${i}`}>
              <tr>
                <td className="receipt-item-name" colSpan={3}>{item.name}</td>
              </tr>
              <tr>
                <td>{item.qty} {item.unit} × {money(item.price, cur)}</td>
                <td className="r">{item.qty}</td>
                <td className="r">{money(item.net, cur)}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>

      <hr />

      {note.tax > 0 && (
        <>
          <div className="receipt-total">
            <span>Goods</span><span>{money(note.subtotal, cur)}</span>
          </div>
          <div className="receipt-total">
            <span>Tax refunded</span><span>{money(note.tax, cur)}</span>
          </div>
        </>
      )}

      <div className="receipt-total grand">
        <span>REFUND</span><span>{money(note.total, cur)}</span>
      </div>

      <hr />

      <div className="receipt-barcode">
        <Barcode value={`C${String(note.creditNo).padStart(6, '0')}`} height={30} width={1.3} fontSize={9} margin={0} />
      </div>

      <div className="receipt-foot">
        {voided
          ? 'This bill has been cancelled in full.'
          : 'Please keep this note as proof of return.'}
      </div>
    </div>
  )
}

/** Mounts the credit note into the print portal. */
export default function CreditNotePortal({ note, shop }) {
  const host = typeof document !== 'undefined' ? document.getElementById('print-portal') : null
  if (!host || !note) return null
  return createPortal(<CreditNoteBody note={note} shop={shop} />, host)
}
