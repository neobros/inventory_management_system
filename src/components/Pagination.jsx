import { useEffect, useMemo, useState } from 'react'
import { pageList, pageSlice } from '../utils/pagination'

/**
 * Client-side paging for the table screens.
 *
 * The lists are already in memory — a shop's catalogue or a month of bills —
 * so this splits what is rendered rather than what is fetched. Rendering a few
 * thousand rows at once is what makes these screens crawl.
 */
export function usePagination(items, initialSize = 25) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(initialSize)

  const total = items.length
  const pages = Math.max(1, Math.ceil(total / size))

  // Filtering can shrink the list under the current page — go back to the start
  // rather than showing an empty table.
  useEffect(() => {
    if (page > pages) setPage(1)
  }, [pages, page])

  const slice = useMemo(
    () => pageSlice(items, page, size),
    [items, page, size]
  )

  return {
    slice,
    page,
    pages,
    size,
    total,
    setPage,
    setSize: (n) => { setSize(n); setPage(1) },
    first: total === 0 ? 0 : (page - 1) * size + 1,
    last: Math.min(page * size, total),
  }
}

export default function Pagination({ pager, label = 'rows', sizes = [25, 50, 100, 200] }) {
  const { page, pages, size, total, setPage, setSize, first, last } = pager

  // One page of results needs no controls, but the count is still useful.
  if (total === 0) return null

  return (
    <div className="pagination no-print">
      <span className="pagination-count">
        {first}–{last} of {total} {label}
      </span>

      <div className="pagination-controls">
        {pages > 1 && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" disabled={page === 1}
              onClick={() => setPage(page - 1)}>‹ Prev</button>

            {pageList(page, pages).map((n, i) => (n === null ? (
              // eslint-disable-next-line react/no-array-index-key -- gaps have no id
              <span key={`gap-${i}`} className="pagination-gap">…</span>
            ) : (
              <button key={n} type="button"
                className={`btn btn-sm ${n === page ? '' : 'btn-ghost'}`}
                onClick={() => setPage(n)}>{n}</button>
            )))}

            <button type="button" className="btn btn-ghost btn-sm" disabled={page === pages}
              onClick={() => setPage(page + 1)}>Next ›</button>
          </>
        )}

        <select value={size} onChange={(e) => setSize(Number(e.target.value))}
          className="pagination-size" aria-label={`${label} per page`}>
          {sizes.map((n) => <option key={n} value={n}>{n} per page</option>)}
        </select>
      </div>
    </div>
  )
}
