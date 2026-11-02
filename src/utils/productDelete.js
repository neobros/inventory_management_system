/**
 * Matches a pasted JSON list against a shop's products, to decide what a bulk
 * delete would remove. Pure: no Firebase calls.
 *
 * Rule: when a row gives both sku and barcode, BOTH must belong to the same
 * product — a half match is refused rather than guessed at, because a delete
 * cannot be undone. A row with only one of them matches on that one.
 */

const text = (v) => (v === undefined || v === null ? '' : String(v).trim())

export function readDeleteBody(body) {
  const rows = Array.isArray(body) ? body : body?.products
  if (!Array.isArray(rows)) throw new Error('JSON must be a list [ ... ] or { "products": [ ... ] }.')
  if (rows.length === 0) throw new Error('The list is empty.')
  return rows
}

/**
 * @param rows      rows from the pasted JSON (only sku / barcode are used)
 * @param products  the shop's products, each with id, name, sku, barcode
 * @returns {
 *   matches:  [{ index, product }]   one entry per product to delete (deduplicated)
 *   notFound: [{ index, sku, barcode, productName, reasons, data }]
 * }
 */
export function matchForDelete(rows, products) {
  const bySku = new Map()
  const byBarcode = new Map()
  for (const p of products) {
    const sku = text(p.sku).toLowerCase()
    const barcode = text(p.barcode)
    if (sku) bySku.set(sku, [...(bySku.get(sku) || []), p])
    if (barcode) byBarcode.set(barcode, [...(byBarcode.get(barcode) || []), p])
  }

  const matches = []
  const notFound = []
  const taken = new Set()

  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      notFound.push({ index, reasons: ['Row must be a JSON object'], data: row })
      return
    }
    const sku = text(row.sku)
    const barcode = text(row.barcode)
    const productName = text(row.productName ?? row.name) || undefined
    const miss = (reason) => notFound.push({
      index, sku: sku || undefined, barcode: barcode || undefined, productName, reasons: [reason], data: row,
    })

    if (!sku && !barcode) return miss('Row needs a sku or a barcode to find the product')

    const skuHits = sku ? bySku.get(sku.toLowerCase()) || [] : null
    const barcodeHits = barcode ? byBarcode.get(barcode) || [] : null

    let hits
    if (skuHits && barcodeHits) {
      hits = skuHits.filter((p) => barcodeHits.includes(p))
      if (!hits.length) {
        if (!skuHits.length && !barcodeHits.length) return miss(`No product with sku "${sku}" or barcode "${barcode}"`)
        if (!skuHits.length) return miss(`No product with sku "${sku}" (barcode "${barcode}" belongs to "${barcodeHits[0].name}")`)
        if (!barcodeHits.length) return miss(`sku "${sku}" exists, but its barcode is "${text(skuHits[0].barcode) || 'empty'}", not "${barcode}"`)
        return miss(`sku "${sku}" and barcode "${barcode}" belong to different products — nothing deleted`)
      }
    } else if (skuHits) {
      hits = skuHits
      if (!hits.length) return miss(`No product with sku "${sku}"`)
    } else {
      hits = barcodeHits
      if (!hits.length) return miss(`No product with barcode "${barcode}"`)
    }

    const fresh = hits.filter((p) => !taken.has(p.id))
    if (!fresh.length) return miss('Same product is already listed in an earlier row')
    for (const p of fresh) {
      taken.add(p.id)
      matches.push({ index, product: p })
    }
    return undefined
  })

  return { matches, notFound }
}
