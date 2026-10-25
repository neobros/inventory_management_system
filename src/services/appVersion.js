/**
 * App release channel.
 *
 * The admin publishes a version number and a download link here; every till
 * reads it on startup and offers the update if it is newer than what it runs.
 * Changing the link later is just an edit to this one document — tills pick the
 * new one up the next time they open.
 */

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

const RELEASE_DOC = ['platform', 'appVersion']

export async function getLatestRelease() {
  const snap = await getDoc(doc(db, ...RELEASE_DOC))
  return snap.exists() ? snap.data() : null
}

export async function publishRelease({ version, downloadUrl, notes, mandatory, publishedBy }) {
  await setDoc(doc(db, ...RELEASE_DOC), {
    version: String(version).trim(),
    downloadUrl: String(downloadUrl).trim(),
    notes: String(notes || '').trim(),
    mandatory: Boolean(mandatory),
    publishedBy: publishedBy || '',
    updatedAt: serverTimestamp(),
  })
}

/**
 * Compares dotted version strings: 1 if a is newer, -1 if older, 0 if equal.
 * Missing parts count as zero, so "1.2" and "1.2.0" match.
 */
export function compareVersions(a, b) {
  const parse = (v) => String(v || '0').trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i += 1) {
    const x = left[i] || 0
    const y = right[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

export function isNewer(candidate, current) {
  return compareVersions(candidate, current) > 0
}

/**
 * Turns a Google Drive share link into one that actually serves the file.
 *
 * A normal Drive link returns an HTML preview page, not the installer. The
 * `uc?export=download` form serves the bytes — though Drive still interrupts
 * large files with a virus-scan notice, which is why the downloader falls back
 * to opening a browser when what arrives is not an executable.
 */
export function normaliseDownloadUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''

  const fileMatch = raw.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/)
  if (fileMatch) return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`

  const openMatch = raw.match(/drive\.google\.com\/open\?id=([A-Za-z0-9_-]+)/)
  if (openMatch) return `https://drive.google.com/uc?export=download&id=${openMatch[1]}`

  return raw
}

/** Flags links that cannot work, so the admin hears about it before the shops do. */
export function validateDownloadUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return 'A download link is required.'
  if (!/^https?:\/\//i.test(raw)) return 'The link must start with http:// or https://'

  if (/drive\.google\.com\/drive\/folders/i.test(raw)) {
    return 'That is a Drive folder link. Share the installer FILE itself and paste its link instead.'
  }
  return ''
}
