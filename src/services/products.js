import {
  collection, doc, addDoc, getDocs, getDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, increment, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { generateBarcode } from '../utils/barcode'

export function productsRef(shopId) {
  return collection(db, 'shops', shopId, 'products')
}

export function movementsRef(shopId) {
  return collection(db, 'shops', shopId, 'movements')
}

export function categoriesRef(shopId) {
  return collection(db, 'shops', shopId, 'categories')
}

export async function listProducts(shopId) {
  const snap = await getDocs(query(productsRef(shopId), orderBy('name')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function getProduct(shopId, id) {
  const snap = await getDoc(doc(db, 'shops', shopId, 'products', id))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/** Barcode lookup for the POS scanner. Returns null when nothing matches. */
export async function findByBarcode(shopId, barcode) {
  const snap = await getDocs(
    query(productsRef(shopId), where('barcode', '==', barcode), limit(1))
  )
  if (snap.empty) return null
  const d = snap.docs[0]
  return { id: d.id, ...d.data() }
}

export async function barcodeExists(shopId, barcode, exceptId) {
  const snap = await getDocs(query(productsRef(shopId), where('barcode', '==', barcode), limit(2)))
  return snap.docs.some((d) => d.id !== exceptId)
}

export async function createProduct(shopId, data, actor = 'system') {
  let barcode = (data.barcode || '').trim()
  if (!barcode) {
    // Retry a couple of times so a rare collision cannot produce a duplicate.
    for (let i = 0; i < 5; i += 1) {
      const candidate = generateBarcode()
      if (!(await barcodeExists(shopId, candidate))) {
        barcode = candidate
        break
      }
    }
  }

  const payload = {
    name: data.name.trim(),
    sku: (data.sku || '').trim(),
    barcode,
    category: data.category || '',
    unit: data.unit || 'pcs',
    cost: Number(data.cost) || 0,
    price: Number(data.price) || 0,
    stock: Number(data.stock) || 0,
    lowStockAt: Number(data.lowStockAt) || 0,
    supplier: (data.supplier || '').trim(),
    active: data.active !== false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  const ref = await addDoc(productsRef(shopId), payload)

  if (payload.stock > 0) {
    await logMovement(shopId, {
      productId: ref.id,
      productName: payload.name,
      type: 'in',
      quantity: payload.stock,
      note: 'Opening stock',
      actor,
    })
  }
  return { id: ref.id, ...payload }
}

export async function updateProduct(shopId, id, data) {
  const payload = { ...data, updatedAt: serverTimestamp() }
  delete payload.id
  delete payload.createdAt
  await updateDoc(doc(db, 'shops', shopId, 'products', id), payload)
}

export async function deleteProduct(shopId, id) {
  await deleteDoc(doc(db, 'shops', shopId, 'products', id))
}

export async function logMovement(shopId, movement) {
  await addDoc(movementsRef(shopId), { ...movement, createdAt: serverTimestamp() })
}

/**
 * Applies a manual stock change and records why it happened. `type` is one of
 * in | out | adjust; for adjust, `quantity` is the new absolute count.
 */
export async function adjustStock(shopId, product, { type, quantity, note, actor }) {
  const qty = Number(quantity) || 0
  const ref = doc(db, 'shops', shopId, 'products', product.id)
  const batch = writeBatch(db)

  let delta = qty
  if (type === 'out') delta = -qty
  if (type === 'adjust') delta = qty - (Number(product.stock) || 0)

  batch.update(ref, { stock: increment(delta), updatedAt: serverTimestamp() })
  batch.set(doc(movementsRef(shopId)), {
    productId: product.id,
    productName: product.name,
    barcode: product.barcode || '',
    type,
    quantity: type === 'adjust' ? delta : qty,
    balanceHint: (Number(product.stock) || 0) + delta,
    note: note || '',
    actor: actor || 'system',
    createdAt: serverTimestamp(),
  })
  await batch.commit()
}

export async function listMovements(shopId, max = 200) {
  const snap = await getDocs(query(movementsRef(shopId), orderBy('createdAt', 'desc'), limit(max)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function listCategories(shopId) {
  const snap = await getDocs(query(categoriesRef(shopId), orderBy('name')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function createCategory(shopId, name) {
  const ref = await addDoc(categoriesRef(shopId), { name: name.trim(), createdAt: serverTimestamp() })
  return { id: ref.id, name: name.trim() }
}

export async function deleteCategory(shopId, id) {
  await deleteDoc(doc(db, 'shops', shopId, 'categories', id))
}
