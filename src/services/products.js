import {
  collection, doc, addDoc, getDocs, getDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, runTransaction, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { generateBarcode } from '../utils/barcode'
import { roundQty } from '../utils/units'
import { batchesOf, take, addBatch, batchFields, lastCostOf } from '../utils/batches'

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

export async function skuExists(shopId, sku, exceptId) {
  const snap = await getDocs(query(productsRef(shopId), where('sku', '==', sku), limit(2)))
  return snap.docs.some((d) => d.id !== exceptId)
}

/**
 * SKU and barcode are unique within one shop (other shops may reuse them).
 * Throws a readable message when either is already taken by another product.
 */
export async function assertUniqueCodes(shopId, { sku, barcode }, exceptId) {
  const s = (sku || '').trim()
  const b = (barcode || '').trim()
  const [skuTaken, barcodeTaken] = await Promise.all([
    s ? skuExists(shopId, s, exceptId) : false,
    b ? barcodeExists(shopId, b, exceptId) : false,
  ])
  if (skuTaken && barcodeTaken) throw new Error(`SKU "${s}" and barcode "${b}" are already used by other products in this shop.`)
  if (skuTaken) throw new Error(`SKU / item code "${s}" is already used by another product in this shop.`)
  if (barcodeTaken) throw new Error(`Barcode "${b}" is already used by another product in this shop.`)
}

export async function createProduct(shopId, data, actor = 'system') {
  await assertUniqueCodes(shopId, data)

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
    stock: roundQty(data.stock),
    lowStockAt: roundQty(data.lowStockAt),
    supplier: (data.supplier || '').trim(),
    active: data.active !== false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  // Opening stock is the first cost batch.
  payload.lastCost = payload.cost
  payload.batches = payload.stock > 0 ? [{ qty: payload.stock, cost: payload.cost, at: Date.now() }] : []

  const ref = await addDoc(productsRef(shopId), payload)

  if (payload.stock > 0) {
    await logMovement(shopId, {
      productId: ref.id,
      productName: payload.name,
      unit: payload.unit,
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
  // Only checked when the edit touches them — stock updates from a sale skip this.
  if ('sku' in payload) payload.sku = String(payload.sku || '').trim()
  if ('barcode' in payload) payload.barcode = String(payload.barcode || '').trim()
  if ('sku' in payload || 'barcode' in payload) {
    await assertUniqueCodes(shopId, { sku: payload.sku, barcode: payload.barcode }, id)
  }
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
 *
 * Stock in can carry the cost paid for this delivery and a new selling price.
 * A different cost becomes its own batch: what is already on the shelf keeps
 * its old cost and sells first. A new selling price applies to all stock from
 * now on; bills already made keep the price they were sold at.
 *
 * Runs as a transaction so the batches always match the stock figure, even
 * when a till is selling the same product at the same moment.
 */
export async function adjustStock(shopId, product, { type, quantity, note, actor, cost, price }) {
  const qty = roundQty(quantity)
  const ref = doc(db, 'shops', shopId, 'products', product.id)
  const movementRef = doc(movementsRef(shopId))

  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('That product no longer exists.')
    const data = snap.data()
    const stock = roundQty(data.stock)
    const last = lastCostOf(data)

    let batches = batchesOf(data)
    let delta = qty
    if (type === 'out') delta = -qty
    if (type === 'adjust') delta = roundQty(qty - stock)

    const update = { stock: roundQty(stock + delta), updatedAt: serverTimestamp() }
    const hasCost = cost !== undefined && cost !== null && cost !== '' && Number.isFinite(Number(cost))
    const unitCost = hasCost ? Number(cost) : last

    if (delta > 0) {
      batches = addBatch(batches, delta, type === 'in' ? unitCost : last)
      if (type === 'in' && hasCost) update.lastCost = unitCost
    } else if (delta < 0) {
      batches = take(batches, -delta, last).batches
    }
    Object.assign(update, batchFields(batches, update.lastCost ?? last))

    const newPrice = Number(price)
    const priceChanged = type === 'in' && price !== undefined && price !== '' && Number.isFinite(newPrice)
      && newPrice > 0 && newPrice !== Number(data.price)
    if (priceChanged) update.price = newPrice

    tx.update(ref, update)

    const movement = {
      productId: product.id,
      productName: data.name || product.name,
      barcode: data.barcode || '',
      unit: data.unit || 'pcs',
      type,
      quantity: type === 'adjust' ? delta : qty,
      balanceHint: update.stock,
      note: note || '',
      actor: actor || 'system',
    }
    if (type === 'in') movement.cost = unitCost
    if (priceChanged) { movement.oldPrice = Number(data.price) || 0; movement.newPrice = newPrice }
    tx.set(movementRef, { ...movement, createdAt: serverTimestamp() })

    const { updatedAt, ...saved } = update
    return { product: saved, movement }
  })

  // What was written, so the screen can update without reading it all back.
  return {
    stock: result.product.stock,
    product: result.product,
    movement: { id: movementRef.id, ...result.movement, createdAt: new Date() },
  }
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

/** Updates `category` on many products, in batches under Firestore's 500-write limit. */
async function setCategoryOn(shopId, productIds, category) {
  for (let i = 0; i < productIds.length; i += 450) {
    const batch = writeBatch(db)
    productIds.slice(i, i + 450).forEach((id) => {
      batch.update(doc(db, 'shops', shopId, 'products', id), { category, updatedAt: serverTimestamp() })
    })
    // eslint-disable-next-line no-await-in-loop -- one chunk after another
    await batch.commit()
  }
}

/**
 * Renames a category and moves every product in it to the new name.
 * Renaming onto a category that already exists merges the two.
 *
 * `category` is { id, name } — id is null for a name that only appears on
 * products (from an import) and has no category record yet.
 */
export async function renameCategory(shopId, category, newName, productIds, existing = []) {
  const name = newName.trim()
  if (!name) throw new Error('Enter a category name.')
  const target = existing.find((c) => c.id !== category.id && c.name.toLowerCase() === name.toLowerCase())

  await setCategoryOn(shopId, productIds, target ? target.name : name)

  if (target) {
    if (category.id) await deleteDoc(doc(db, 'shops', shopId, 'categories', category.id))
    return { merged: true, name: target.name }
  }
  if (category.id) {
    await updateDoc(doc(db, 'shops', shopId, 'categories', category.id), { name })
  } else {
    await addDoc(categoriesRef(shopId), { name, createdAt: serverTimestamp() })
  }
  return { merged: false, name }
}

/** Deletes a category; its products are left with no category. */
export async function deleteCategoryAndClear(shopId, category, productIds) {
  await setCategoryOn(shopId, productIds, '')
  if (category.id) await deleteDoc(doc(db, 'shops', shopId, 'categories', category.id))
}
