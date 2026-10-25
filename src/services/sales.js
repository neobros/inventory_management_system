import {
  collection, doc, getDoc, getDocs, runTransaction, serverTimestamp,
  query, orderBy, where, limit,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { calcTotals, lineGross, lineDiscount, lineNet } from '../utils/cart'

export function salesRef(shopId) {
  return collection(db, 'shops', shopId, 'sales')
}

/**
 * Commits a bill atomically: allocates the next invoice number, decrements
 * every product's stock and writes the sale in one transaction, so a mid-flight
 * failure can never leave stock deducted for a bill that was never saved.
 */
export async function createSale(shopId, { items, billDiscountType, billDiscountValue, taxRate, payment, cashier }) {
  if (!items.length) throw new Error('Cannot save an empty bill.')

  const totals = calcTotals(items, { billDiscountType, billDiscountValue, taxRate })
  const counterRef = doc(db, 'shops', shopId, 'meta', 'counters')
  const saleRef = doc(salesRef(shopId))
  const movementsCol = collection(db, 'shops', shopId, 'movements')

  const invoiceNo = await runTransaction(db, async (tx) => {
    // Every read has to happen before the first write inside a transaction.
    const counterSnap = await tx.get(counterRef)
    const productSnaps = await Promise.all(
      items.map((i) => tx.get(doc(db, 'shops', shopId, 'products', i.productId)))
    )

    const next = (counterSnap.exists() ? counterSnap.data().invoice || 0 : 0) + 1

    productSnaps.forEach((snap, idx) => {
      if (!snap.exists()) return
      const current = Number(snap.data().stock) || 0
      tx.update(snap.ref, { stock: current - (Number(items[idx].qty) || 0) })
    })

    tx.set(counterRef, { invoice: next }, { merge: true })

    tx.set(saleRef, {
      invoiceNo: next,
      items: items.map((i) => ({
        productId: i.productId,
        name: i.name,
        barcode: i.barcode || '',
        unit: i.unit || 'pcs',
        price: Number(i.price) || 0,
        qty: Number(i.qty) || 0,
        discountType: i.discountType || 'amount',
        discountValue: Number(i.discountValue) || 0,
        gross: lineGross(i),
        discount: lineDiscount(i),
        net: lineNet(i),
      })),
      ...totals,
      billDiscountType: billDiscountType || 'amount',
      billDiscountValue: Number(billDiscountValue) || 0,
      taxRate: Number(taxRate) || 0,
      paymentMethod: payment?.method || 'cash',
      paid: Number(payment?.paid) || totals.total,
      change: Math.max(0, (Number(payment?.paid) || totals.total) - totals.total),
      customer: payment?.customer || '',
      cashierName: cashier?.name || '',
      cashierUid: cashier?.uid || '',
      createdAt: serverTimestamp(),
    })

    productSnaps.forEach((snap, idx) => {
      if (!snap.exists()) return
      tx.set(doc(movementsCol), {
        productId: items[idx].productId,
        productName: items[idx].name,
        barcode: items[idx].barcode || '',
        type: 'sale',
        quantity: Number(items[idx].qty) || 0,
        note: `Invoice #${next}`,
        actor: cashier?.name || '',
        createdAt: serverTimestamp(),
      })
    })

    return next
  })

  return { id: saleRef.id, invoiceNo, ...totals }
}

export async function getSale(shopId, id) {
  const snap = await getDoc(doc(db, 'shops', shopId, 'sales', id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function listSales(shopId, { max = 300, from } = {}) {
  const clauses = [orderBy('createdAt', 'desc'), limit(max)]
  if (from) clauses.unshift(where('createdAt', '>=', from))
  const snap = await getDocs(query(salesRef(shopId), ...clauses))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}
