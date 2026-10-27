/**
 * Bulk product import for the local API: POST /api/products/import
 *
 * Optional — the admin panel's Import page saves directly from the browser.
 * This exists for tools like Postman. Row checks live in
 * src/utils/productImport.js so both paths behave the same.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { readImportBody, validateImport, buildReport } from '../src/utils/productImport.js'

// Each product takes 2 writes (product + opening-stock movement); Firestore allows 500 per batch.
const CHUNK = 200

const httpError = (status, message) => Object.assign(new Error(message), { status })

export async function importProducts(db, { shopId, body, actor }) {
  shopId = String(shopId || body?.shopId || '').trim()
  if (!shopId) throw httpError(400, 'shopId is required (as ?shopId=... or in the body).')

  let rows
  let categoryMap
  try {
    ({ rows, categoryMap } = readImportBody(body))
  } catch (err) {
    throw httpError(400, err.message)
  }

  const shopRef = db.collection('shops').doc(shopId)
  if (!(await shopRef.get()).exists) throw httpError(404, `No shop found with id "${shopId}".`)

  const [productSnap, categorySnap] = await Promise.all([
    shopRef.collection('products').select('barcode', 'sku').get(),
    shopRef.collection('categories').get(),
  ])
  const existing = {
    products: productSnap.docs.map((d) => d.data()),
    categories: categorySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  }

  const { accepted, rejected, newCategories } = validateImport(rows, existing, categoryMap)

  for (let i = 0; i < newCategories.length; i += 400) {
    const batch = db.batch()
    for (const name of newCategories.slice(i, i + 400)) {
      batch.set(shopRef.collection('categories').doc(), { name, createdAt: FieldValue.serverTimestamp() })
    }
    await batch.commit()
  }

  const created = []
  for (let i = 0; i < accepted.length; i += CHUNK) {
    const batch = db.batch()
    const done = []
    for (const { index, payload } of accepted.slice(i, i + CHUNK)) {
      const ref = shopRef.collection('products').doc()
      batch.set(ref, { ...payload, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      if (payload.stock > 0) {
        batch.set(shopRef.collection('movements').doc(), {
          productId: ref.id,
          productName: payload.name,
          type: 'in',
          quantity: payload.stock,
          note: 'Opening stock (import)',
          actor,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      done.push({ index, id: ref.id, sku: payload.sku, productName: payload.name, barcode: payload.barcode })
    }
    await batch.commit()
    created.push(...done)
  }

  return buildReport({ shopId, received: rows.length, created, rejected })
}
