/**
 * Seeds the platform administrator.
 *
 *   npm run seed
 *
 * Creates the login from admin.config.js in Firebase Authentication, writes its
 * super-admin profile and claims the platform. Safe to run twice — it detects
 * work that is already done and stops rather than duplicating anything.
 *
 * This uses the ordinary web SDK and your existing firebaseConfig, so there is
 * no service-account key to download. It works because firestore.rules lets the
 * first signed-in account claim an unclaimed platform — the same path the app
 * itself uses.
 */

import { initializeApp, deleteApp } from 'firebase/app'
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
} from 'firebase/auth'
import {
  getFirestore, doc, getDoc, writeBatch, serverTimestamp, terminate,
} from 'firebase/firestore'

import { resolveConfig } from '../src/firebase/firebaseConfig.js'
import { adminAccount } from '../admin.config.js'

const ok = (m) => console.log(`\x1b[32m  ✓\x1b[0m ${m}`)
const info = (m) => console.log(`\x1b[36m  •\x1b[0m ${m}`)
const warn = (m) => console.log(`\x1b[33m  !\x1b[0m ${m}`)

/** Thrown to unwind to the single exit point below with a printable message. */
class SeedError extends Error {
  constructor(title, lines = []) {
    super(title)
    this.title = title
    this.lines = lines
  }
}

const fail = (title, ...lines) => { throw new SeedError(title, lines) }

let app = null
let db = null

/**
 * Firebase holds sockets open, so the process needs help to end.
 *
 * Calling process.exit() while those handles are live trips an assertion inside
 * libuv on Windows ("UV_HANDLE_CLOSING"), which prints a crash after an
 * otherwise successful run. Closing Firestore and the app releases the handles
 * so Node can exit on its own with the code we set — no forced exit needed.
 */
async function shutdown(code) {
  try {
    if (db) await terminate(db)
    if (app) await deleteApp(app)
  } catch {
    // Shutting down is best-effort; never mask the real result with a teardown error.
  }

  process.exitCode = code

  // Safety net: if some handle ever outlives teardown, don't hang the terminal.
  // Unref'd, so it cannot itself keep the process alive.
  setTimeout(() => process.exit(code), 5000).unref()
}

async function main() {
  console.log('\n\x1b[1m  StockPilot — seeding the platform admin\x1b[0m\n')

  // --- 1. Check the config files have actually been filled in ---------------

  const firebaseConfig = resolveConfig()

  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('PASTE_')) {
    fail(
      'Firebase keys are not set',
      'Open src/firebase/firebaseConfig.js and paste the config from your',
      'Firebase project (Project settings -> General -> Your apps -> Web app).'
    )
  }

  const email = (adminAccount.email || '').trim().toLowerCase()
  const { password, name } = adminAccount

  if (!email || email === 'admin@yourcompany.com') {
    fail(
      'Admin email is still the placeholder',
      'Open admin.config.js and set the email you want to sign in with.'
    )
  }
  if (!password || password === 'ChangeMe123!') {
    fail(
      'Admin password is still the placeholder',
      'Open admin.config.js and choose your own password (6+ characters).'
    )
  }
  if (password.length < 6) {
    fail('Password too short', 'Firebase requires at least 6 characters.')
  }

  info(`Project : ${firebaseConfig.projectId}`)
  info(`Admin   : ${email}`)
  console.log('')

  // --- 2. Connect ------------------------------------------------------------

  app = initializeApp(firebaseConfig)
  const auth = getAuth(app)
  db = getFirestore(app)

  // --- 3. Create (or reuse) the auth account ---------------------------------

  let uid

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    uid = cred.user.uid
    ok('Created the login in Firebase Authentication')
  } catch (err) {
    const code = String(err.code || '')

    if (code === 'auth/email-already-in-use') {
      warn('That login already exists — signing in to continue')
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password)
        uid = cred.user.uid
        ok('Signed in with the existing account')
      } catch (signInErr) {
        const sc = String(signInErr.code || '')
        if (sc === 'auth/invalid-credential' || sc === 'auth/wrong-password') {
          fail(
            'That email exists but the password does not match',
            "Either put the account's real password in admin.config.js,",
            'or delete the user in Firebase Console -> Authentication -> Users',
            'and run npm run seed again.'
          )
        }
        fail('Could not sign in', sc || signInErr.message)
      }
    } else if (code === 'auth/operation-not-allowed') {
      fail(
        'Email/Password sign-in is switched off',
        'Firebase Console -> Authentication -> Sign-in method',
        '  -> Email/Password -> Enable -> Save',
        'Then run npm run seed again.'
      )
    } else if (code.includes('api-key') || code === 'auth/invalid-api-key') {
      fail(
        'Firebase rejected the API key',
        'Check the values in src/firebase/firebaseConfig.js against your',
        'Firebase project settings.'
      )
    } else if (code === 'auth/network-request-failed') {
      fail('Could not reach Firebase', 'Check your internet connection and try again.')
    } else if (code === 'auth/invalid-email') {
      fail('That admin email is not a valid address', 'Check admin.config.js.')
    } else {
      fail('Could not create the login', code || err.message)
    }
  }

  // --- 4. Claim the platform -------------------------------------------------

  const userRef = doc(db, 'users', uid)
  const bootstrapRef = doc(db, 'platform', 'bootstrap')

  try {
    const [existingUser, bootstrap] = await Promise.all([getDoc(userRef), getDoc(bootstrapRef)])

    if (bootstrap.exists() && bootstrap.data().claimedBy !== uid) {
      fail(
        'This platform already has a different super admin',
        `Claimed by: ${bootstrap.data().email || bootstrap.data().claimedBy}`,
        '',
        'To hand it to the account in admin.config.js, open the Firestore console',
        'and delete the "platform" collection and the old admin\'s document in',
        '"users", then run npm run seed again.'
      )
    }

    if (existingUser.exists() && existingUser.data().role === 'superadmin' && bootstrap.exists()) {
      ok('This account is already the platform super admin — nothing to do')
      console.log('\n\x1b[1m  Already set up.\x1b[0m Run \x1b[1mnpm run dev\x1b[0m and sign in.\n')
      return 0
    }

    const batch = writeBatch(db)
    batch.set(userRef, {
      email,
      name: name || 'Super Admin',
      role: 'superadmin',
      shopId: null,
      active: true,
      createdAt: serverTimestamp(),
    }, { merge: true })
    batch.set(bootstrapRef, {
      claimedBy: uid,
      email,
      createdAt: serverTimestamp(),
    })
    await batch.commit()

    ok('Wrote the super-admin profile')
    ok('Claimed the platform (this is now locked to that account)')
  } catch (err) {
    if (err instanceof SeedError) throw err
    const code = String(err.code || '')

    if (code === 'permission-denied') {
      fail(
        'Firestore refused the write',
        'This almost always means the security rules have not been published yet.',
        '',
        'Copy the contents of firestore.rules into:',
        '  Firebase Console -> Firestore Database -> Rules -> Publish',
        '',
        'Then run npm run seed again.'
      )
    }
    if (code === 'unavailable' || code === 'failed-precondition' || code === 'not-found') {
      fail(
        'Could not reach Firestore',
        'Make sure the database has been created:',
        '  Firebase Console -> Firestore Database -> Create database',
        '',
        `Original error: ${code}`
      )
    }
    fail('Could not write to Firestore', code || err.message)
  }

  // --- 5. Done ---------------------------------------------------------------

  console.log('\n\x1b[32m\x1b[1m  Platform admin is ready.\x1b[0m\n')
  console.log(`    Email    : ${email}`)
  console.log(`    Password : ${password}`)
  console.log('')
  console.log('    Next:  \x1b[1mnpm run dev\x1b[0m  ->  sign in  ->  create your first shop')
  console.log('')
  warn('admin.config.js holds this password in plain text.')
  console.log('    Change it from "My Account" after signing in, or delete the file —')
  console.log('    it is only needed for this one command.')
  console.log('')

  return 0
}

try {
  await shutdown(await main())
} catch (err) {
  if (err instanceof SeedError) {
    console.log(`\n\x1b[31m  ✗ ${err.title}\x1b[0m\n`)
    err.lines.forEach((l) => console.log(`    ${l}`))
    console.log('')
  } else {
    console.log(`\n\x1b[31m  ✗ Unexpected error\x1b[0m\n`)
    console.log(`    ${err?.code || err?.message || err}`)
    console.log('')
  }
  await shutdown(1)
}
