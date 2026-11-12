/**
 * Shop Settings → Categories: rename or delete a category.
 *
 * Renaming moves every product in it to the new name. Deleting asks first
 * and says how many products it holds; those products are left with no
 * category, never deleted.
 */

import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../context/ToastContext'
import {
  listCategories, listProducts, renameCategory, deleteCategoryAndClear,
} from '../services/products'
import { ConfirmDialog } from './ui'

export default function CategoryManager({ shopId }) {
  const toast = useToast()
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // { key, value }
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([listCategories(shopId), listProducts(shopId)])
      .then(([c, p]) => { setCategories(c); setProducts(p) })
      .catch(() => toast.error('Could not load categories.'))
      .finally(() => setLoading(false))
  }, [shopId, toast])

  // Saved categories, plus names that only appear on products (from an import).
  const rows = useMemo(() => {
    const byName = new Map()
    categories.forEach((c) => byName.set(c.name, { id: c.id, name: c.name, productIds: [] }))
    products.forEach((p) => {
      const name = p.category || ''
      if (!name) return
      if (!byName.has(name)) byName.set(name, { id: null, name, productIds: [] })
      byName.get(name).productIds.push(p.id)
    })
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [categories, products])

  const keyOf = (r) => r.id || `name:${r.name}`

  const saveRename = async (row) => {
    const value = editing.value.trim()
    if (!value) return toast.error('Enter a category name.')
    if (value === row.name) { setEditing(null); return undefined }
    setBusy(true)
    try {
      const res = await renameCategory(shopId, row, value, row.productIds, categories)
      // Patch the screen rather than reading everything back.
      setProducts((list) => list.map((p) => (p.category === row.name ? { ...p, category: res.name } : p)))
      const fresh = await listCategories(shopId)
      setCategories(fresh)
      setEditing(null)
      toast.success(res.merged
        ? `Merged into "${res.name}". ${row.productIds.length} product(s) moved.`
        : `Renamed to "${res.name}". ${row.productIds.length} product(s) updated.`)
    } catch (err) {
      toast.error(err.message || 'Could not rename the category.')
    } finally {
      setBusy(false)
    }
    return undefined
  }

  const confirmDelete = async () => {
    setBusy(true)
    try {
      await deleteCategoryAndClear(shopId, deleting, deleting.productIds)
      const name = deleting.name
      setProducts((list) => list.map((p) => (p.category === name ? { ...p, category: '' } : p)))
      setCategories((list) => list.filter((c) => c.id !== deleting.id))
      toast.success(deleting.productIds.length
        ? `"${name}" deleted. ${deleting.productIds.length} product(s) now have no category.`
        : `"${name}" deleted.`)
      setDeleting(null)
    } catch (err) {
      toast.error(err.message || 'Could not delete the category.')
    } finally {
      setBusy(false)
    }
  }

  const uncategorised = products.filter((p) => !p.category).length

  return (
    <div className="card">
      <div className="card-head">
        <h2>Categories</h2>
        <span className="spacer text-sm text-muted">{rows.length} categories</span>
      </div>
      <div className="card-body" style={{ paddingTop: 4 }}>
        {loading ? <div className="text-muted text-sm">Loading…</div> : rows.length === 0 ? (
          <div className="text-muted text-sm">No categories yet. They are created when you add a product with a category.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Category</th><th className="num">Products</th><th className="num">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isEditing = editing?.key === keyOf(r)
                  return (
                    <tr key={keyOf(r)}>
                      <td>
                        {isEditing ? (
                          <input value={editing.value} autoFocus disabled={busy}
                            onChange={(e) => setEditing((x) => ({ ...x, value: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); saveRename(r) }
                              if (e.key === 'Escape') setEditing(null)
                            }} />
                        ) : r.name}
                      </td>
                      <td className="num">{r.productIds.length}</td>
                      <td className="num nowrap">
                        {isEditing ? (
                          <>
                            <button type="button" className="btn btn-sm" onClick={() => saveRename(r)} disabled={busy}>
                              {busy && <span className="spinner" />} Save
                            </button>{' '}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn-icon" title="Rename"
                              onClick={() => setEditing({ key: keyOf(r), value: r.name })}>✎</button>
                            <button type="button" className="btn btn-icon" title="Delete" onClick={() => setDeleting(r)}>🗑</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {uncategorised > 0 && (
          <p className="text-sm text-muted" style={{ marginBottom: 0 }}>{uncategorised} product(s) have no category.</p>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          message={deleting.productIds.length
            ? `${deleting.productIds.length} product(s) are in this category. They will NOT be deleted — they will be left with no category. Continue?`
            : 'No products are in this category.'}
          confirmLabel="Delete category"
          busy={busy}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
