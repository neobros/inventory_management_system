import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { resolveConfig } from './firebaseConfig'

// Edit src/firebase/firebaseConfig.js to point this at your own project.
export const firebaseConfig = resolveConfig()

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

/**
 * Creates an auth account without touching the currently signed-in session.
 *
 * The Firebase client SDK signs you in as whoever you just created, which would
 * kick an admin out of their own session mid-flow. Spinning up a throwaway
 * secondary app keeps that side effect off the primary auth instance.
 */
export async function createAuthUser(email, password) {
  const secondary = initializeApp(firebaseConfig, `secondary-${Date.now()}`)
  try {
    const secondaryAuth = getAuth(secondary)
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password)
    await signOut(secondaryAuth)
    return cred.user.uid
  } finally {
    await deleteApp(secondary)
  }
}
