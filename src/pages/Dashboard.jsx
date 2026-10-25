import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { listProducts } from '../services/products'
import { listSales } from '../services/sales'
import { money, num, formatDate, startOfDay, toDate } from '../utils/format'
import { Stat, Empty, Loading, StockBadge } from '../components/ui'

export default function Dashboard() {
  const { shopId, currency, shop } = useAuth()
  const toast = useToast()
  const [products, setProducts] = useState([])
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, s] = await Promise.all([listProducts(shopId), listSales(shopId, { max: 400 })])
      setProducts(p)
      setSales(s)
    } catch {
      toast.error('Could not load dashboard data.')
    } finally {
      setLoading(false)
    }
  }, [shopId, toast])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => {
    const today = startOfDay()
    const todaySales = sales.filter((s) => (toDate(s.createdAt) || 0) >= today)

    const lowStock = products.filter(
      (p) => p.lowStockAt > 0 && Number(p.stock) <= Number(p.lowStockAt)
    )
    const outOfStock = products.filter((p) => Number(p.stock) <= 0)
    const stockValue = products.reduce((sum, p) => sum + (Number(p.cost) || 0) * (Number(p.stock) || 0), 0)
    const retailValue = products.reduce((sum, p) => sum + (Number(p.price) || 0) * (Number(p.stock) || 0), 0)

    return {
      todayRevenue: todaySales.reduce((sum, s) => sum + (Number(s.total) || 0), 0),
      todayBills: todaySales.length,
      todayDiscount: todaySales.reduce((sum, s) => sum + (Number(s.totalDiscount) || 0), 0),
      lowStock, outOfStock, stockValue, retailValue,
    }
  }, [products, sales])

  if (loading) return <Loading label="Crunching today's numbers…" />

  return (
    <>
      <div className="grid grid-4 mb-4">
        <Stat label="Today's revenue" value={money(stats.todayRevenue, currency)}
          foot={`${stats.todayBills} bills raised`} icon="💰" tone="green" />
        <Stat label="Discount given today" value={money(stats.todayDiscount, currency)}
          foot="Across all bills" icon="🎁" tone="amber" />
        <Stat label="Products" value={num(products.length)}
          foot={`${stats.outOfStock.length} out of stock`} icon="📦" tone="brand" />
        <Stat label="Stock value (at cost)" value={money(stats.stockValue, currency)}
          foot={`${money(stats.retailValue, currency)} at retail`} icon="🏦" tone="blue" />
      </div>

      {stats.lowStock.length > 0 && (
        <div className="alert alert-amber mb-4">
          <span>⚠</span>
          <span>
            <strong>{stats.lowStock.length} product{stats.lowStock.length > 1 ? 's need' : ' needs'} reordering.</strong>{' '}
            Check the low-stock list below before your next supplier run.
          </span>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Recent bills</h2>
            <Link to="/sales" className="btn btn-ghost btn-sm spacer">View all</Link>
          </div>
          <div className="card-body tight">
            {sales.length === 0 ? (
              <Empty icon="🧾" title="No sales yet"
                message="Bills will appear here as soon as you start selling."
                action={<Link to="/pos" className="btn">Open billing screen</Link>} />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Invoice</th><th>When</th><th className="num">Items</th><th className="num">Total</th></tr>
                  </thead>
                  <tbody>
                    {sales.slice(0, 8).map((s) => (
                      <tr key={s.id}>
                        <td className="cell-title">#{s.invoiceNo}</td>
                        <td className="text-sm text-muted nowrap">{formatDate(s.createdAt)}</td>
                        <td className="num">{s.itemCount}</td>
                        <td className="num strong">{money(s.total, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Needs reordering</h2>
            <Link to="/products" className="btn btn-ghost btn-sm spacer">Manage stock</Link>
          </div>
          <div className="card-body tight">
            {stats.lowStock.length === 0 ? (
              <Empty icon="✅" title="Stock levels are healthy"
                message="No product has dropped to its reorder point." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Product</th><th className="num">Reorder at</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {stats.lowStock.slice(0, 8).map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="cell-title">{p.name}</div>
                          <div className="cell-sub">{p.supplier || 'No supplier set'}</div>
                        </td>
                        <td className="num">{p.lowStockAt}</td>
                        <td><StockBadge stock={p.stock} lowAt={p.lowStockAt} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-body flex gap-3 wrap items-center">
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3>{shop?.name}</h3>
            <p className="text-sm text-muted">
              Billing in {currency} · {shop?.paperSize} receipts
              {Number(shop?.taxRate) > 0 ? ` · ${shop.taxRate}% tax` : ' · no tax'}
            </p>
          </div>
          <Link to="/pos" className="btn">🧾 New bill</Link>
          <Link to="/products" className="btn btn-ghost">+ Add product</Link>
          <Link to="/labels" className="btn btn-ghost">🏷 Print labels</Link>
        </div>
      </div>
    </>
  )
}
