import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
} from 'firebase/firestore'
import { initializeApp, deleteApp } from 'firebase/app'
import {
  getAuth, signInWithEmailAndPassword, signOut, updatePassword,
} from 'firebase/auth'
import { db, createAuthUser, firebaseConfig } from '../firebase/config'

export const DEFAULT_SHOP = {
  name: '',
  logo: '',
  currency: 'Rs.',
  paperSize: '80mm',
  taxRate: 0,
  address: '',
  phone: '',
  receiptFooter: 'Thank you for shopping with us!',
  active: true,

  // Receipt printer. printerName is a label for the till operator — a browser
  // cannot choose a printer itself, so the machine's default printer is what
  // actually receives the job (see docs/PRINTER-SETUP.md).
  printerName: '',
  autoPrint: true,
  printCopies: 1,
}

export function shopsRef() {
  return collection(db, 'shops')
}

export async function listShops() {
  const snap = await getDocs(query(shopsRef(), orderBy('createdAt', 'desc')))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function getShop(shopId) {
  const snap = await getDoc(doc(db, 'shops', shopId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function updateShop(shopId, data) {
  await updateDoc(doc(db, 'shops', shopId), { ...data, updatedAt: serverTimestamp() })
}

export async function setShopActive(shopId, active) {
  await updateDoc(doc(db, 'shops', shopId), { active, updatedAt: serverTimestamp() })
}

/**
 * Provisions a tenant: one shop document plus the shop-owner login that can
 * reach it. The auth account is created first — if that fails (duplicate email,
 * weak password) no orphan shop is left behind.
 */
export async function createShopWithOwner({ shop, email, password }) {
  const uid = await createAuthUser(email, password)
  const shopRef = doc(shopsRef())

  await setDoc(shopRef, {
    ...DEFAULT_SHOP,
    ...shop,
    ownerEmail: email.toLowerCase(),
    ownerUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  await setDoc(doc(db, 'users', uid), {
    email: email.toLowerCase(),
    name: shop.name,
    role: 'owner',
    shopId: shopRef.id,
    active: true,
    createdAt: serverTimestamp(),
  })

  // Kept so the admin can look the login up again (see the note below).
  await recordCredentials(shopRef.id, email, password)

  return shopRef.id
}

/** Removes the shop record. The auth login stays — Firebase requires the Admin
 *  SDK to delete another user, so the account is de-linked instead. */
export async function deleteShop(shopId) {
  await deleteDoc(doc(db, 'shops', shopId))
  await deleteDoc(doc(db, 'shopCredentials', shopId)).catch(() => {})
}

/* ---------------------------------------------------------------------- *
 * Shop login credentials
 *
 * Firebase Authentication stores password hashes and there is no API — for
 * anyone, including Google — that reads a password back. So for the admin to be
 * able to look up a shop's password, the app keeps its own copy at the moment it
 * sets one.
 *
 * That copy lives in its own collection rather than on the shop document,
 * because Firestore rules grant access per document, not per field: anything
 * stored on `shops/{id}` is readable by that shop's own staff. `shopCredentials`
 * is locked to the super admin alone.
 * ---------------------------------------------------------------------- */

export async function getShopCredentials(shopId) {
  const snap = await getDoc(doc(db, 'shopCredentials', shopId))
  return snap.exists() ? snap.data() : null
}

async function recordCredentials(shopId, email, password) {
  await setDoc(doc(db, 'shopCredentials', shopId), {
    email: email.toLowerCase(),
    password,
    updatedAt: serverTimestamp(),
  })
}

/**
 * Sets a new password for a shop's owner login.
 *
 * The client SDK can only change the password of whoever is signed in, and the
 * admin is signed in as themselves. The way through without a backend is to sign
 * in as the shop owner on a throwaway secondary app — which needs their current
 * password, hence the stored copy — change it there, then discard that app. The
 * admin's own session is never touched.
 */
export async function changeShopPassword(shopId, { email, currentPassword, newPassword }) {
  if (!currentPassword) {
    const err = new Error('No password on record. Record the current one below, or use: npm run shop-password')
    err.code = 'no-stored-password'
    throw err
  }

  const secondary = initializeApp(firebaseConfig, `pwchange-${Date.now()}`)
  try {
    const secondaryAuth = getAuth(secondary)
    const cred = await signInWithEmailAndPassword(secondaryAuth, email, currentPassword)
    await updatePassword(cred.user, newPassword)
    await signOut(secondaryAuth)
  } catch (err) {
    // The owner changed it themselves, so our copy is stale.
    if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
      const stale = new Error('The stored password no longer matches this login. Record the current one below, or use: npm run shop-password')
      stale.code = 'stale-password'
      throw stale
    }
    throw err
  } finally {
    await deleteApp(secondary)
  }

  await recordCredentials(shopId, email, newPassword)
}

/** Lets the admin record a password that was set outside the app. */
export async function setStoredPassword(shopId, email, password) {
  await recordCredentials(shopId, email, password)
}
