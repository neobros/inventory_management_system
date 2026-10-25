/**
 * Client for the local admin API (server/admin-api.mjs).
 *
 * Only used for things the browser is not allowed to do — currently resetting
 * another account's password, which needs the Firebase Admin SDK.
 */

import { auth } from '../firebase/config'

async function call(route, body) {
  const user = auth.currentUser
  if (!user) throw new Error('You are not signed in.')

  const token = await user.getIdToken()

  const offline = () => Object.assign(
    new Error('The admin service is not running. Stop the app and start it again with "npm run dev".'),
    { offline: true }
  )

  let response
  try {
    response = await fetch(`/api/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    // Nothing listening on /api at all.
    throw offline()
  }

  // With the service down, Vite's proxy answers with its own error page rather
  // than a network failure — so anything that is not JSON means "not running",
  // not "the request was rejected".
  const isJson = (response.headers.get('content-type') || '').includes('json')
  if (!isJson) throw offline()

  const data = await response.json().catch(() => null)
  if (!data) throw offline()

  if (!response.ok) throw new Error(data.error || 'The request failed.')
  return data
}

/** True when the local admin service is up, so the UI can say so plainly. */
export async function adminApiAvailable() {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return false
    const data = await res.json()
    return Boolean(data?.ok)
  } catch {
    return false
  }
}

/** Sets a new password for any shop login. No current password required. */
export function resetShopPassword({ shopId, email, password }) {
  return call('reset-password', { shopId, email, password })
}
