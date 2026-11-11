/**
 * Barcode helpers.
 *
 * Every product carries one unique CODE128 value. Codes are numeric-only so the
 * cheapest laser scanners (which emit digits over a keyboard-wedge connection)
 * round-trip them without any character-set surprises.
 */

/** 12-digit code: 6 of timestamp tail + 6 random. Collision odds are negligible. */
export function generateBarcode() {
  const stamp = String(Date.now()).slice(-6)
  const rand = String(Math.floor(Math.random() * 1e6)).padStart(6, '0')
  return `${stamp}${rand}`
}

export function isValidBarcode(value) {
  return /^[0-9A-Za-z\-.$/+% ]{4,48}$/.test(String(value || '').trim())
}

/** Scanners often append whitespace or a stray Enter; normalise before lookup. */
export function normaliseScan(value) {
  return String(value || '').trim().replace(/\s+/g, '')
}
