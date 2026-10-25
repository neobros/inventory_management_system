/**
 * ============================================================================
 *  PASTE YOUR FIREBASE KEYS HERE — this is the only file you need to edit.
 * ============================================================================
 *
 *  Firebase Console -> Project settings (gear icon) -> General
 *    -> Your apps -> Web app -> SDK setup and configuration -> Config
 *
 *  Copy the values across and save. That's it.
 */

export const firebaseConfig = {
  apiKey: "AIzaSyABH6mpPrlR8KcUloc6JWeL9XcUZy6O100",
  authDomain: "inventory-management-sys-36b8b.firebaseapp.com",
  projectId: "inventory-management-sys-36b8b",
  storageBucket: "inventory-management-sys-36b8b.firebasestorage.app",
  messagingSenderId: "360458783308",
  appId: "1:360458783308:web:3eada95fed58a846a582e9",
}

/**
 * Optional: if you would rather keep keys out of the codebase (for a public
 * repo or a CI build), set the VITE_FIREBASE_* environment variables instead
 * and they win over the values above. Ignore this if you pasted keys in.
 */
export function resolveConfig() {
  const env = import.meta.env
  if (!env?.VITE_FIREBASE_API_KEY) return firebaseConfig

  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  }
}
