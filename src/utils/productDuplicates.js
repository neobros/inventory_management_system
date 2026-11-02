/**
 * Finds products in one shop that share a SKU, a barcode or a name. Pure.
 *
 * SKU and name compare ignoring case and outer spaces, the same way saving and
 * importing treat them; barcodes compare exactly (after trimming).
 */

const norm = (v) => String(v ?? '').trim()

function groupBy(products, keyOf) {
  const map = new Map()
  for (const p of products) {
    const key = keyOf(p)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(p)
  }
  return [...map.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, products: list }))
    .sort((a, b) => b.products.length - a.products.length || a.key.localeCompare(b.key))
}

export function findDuplicates(products) {
  return {
    sku: groupBy(products, (p) => norm(p.sku).toLowerCase()),
    barcode: groupBy(products, (p) => norm(p.barcode)),
    name: groupBy(products, (p) => norm(p.name).toLowerCase().replace(/\s+/g, ' ')),
  }
}
