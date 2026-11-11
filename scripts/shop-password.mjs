/**
 * Sets a shop's password without needing to know the old one.
 *
 *   npm run shop-password                        list every shop login
 *   npm run shop-password -- shop@mail.com Pass1 set that login's password
 *
 * The admin panel can only change a password it already has a copy of, because
 * the browser has to sign in as that user to change it. This script uses the
 * Firebase Admin SDK, which has no such limit — it can set any password
 * outright. The Admin SDK cannot run in a browser, which is why this is a
 * command rather than a button.
 *
 * It also writes the new password back into `shopCredentials`, so the admin
 * panel stays in sync and can manage that shop normally afterwards.
 *
 * Needs `serviceAccount.json` in the project root:
 *   Firebase Console -> Project settings -> Service accounts
 *     -> Generate new private key -> save as serviceAccount.json
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KEY_PATH = path.join(root, 'serviceAccount.json')

const ok = (m) => console.log(`\x1b[32m  ✓\x1b[0m ${m}`)
const info = (m) => console.log(`\x1b[36m  •\x1b[0m ${m}`)

function die(title, ...lines) {
  console.log(`\n\x1b[31m  ✗ ${title}\x1b[0m\n`)
  lines.forEach((l) => console.log(`    ${l}`))
  console.log('')
  process.exit(1)
}

console.log('\n\x1b[1m  StockPilot — shop password tool\x1b[0m\n')

if (!existsSync(KEY_PATH)) {
  die(
    'serviceAccount.json not found',
    'This tool needs a service-account key (it is free, and stays on your machine):',
    '',
    '  1. Firebase Console -> Project settings (gear) -> Service accounts',
    '  2. Click "Generate new private key" -> Generate key',
    '  3. Save the downloaded file as serviceAccount.json in:',
    `     ${root}`,
    '',
    'Then run this command again.',
    '',
    'Keep that file private — it grants full access to your Firebase project.',
    'It is already listed in .gitignore.'
  )
}

const serviceAccount = JSON.parse(await readFile(KEY_PATH, 'utf8'))
initializeApp({ credential: cert(serviceAccount) })

const auth = getAuth()
const db = getFirestore()

const [emailArg, passwordArg] = process.argv.slice(2)

/* --- No arguments: list the shops and their logins --------------------- */

if (!emailArg) {
  const snap = await db.collection('shops').get()

  if (snap.empty) {
    info('No shops exist yet. Create one from the admin panel first.')
    process.exit(0)
  }

  console.log('  Shops on this platform:\n')
  for (const doc of snap.docs) {
    const shop = doc.data()
    const creds = await db.collection('shopCredentials').doc(doc.id).get()
    const recorded = creds.exists ? creds.data().password : null
    console.log(`    ${(shop.name || '(unnamed)').padEnd(26)} ${shop.ownerEmail || '—'}`)
    console.log(`      password on record: ${recorded ? `\x1b[32m${recorded}\x1b[0m` : '\x1b[33mnone\x1b[0m'}`)
  }

  console.log('\n  To set one:\n')
  console.log('    npm run shop-password -- owner@shop.com NewPassword123\n')
  process.exit(0)
}

/* --- Set a password ----------------------------------------------------- */

const email = emailArg.trim().toLowerCase()
const password = passwordArg

if (!password) die('No password given', 'Usage: npm run shop-password -- owner@shop.com NewPassword123')
if (password.length < 6) die('Password too short', 'Firebase requires at least 6 characters.')

let user
try {
  user = await auth.getUserByEmail(email)
} catch (err) {
  if (err.code === 'auth/user-not-found') {
    die('No login exists with that email', `Checked: ${email}`, 'Run without arguments to list the shops.')
  }
  die('Could not look up that login', err.message)
}

await auth.updateUser(user.uid, { password })
ok(`Password set for ${email}`)

// Keep the admin panel's copy in step so it can manage this shop from now on.
const shops = await db.collection('shops').where('ownerEmail', '==', email).limit(1).get()

if (shops.empty) {
  info('No shop document uses that email, so nothing was recorded in the admin panel.')
} else {
  const shopDoc = shops.docs[0]
  await db.collection('shopCredentials').doc(shopDoc.id).set({
    email,
    password,
    updatedAt: FieldValue.serverTimestamp(),
  })
  ok(`Recorded against "${shopDoc.data().name}" — the admin panel can now manage it`)
}

console.log('\n\x1b[32m\x1b[1m  Done.\x1b[0m\n')
console.log(`    Email    : ${email}`)
console.log(`    Password : ${password}`)
console.log('')
process.exit(0)
