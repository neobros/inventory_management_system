/**
 * Bulk product import from the admin panel, saved straight to Firestore with
 * the signed-in admin's login. Needs the platform admin to be allowed to write
 * a shop's products, movements and categories (see firestore.rules).
 */

import {
  collection, doc, getDoc, getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { readImportBody, validateImport, buildReport } from '../utils/productImport'

// Each product takes 2 writes (product + opening-stock movement); Firestore allows 500 per batch.
const CHUNK = 200

export async function importProducts(shopId, body, actor = 'import') {
  if (!shopId) throw new Error('Choose a shop first.')
  const { rows, categoryMap } = readImportBody(body)

  const shopSnap = await getDoc(doc(db, 'shops', shopId))
  if (!shopSnap.exists()) throw new Error(`No shop found with id "${shopId}".`)

  const productsCol = collection(db, 'shops', shopId, 'products')
  const movementsCol = collection(db, 'shops', shopId, 'movements')
  const categoriesCol = collection(db, 'shops', shopId, 'categories')

  // What the shop already has, so duplicates against it are caught too.
  const [productSnap, categorySnap] = await Promise.all([getDocs(productsCol), getDocs(categoriesCol)])
  const existing = {
    products: productSnap.docs.map((d) => d.data()),
    categories: categorySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  }

  const { accepted, rejected, newCategories } = validateImport(rows, existing, categoryMap)

  for (let i = 0; i < newCategories.length; i += 400) {
    const batch = writeBatch(db)
    for (const name of newCategories.slice(i, i + 400)) {
      batch.set(doc(categoriesCol), { name, createdAt: serverTimestamp() })
    }
    await batch.commit()
  }

  const created = []
  for (let i = 0; i < accepted.length; i += CHUNK) {
    const batch = writeBatch(db)
    const done = []
    for (const { index, payload } of accepted.slice(i, i + CHUNK)) {
      const ref = doc(productsCol)
      batch.set(ref, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      if (payload.stock > 0) {
        batch.set(doc(movementsCol), {
          productId: ref.id,
          productName: payload.name,
          type: 'in',
          quantity: payload.stock,
          note: 'Opening stock (import)',
          actor,
          createdAt: serverTimestamp(),
        })
      }
      done.push({ index, id: ref.id, sku: payload.sku, productName: payload.name, barcode: payload.barcode })
    }
    try {
      await batch.commit()
    } catch (err) {
      if (err.code === 'permission-denied') {
        throw new Error(
          created.length
            ? `Saved ${created.length} products, then Firestore refused the rest (permission denied). Publish the updated firestore.rules.`
            : 'Firestore refused the save (permission denied). Publish the updated firestore.rules in Firebase Console.'
        )
      }
      throw err
    }
    created.push(...done)
  }

  return buildReport({ shopId, received: rows.length, created, rejected })
}
