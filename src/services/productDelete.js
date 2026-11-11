/**
 * Bulk product delete from the admin panel, using the signed-in admin's login.
 * Needs the platform admin to be allowed to delete a shop's products (see
 * firestore.rules). Stock movements and past sales are kept — they are history.
 */

import { collection, doc, getDocs, writeBatch } from 'firebase/firestore'
import { db } from '../firebase/config'
import { readDeleteBody, matchForDelete } from '../utils/productDelete'

/** Step 1: works out what would be deleted. Changes nothing. */
export async function checkProductsToDelete(shopId, body) {
  if (!shopId) throw new Error('Choose a shop first.')
  const rows = readDeleteBody(body)
  const snap = await getDocs(collection(db, 'shops', shopId, 'products'))
  const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  return { received: rows.length, ...matchForDelete(rows, products) }
}

/** Step 2: deletes the given product ids. Returns the ids actually deleted. */
export async function deleteProductsByIds(shopId, ids) {
  const deleted = []
  for (let i = 0; i < ids.length; i += 450) {
    const slice = ids.slice(i, i + 450)
    const batch = writeBatch(db)
    slice.forEach((id) => batch.delete(doc(db, 'shops', shopId, 'products', id)))
    try {
      await batch.commit()
    } catch (err) {
      if (err.code === 'permission-denied') {
        throw new Error(
          (deleted.length ? `Deleted ${deleted.length}, then ` : '')
          + 'Firestore refused the delete (permission denied). Publish the updated firestore.rules in Firebase Console.'
        )
      }
      throw err
    }
    deleted.push(...slice)
  }
  return deleted
}
