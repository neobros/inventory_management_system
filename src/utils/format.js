export function money(amount, currency = 'Rs.') {
  const n = Number(amount) || 0
  const formatted = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${currency} ${formatted}`
}

export function num(value, digits = 0) {
  const n = Number(value) || 0
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

export function toDate(value) {
  if (!value) return null
  if (value.toDate) return value.toDate()
  return new Date(value)
}

export function formatDate(value, withTime = true) {
  const d = toDate(value)
  if (!d || Number.isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
  if (!withTime) return date
  return `${date} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

export function startOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function daysAgo(n) {
  return startOfDay(new Date(Date.now() - n * 86400000))
}

/** Human-readable label for a Firebase auth error code. */
export function authError(err) {
  const code = err?.code || ''

  // Nothing will ever sign in until the project keys are filled in, so say so
  // plainly rather than passing Firebase's wording through.
  if (code.includes('api-key') || code === 'auth/configuration-not-found') {
    return 'Firebase is not connected yet. Paste your project keys into src/firebase/firebaseConfig.js, then restart the dev server.'
  }

  const map = {
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/user-not-found': 'No account exists with that email.',
    'auth/invalid-email': 'That email address is not valid.',
    'auth/email-already-in-use': 'An account already uses that email.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
    'auth/network-request-failed': 'Network error — check your connection.',
    'permission-denied': 'You do not have permission to do that.',
  }
  return map[code] || err?.message || 'Something went wrong.'
}
