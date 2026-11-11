import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut,
  sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential,
} from 'firebase/auth'
import { doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { getShop } from '../services/shops'

const AuthContext = createContext(null)

/**
 * Claims the platform for the first account that ever signs in.
 *
 * A brand-new database has no super admin, and there is no way to appoint one
 * from inside the app before one exists. So the first sign-in writes its own
 * super-admin profile together with a marker document. The marker is what makes
 * this safe: it can be created but never updated or deleted, so the moment the
 * platform owner signs in the door is shut and every later sign-in falls
 * through to the normal "no shop assigned" path.
 */
async function claimPlatformIfUnowned(fbUser, email) {
  const bootstrapRef = doc(db, 'platform', 'bootstrap')
  const bootstrap = await getDoc(bootstrapRef)
  if (bootstrap.exists()) return false

  const batch = writeBatch(db)
  batch.set(doc(db, 'users', fbUser.uid), {
    email,
    name: 'Super Admin',
    role: 'superadmin',
    shopId: null,
    active: true,
    createdAt: serverTimestamp(),
  })
  batch.set(bootstrapRef, {
    claimedBy: fbUser.uid,
    email,
    createdAt: serverTimestamp(),
  })
  await batch.commit()
  return true
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)       // firebase auth user
  const [profile, setProfile] = useState(null) // users/{uid} document
  const [shop, setShop] = useState(null)       // the tenant this user belongs to
  const [loading, setLoading] = useState(true)

  const loadContext = useCallback(async (fbUser) => {
    if (!fbUser) {
      setProfile(null)
      setShop(null)
      return
    }

    const email = (fbUser.email || '').toLowerCase()
    const ref = doc(db, 'users', fbUser.uid)
    let snap = await getDoc(ref)

    if (!snap.exists()) {
      try {
        if (await claimPlatformIfUnowned(fbUser, email)) {
          snap = await getDoc(ref)
        }
      } catch {
        // Already claimed, or the rules said no — fall through to "no shop".
      }
    }

    if (!snap.exists()) {
      setProfile({ uid: fbUser.uid, email, role: 'none', shopId: null, active: false })
      setShop(null)
      return
    }

    const data = { uid: fbUser.uid, ...snap.data() }
    setProfile(data)
    setShop(data.shopId ? await getShop(data.shopId) : null)
  }, [])

  useEffect(() => onAuthStateChanged(auth, async (fbUser) => {
    setUser(fbUser)
    try {
      await loadContext(fbUser)
    } finally {
      setLoading(false)
    }
  }), [loadContext])

  const login = (email, password) => signInWithEmailAndPassword(auth, email.trim(), password)
  const logout = () => fbSignOut(auth)
  const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim())

  const changePassword = async (currentPassword, newPassword) => {
    const cred = EmailAuthProvider.credential(auth.currentUser.email, currentPassword)
    await reauthenticateWithCredential(auth.currentUser, cred)
    await updatePassword(auth.currentUser, newPassword)
  }

  const refreshShop = useCallback(async () => {
    if (profile?.shopId) setShop(await getShop(profile.shopId))
  }, [profile?.shopId])

  const role = profile?.role || 'none'
  const value = {
    user, profile, shop, loading, role,
    isSuperAdmin: role === 'superadmin',
    isOwner: role === 'owner',
    canManage: role === 'owner' || role === 'manager' || role === 'superadmin',
    shopId: profile?.shopId || null,
    currency: shop?.currency || 'Rs.',
    login, logout, resetPassword, changePassword, refreshShop, setShop,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
