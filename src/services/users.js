import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp,
} from 'firebase/firestore'
import { initializeApp, deleteApp } from 'firebase/app'
import {
  getAuth, signInWithEmailAndPassword, signOut, updatePassword,
} from 'firebase/auth'
import { db, createAuthUser, firebaseConfig } from '../firebase/config'

export const ROLES = {
  superadmin: 'Super Admin',
  owner: 'Shop Owner',
  manager: 'Manager',
  cashier: 'Cashier',
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null
}

export async function listShopUsers(shopId) {
  const snap = await getDocs(query(collection(db, 'users'), where('shopId', '==', shopId)))
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
}

export async function createStaffUser({ shopId, name, email, password, role }) {
  const uid = await createAuthUser(email, password)
  await setDoc(doc(db, 'users', uid), {
    name,
    email: email.toLowerCase(),
    role,
    shopId,
    active: true,
    createdAt: serverTimestamp(),
  })
  await recordStaffPassword(shopId, uid, email, password)
  return uid
}

/* ---------------------------------------------------------------------- *
 * Staff login credentials
 *
 * Same reasoning as shop logins: Firebase stores only a hash, and the client
 * SDK can change the password of the signed-in user alone. Keeping a copy of
 * what the owner set is what lets them look it up and reset it later, and it
 * lives under the shop so the rules can scope it to that shop's owner.
 * ---------------------------------------------------------------------- */

function staffCredRef(shopId, uid) {
  return doc(db, 'shops', shopId, 'staffCredentials', uid)
}

async function recordStaffPassword(shopId, uid, email, password) {
  await setDoc(staffCredRef(shopId, uid), {
    email: email.toLowerCase(),
    password,
    updatedAt: serverTimestamp(),
  })
}

/** uid -> { email, password } for every staff login the owner has set. */
export async function listStaffCredentials(shopId) {
  const snap = await getDocs(collection(db, 'shops', shopId, 'staffCredentials'))
  const map = {}
  snap.docs.forEach((d) => { map[d.id] = d.data() })
  return map
}

/**
 * Sets a new password for one staff login.
 *
 * Signs in as that member on a throwaway secondary app — which is why the
 * current password has to be on record — changes it there, then discards the
 * app. The owner's own session is untouched.
 */
export async function changeStaffPassword({ shopId, uid, email, currentPassword, newPassword }) {
  if (!currentPassword) {
    throw new Error('No password on record for this login, so it cannot be reset from here. Ask the platform administrator.')
  }

  const secondary = initializeApp(firebaseConfig, `staffpw-${Date.now()}`)
  try {
    const secondaryAuth = getAuth(secondary)
    const cred = await signInWithEmailAndPassword(secondaryAuth, email, currentPassword)
    await updatePassword(cred.user, newPassword)
    await signOut(secondaryAuth)
  } catch (err) {
    if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
      throw new Error('The stored password no longer matches this login. Ask the platform administrator to reset it.')
    }
    throw err
  } finally {
    await deleteApp(secondary)
  }

  await recordStaffPassword(shopId, uid, email, newPassword)
}

export async function removeStaffCredentials(shopId, uid) {
  await deleteDoc(staffCredRef(shopId, uid)).catch(() => {})
}

export async function updateUser(uid, data) {
  await updateDoc(doc(db, 'users', uid), data)
}

export async function removeUser(uid, shopId) {
  await deleteDoc(doc(db, 'users', uid))
  if (shopId) await removeStaffCredentials(shopId, uid)
}
