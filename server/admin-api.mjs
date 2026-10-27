/**
 * Local admin API.
 *
 * Exists for one job: let the platform admin reset any shop's password without
 * knowing the old one.
 *
 * The browser cannot do that. Firebase's web SDK can only change the password of
 * whoever is currently signed in, so resetting someone else's means signing in as
 * them first — which needs the very password you are trying to replace. The
 * Admin SDK has no such limit, but it must never run in a browser, because its
 * key grants full access to the project.
 *
 * So it runs here, on localhost, started automatically alongside Vite. Vite
 * proxies /api/* to this process, so the admin panel just calls fetch('/api/...').
 *
 * Every request must carry the caller's Firebase ID token, which is verified
 * here and checked against their profile — only a super admin gets through.
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { importProducts } from './product-import.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KEY_PATH = path.join(root, 'serviceAccount.json')
// Optional .env in the project root (gitignored) — holds IMPORT_API_KEY.
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'))

const PORT = Number(process.env.ADMIN_API_PORT) || 5174
const IMPORT_API_KEY = process.env.IMPORT_API_KEY || ''

const grey = (m) => `\x1b[90m${m}\x1b[0m`

if (!existsSync(KEY_PATH)) {
  console.log(`\n\x1b[33m  ⚠  Admin API not started — serviceAccount.json is missing.\x1b[0m`)
  console.log(grey('     Password reset in the admin panel will be unavailable.'))
  console.log(grey('     Firebase Console -> Project settings -> Service accounts'))
  console.log(grey('       -> Generate new private key -> save as serviceAccount.json here:'))
  console.log(grey(`       ${root}`))
  console.log(grey('     Everything else works normally without it.\n'))
  // Exit quietly so `npm run dev` still brings up the app.
  process.exit(0)
}

const serviceAccount = JSON.parse(await readFile(KEY_PATH, 'utf8'))
initializeApp({ credential: cert(serviceAccount) })
const auth = getAuth()
const db = getFirestore()

const json = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  })
  res.end(JSON.stringify(body))
}

function readBody(req, maxBytes = 1e6) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > maxBytes) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (err) {
        reject(Object.assign(new Error(`Malformed JSON: ${err.message}`), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Confirms the caller is the platform super admin.
 *
 * The ID token proves who they are; their profile document decides what they
 * are. Without this, anything able to reach localhost could reset passwords.
 */
async function requireSuperAdmin(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw Object.assign(new Error('Not signed in.'), { status: 401 })

  let decoded
  try {
    decoded = await auth.verifyIdToken(token)
  } catch {
    throw Object.assign(new Error('Your session has expired — sign in again.'), { status: 401 })
  }

  const profile = await db.collection('users').doc(decoded.uid).get()
  if (!profile.exists || profile.data().role !== 'superadmin') {
    throw Object.assign(new Error('Only the platform administrator can do that.'), { status: 403 })
  }
  return decoded
}

/**
 * Lets tools like Postman call the import without a Firebase login: a matching
 * X-API-Key header is enough. Without a key configured, only a super admin's
 * ID token is accepted.
 */
async function requireImportAccess(req) {
  const given = String(req.headers['x-api-key'] || '')
  if (given) {
    if (!IMPORT_API_KEY) {
      throw Object.assign(new Error('API key access is off — set IMPORT_API_KEY in .env and restart.'), { status: 401 })
    }
    const a = Buffer.from(given)
    const b = Buffer.from(IMPORT_API_KEY)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw Object.assign(new Error('Invalid API key.'), { status: 401 })
    }
    return 'api-import'
  }
  const decoded = await requireSuperAdmin(req)
  return decoded.email || decoded.uid
}

const routes = {
  /** Sets a new password for a shop's owner login. No old password needed. */
  async 'reset-password'(body) {
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const shopId = String(body.shopId || '')

    if (!email) throw Object.assign(new Error('No shop email given.'), { status: 400 })
    if (password.length < 6) {
      throw Object.assign(new Error('Password must be at least 6 characters.'), { status: 400 })
    }

    let user
    try {
      user = await auth.getUserByEmail(email)
    } catch {
      throw Object.assign(
        new Error(`No login exists for ${email}. It may have been deleted from Firebase.`),
        { status: 404 }
      )
    }

    await auth.updateUser(user.uid, { password })

    // Keep the panel's own copy in step so it can display the new password.
    if (shopId) {
      await db.collection('shopCredentials').doc(shopId).set({
        email,
        password,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    return { ok: true, email }
  },
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {})

  const route = (req.url || '').replace(/^\/api\//, '').split('?')[0]

  if (route === 'health') return json(res, 200, { ok: true })

  if (route === 'products/import') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' })
    try {
      const actor = await requireImportAccess(req)
      const body = await readBody(req, 20e6)
      const shopId = new URL(req.url, 'http://x').searchParams.get('shopId')
      const report = await importProducts(db, { shopId, body, actor })
      // 200 all saved, 207 some rejected, 422 nothing saved.
      const code = report.rejectedCount === 0 ? 200 : report.createdCount > 0 ? 207 : 422
      return json(res, code, report)
    } catch (err) {
      return json(res, err.status || 500, { ok: false, error: err.message || 'Something went wrong.' })
    }
  }

  const handler = routes[route]
  if (!handler || req.method !== 'POST') return json(res, 404, { error: 'Not found' })

  try {
    await requireSuperAdmin(req)
    const body = await readBody(req)
    return json(res, 200, await handler(body))
  } catch (err) {
    return json(res, err.status || 500, { error: err.message || 'Something went wrong.' })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\x1b[32m  ✓\x1b[0m Admin API on ${grey(`http://127.0.0.1:${PORT}`)} — password reset enabled`)
})
