/**
 * Checks a bulk product import before anything is saved.
 *
 * Pure: no Firebase calls. The caller passes in what already exists in the shop,
 * gets back the rows ready to save plus every rejected row and why. Shared by the
 * admin Import page and the local API (server/product-import.mjs).
 */

import { generateBarcode, isValidBarcode } from './barcode.js'

/** Same list as the Unit dropdown on the Products page. */
export const UNITS = ['pcs', 'kg', 'g', 'litre', 'ml', 'box', 'pack', 'metre']
export const MAX_ROWS = 5000

const text = (v) => (v === undefined || v === null ? '' : String(v).trim())

/** Number check that treats '', null and undefined as "not given". */
function num(row, key, reasons, { required = false, integer = false } = {}) {
  const raw = row[key]
  if (raw === undefined || raw === null || raw === '') {
    if (required) reasons.push(`${key} is required`)
    return 0
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    reasons.push(`${key} must be a number`)
    return 0
  }
  if (n < 0) reasons.push(`${key} cannot be negative`)
  if (integer && !Number.isInteger(n)) reasons.push(`${key} must be a whole number`)
  return n
}

/**
 * Pulls the rows (and optional categoryId → name map) out of the request body.
 * Accepts a bare array or { products: [...], categories: { "1": "Name" } }.
 * Throws a plain message when the shape is wrong.
 */
export function readImportBody(body) {
  const rows = Array.isArray(body) ? body : body?.products
  if (!Array.isArray(rows)) {
    throw new Error('Body must be a JSON array of products, or { "products": [ ... ] }.')
  }
  if (rows.length === 0) throw new Error('The products array is empty.')
  if (rows.length > MAX_ROWS) throw new Error(`Too many rows — send at most ${MAX_ROWS} at a time.`)
  const categoryMap = (!Array.isArray(body) && body?.categories) || {}
  return { rows, categoryMap }
}

/**
 * @param rows          the products from the file
 * @param existing      { products: [{ barcode, sku }], categories: [{ id, name, code? }] }
 * @param categoryMap   optional { "1": "Hand Tools" } for numeric categoryId values
 * @returns { accepted: [{ index, payload }], rejected: [...], newCategories: [name] }
 */
export function validateImport(rows, existing, categoryMap = {}) {
  const usedBarcodes = new Set()
  const usedSkus = new Set()
  for (const { barcode, sku } of existing.products) {
    if (barcode) usedBarcodes.add(String(barcode))
    if (sku) usedSkus.add(String(sku).toLowerCase())
  }
  const categoriesById = new Map()
  const categoryNames = new Set()
  for (const { id, name, code } of existing.categories) {
    categoriesById.set(String(id), name)
    if (code !== undefined && code !== null) categoriesById.set(String(code), name)
    if (name) categoryNames.add(name)
  }

  const accepted = []
  const rejected = []

  rows.forEach((row, index) => {
    const reasons = []

    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      rejected.push({ index, reasons: ['Row must be a JSON object'], data: row })
      return
    }

    const name = text(row.productName ?? row.name)
    if (!name) reasons.push('productName is required')
    else if (name.length > 200) reasons.push('productName is longer than 200 characters')

    const sku = text(row.sku)
    if (sku && usedSkus.has(sku.toLowerCase())) reasons.push(`sku "${sku}" already exists`)

    let barcode = text(row.barcode)
    if (barcode) {
      if (!isValidBarcode(barcode)) reasons.push(`barcode "${barcode}" is invalid (4–48 letters/digits)`)
      else if (usedBarcodes.has(barcode)) reasons.push(`barcode "${barcode}" already exists`)
    }

    const cost = num(row, 'costPrice', reasons)
    const price = num(row, 'sellingPrice', reasons, { required: true })
    const stock = num(row, 'openingStock', reasons, { integer: true })
    const lowStockAt = num(row, 'lowStockAlertAt', reasons, { integer: true })

    const unit = text(row.unit).toLowerCase() || 'pcs'
    if (!UNITS.includes(unit)) reasons.push(`unit "${row.unit}" is not one of: ${UNITS.join(', ')}`)

    // A category name wins; otherwise resolve categoryId through the map or the shop's categories.
    let category = text(row.category ?? row.categoryName)
    if (!category && row.categoryId !== undefined && row.categoryId !== null && row.categoryId !== '') {
      const key = String(row.categoryId)
      category = text(categoryMap[key]) || text(categoriesById.get(key))
      if (!category) {
        reasons.push(
          `categoryId ${key} does not match any category — send "category": "<name>" instead, `
          + `or add "categories": { "${key}": "<name>" } around the list`
        )
      }
    }

    if (reasons.length) {
      rejected.push({ index, sku: sku || undefined, productName: name || undefined, reasons, data: row })
      return
    }

    if (!barcode) {
      do barcode = generateBarcode()
      while (usedBarcodes.has(barcode))
    }
    usedBarcodes.add(barcode)
    if (sku) usedSkus.add(sku.toLowerCase())

    accepted.push({
      index,
      payload: {
        name, sku, barcode, category, unit, cost, price, stock, lowStockAt,
        supplier: text(row.supplier),
        active: row.active !== false,
      },
    })
  })

  const newCategories = [...new Set(accepted.map((a) => a.payload.category).filter(Boolean))]
    .filter((n) => !categoryNames.has(n))

  return { accepted, rejected, newCategories }
}

/** The report shape both the page and the API return. */
export function buildReport({ shopId, received, created, rejected }) {
  return {
    ok: rejected.length === 0,
    shopId,
    received,
    createdCount: created.length,
    rejectedCount: rejected.length,
    created,
    rejected,
  }
}
