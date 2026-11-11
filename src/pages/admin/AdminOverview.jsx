import { useCallback, useEffect, useState } from 'react'
import { getCountFromServer } from 'firebase/firestore'
import { useToast } from '../../context/ToastContext'
import { listShops } from '../../services/shops'
import { productsRef } from '../../services/products'
import { salesRef, listSales } from '../../services/sales'
import { money, num, daysAgo, toDate, formatDate } from '../../utils/format'
import { Stat, Empty, Loading } from '../../components/ui'

/**
 * Cross-tenant activity. Product and bill counts come from Firestore's
 * aggregate count API so a large shop does not have to be downloaded just to
 * be tallied; revenue needs the documents themselves, so it is scoped to the
 * last 30 days.
 */
export default function AdminOverview() {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const shops = await listShops()
      const since = daysAgo(30)

      const stats = await Promise.all(shops.map(async (shop) => {
        try {
          const [productCount, billCount, recent] = await Promise.all([
            getCountFromServer(productsRef(shop.id)),
            getCountFromServer(salesRef(shop.id)),
            listSales(shop.id, { max: 500 }),
          ])

          const scoped = recent.filter((s) => (toDate(s.createdAt) || 0) >= since)
          return {
            shop,
            products: productCount.data().count,
            bills: billCount.data().count,
            revenue30: scoped.reduce((sum, s) => sum + (Number(s.total) || 0), 0),
            bills30: scoped.length,
            lastSale: recent[0]?.createdAt || null,
          }
        } catch {
          // A shop with locked-down rules should not break the whole table.
          return { shop, products: 0, bills: 0, revenue30: 0, bills30: 0, lastSale: null, error: true }
        }
      }))

      setRows(stats)
    } catch {
      toast.error('Could not load platform data.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  if (loading) return <Loading label="Gathering data from every shop…" />

  const totals = rows.reduce((acc, r) => ({
    products: acc.products + r.products,
    bills: acc.bills + r.bills,
    bills30: acc.bills30 + r.bills30,
  }), { products: 0, bills: 0, bills30: 0 })

  const activeShops = rows.filter((r) => r.bills30 > 0).length

  return (
    <>
      <div className="grid grid-4 mb-4">
        <Stat label="Shops" value={rows.length} foot={`${activeShops} trading this month`} icon="🏬" tone="brand" />
        <Stat label="Products catalogued" value={num(totals.products)} foot="Across all tenants" icon="📦" tone="blue" />
        <Stat label="Bills all time" value={num(totals.bills)} icon="🧾" tone="green" />
        <Stat label="Bills last 30 days" value={num(totals.bills30)} icon="📈" tone="amber" />
      </div>

      <div className="alert alert-blue mb-4">
        <span>ℹ</span>
        <span>
          Revenue is shown per shop in each shop's own currency, so the figures are not
          summed into a platform total.
        </span>
      </div>

      <div className="card">
        <div className="card-head"><h2>Shop activity</h2></div>
        <div className="card-body tight">
          {rows.length === 0 ? (
            <Empty icon="🏬" title="No shops yet" message="Create a shop to see activity here." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Shop</th><th className="num">Products</th><th className="num">Bills (all time)</th>
                    <th className="num">Bills (30d)</th><th className="num">Revenue (30d)</th>
                    <th>Last sale</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ shop, products, bills, bills30, revenue30, lastSale, error }) => (
                    <tr key={shop.id}>
                      <td>
                        <div className="flex gap-2 items-center">
                          <div className="sidebar-logo" style={{ width: 30, height: 30, fontSize: 13, borderRadius: 8 }}>
                            {shop.logo
                              ? <img src={shop.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : (shop.name || 'S').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="cell-title">{shop.name}</div>
                            <div className="cell-sub">{shop.ownerEmail}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">{error ? '—' : num(products)}</td>
                      <td className="num">{error ? '—' : num(bills)}</td>
                      <td className="num">{error ? '—' : num(bills30)}</td>
                      <td className="num strong">{error ? '—' : money(revenue30, shop.currency)}</td>
                      <td className="text-sm text-muted nowrap">{lastSale ? formatDate(lastSale) : 'Never'}</td>
                      <td>
                        <span className={`badge ${shop.active === false ? 'badge-red' : bills30 > 0 ? 'badge-green' : 'badge-grey'}`}>
                          {shop.active === false ? 'Suspended' : bills30 > 0 ? 'Trading' : 'Idle'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
