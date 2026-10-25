/**
 * Which page numbers to show, given the current page and the total.
 *
 * Always includes the first and last page so the ends stay reachable, plus the
 * current page and its neighbours. `null` marks an elided run, rendered as "…".
 * Kept separate from the component so it can be tested directly.
 */
export function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)

  const out = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pages - 1, page + 1)

  if (start > 2) out.push(null)
  for (let i = start; i <= end; i += 1) out.push(i)
  if (end < pages - 1) out.push(null)
  out.push(pages)
  return out
}

/** The slice of `items` shown on `page`, 1-indexed. */
export function pageSlice(items, page, size) {
  return items.slice((page - 1) * size, page * size)
}
