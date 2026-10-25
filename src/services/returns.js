/**
 * Returns, exchanges and voided bills.
 *
 * A bill is never edited or deleted — it is the record of what was actually
 * charged, and rewriting it would destroy the audit trail. A return is written
 * as its own reversing document instead, which is how a till roll and a set of
 * books both handle it: the original sale stands, and a credit note offsets it.
 *
 * The only thing written back onto the sale is how much of it has been returned,
 * so the history screen can show its state without loading every return. The
 * security rules allow those fields and nothing else.
 */

import {
  collection, doc, getDocs, runTransaction, serverTimestamp,
  query, orderBy, limit, where,
} from 'firebase/firestore'
import { db } from '../firebase/config'

export function returnsRef(shopId) {
  return collection(db, 'shops', shopId, 'returns')
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * How much of each line has already gone back, keyed by productId.
 * Stored on the sale so the UI can cap what is returnable without extra reads.
 */
export function returnedMap(sale) {
  return sale?.returnedQty || {}
}

/** Quantity of a line still available to return. */
export function returnableQty(sale, item) {
  const already = Number(returnedMap(sale)[item.productId]) || 0
  return Math.max(0, (Number(item.qty) || 0) - already)
}

export function isFullyReturned(sale) {
  if (!sale?.items?.length) return false
  return sale.items.every((i) => returnableQty(sale, i) === 0)
}

/**
 * Refund for a set of returned lines.
 *
 * Uses each line's net — what the customer actually paid after discounts — then
 * adds back the same proportion of tax, so a refund never hands back more than
 * was taken.
 */
export function calcRefund(sale, lines) {
  const taxRate = Number(sale?.taxRate) || 0

  const subtotal = lines.reduce((sum, l) => {
    const unitNet = (Number(l.item.net) || 0) / Math.max(1, Number(l.item.qty) || 1)
    return sum + unitNet * l.qty
  }, 0)

  const tax = round((subtotal * taxRate) / 100)
  return { subtotal: round(subtotal), tax, total: round(subtotal + tax) }
}

/**
 * Records a return and puts the stock back, atomically.
 *
 * `lines` is [{ item, qty }] taken from the original bill. `type` is 'return'
 * for part of a bill, 'void' when the whole thing is being cancelled.
 */
export async function createReturn(shopId, { sale, lines, reason, cashier }) {
  const picked = lines.filter((l) => Number(l.qty) > 0)
  if (!picked.length) throw new Error('Choose at least one item to return.')

  picked.forEach((l) => {
    if (l.qty > returnableQty(sale, l.item)) {
      throw new Error(`Cannot return ${l.qty} × ${l.item.name} — only ${returnableQty(sale, l.item)} left on this bill.`)
    }
  })

  const refund = calcRefund(sale, picked)
  const returnRef = doc(returnsRef(shopId))
  const saleRef = doc(db, 'shops', shopId, 'sales', sale.id)
  const counterRef = doc(db, 'shops', shopId, 'meta', 'counters')
  const movementsCol = collection(db, 'shops', shopId, 'movements')

  const creditNo = await runTransaction(db, async (tx) => {
    // Reads first — a transaction forbids reading after a write.
    const counterSnap = await tx.get(counterRef)
    const saleSnap = await tx.get(saleRef)
    const productSnaps = await Promise.all(
      picked.map((l) => tx.get(doc(db, 'shops', shopId, 'products', l.item.productId)))
    )

    if (!saleSnap.exists()) throw new Error('That bill no longer exists.')

    const current = saleSnap.data()
    const already = current.returnedQty || {}

    // Re-check against the stored figures, not the copy the screen was holding —
    // another till may have returned the same line in the meantime.
    picked.forEach((l) => {
      const done = Number(already[l.item.productId]) || 0
      const sold = Number(l.item.qty) || 0
      if (done + l.qty > sold) {
        throw new Error(`${l.item.name} has already been returned on this bill.`)
      }
    })

    const next = (counterSnap.exists() ? counterSnap.data().credit || 0 : 0) + 1

    productSnaps.forEach((snap, idx) => {
      if (!snap.exists()) return // product deleted since the sale; skip restocking
      const stock = Number(snap.data().stock) || 0
      tx.update(snap.ref, { stock: stock + (Number(picked[idx].qty) || 0) })
    })

    const updatedReturned = { ...already }
    picked.forEach((l) => {
      updatedReturned[l.item.productId] = (Number(updatedReturned[l.item.productId]) || 0) + l.qty
    })

    const fullyReturned = (current.items || []).every(
      (i) => (Number(updatedReturned[i.productId]) || 0) >= (Number(i.qty) || 0)
    )

    tx.set(counterRef, { credit: next }, { merge: true })

    tx.set(returnRef, {
      creditNo: next,
      saleId: sale.id,
      invoiceNo: sale.invoiceNo,
      type: fullyReturned ? 'void' : 'return',
      items: picked.map((l) => ({
        productId: l.item.productId,
        name: l.item.name,
        barcode: l.item.barcode || '',
        unit: l.item.unit || 'pcs',
        price: Number(l.item.price) || 0,
        qty: l.qty,
        net: round(((Number(l.item.net) || 0) / Math.max(1, Number(l.item.qty) || 1)) * l.qty),
      })),
      subtotal: refund.subtotal,
      tax: refund.tax,
      total: refund.total,
      taxRate: Number(sale.taxRate) || 0,
      reason: (reason || '').trim(),
      cashierName: cashier?.name || '',
      cashierUid: cashier?.uid || '',
      createdAt: serverTimestamp(),
    })

    // The only fields the rules let a sale accept after it is written.
    tx.update(saleRef, {
      returnedQty: updatedReturned,
      refundedTotal: round((Number(current.refundedTotal) || 0) + refund.total),
      voided: fullyReturned,
    })

    productSnaps.forEach((snap, idx) => {
      tx.set(doc(movementsCol), {
        productId: picked[idx].item.productId,
        productName: picked[idx].item.name,
        barcode: picked[idx].item.barcode || '',
        type: 'in',
        quantity: Number(picked[idx].qty) || 0,
        note: `Return — credit #${next} (invoice #${sale.invoiceNo})`,
        actor: cashier?.name || '',
        createdAt: serverTimestamp(),
      })
    })

    return next
  })

  return { id: returnRef.id, creditNo, ...refund }
}

export async function listReturns(shopId, { max = 500, from } = {}) {
  const clauses = [orderBy('createdAt', 'desc'), limit(max)]
  if (from) clauses.unshift(where('createdAt', '>=', from))
  const snap = await getDocs(query(returnsRef(shopId), ...clauses))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}
