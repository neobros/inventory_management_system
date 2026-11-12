import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { listProducts } from '../services/products'
import { listSales } from '../services/sales'
import { money, num, formatDate, startOfDay, toDate } from '../utils/format'
import { Stat, Empty, Loading, StockBadge } from '../components/ui'
import { stockValue as valueAtCost } from '../utils/batches'
import { useLang, translate as tr } from '../i18n/LanguageContext'

export default function Dashboard() {
  const { shopId, currency, shop } = useAuth()
  const toast = useToast()
  const { t } = useLang()
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
      toast.error(tr('Could not load dashboard data.'))
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
    // Each batch at what it cost, not all stock at one price.
    const stockValue = products.reduce((sum, p) => sum + valueAtCost(p), 0)
    const retailValue = products.reduce((sum, p) => sum + (Number(p.price) || 0) * (Number(p.stock) || 0), 0)

    return {
      todayRevenue: todaySales.reduce((sum, s) => sum
        + Math.max(0, (Number(s.total) || 0) - (Number(s.refundedTotal) || 0)), 0),
      todayBills: todaySales.length,
      todayDiscount: todaySales.reduce((sum, s) => sum + (Number(s.totalDiscount) || 0), 0),
      lowStock, outOfStock, stockValue, retailValue,
    }
  }, [products, sales])

  if (loading) return <Loading label="Crunching today's numbers…" />

  return (
    <>
      <div className="grid grid-4 mb-4">
        <Stat label={t("Today's revenue")} value={money(stats.todayRevenue, currency)}
          foot={t('{n} bills raised', { n: stats.todayBills })} icon="💰" tone="green" />
        <Stat label={t('Discount given today')} value={money(stats.todayDiscount, currency)}
          foot={t('Across all bills')} icon="🎁" tone="amber" />
        <Stat label={t('Products')} value={num(products.length)}
          foot={t('{n} out of stock', { n: stats.outOfStock.length })} icon="📦" tone="brand" />
        <Stat label={t('Stock value (at cost)')} value={money(stats.stockValue, currency)}
          foot={t('{amount} at retail', { amount: money(stats.retailValue, currency) })} icon="🏦" tone="blue" />
      </div>

      {stats.lowStock.length > 0 && (
        <div className="alert alert-amber mb-4">
          <span>⚠</span>
          <span>
            <strong>{stats.lowStock.length > 1
              ? t('{n} products need reordering.', { n: stats.lowStock.length })
              : t('{n} product needs reordering.', { n: stats.lowStock.length })}</strong>{' '}
            {t('Check the low-stock list below before your next supplier run.')}
          </span>
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <h2>{t('Recent bills')}</h2>
            <Link to="/sales" className="btn btn-ghost btn-sm spacer">{t('View all')}</Link>
          </div>
          <div className="card-body tight">
            {sales.length === 0 ? (
              <Empty icon="🧾" title={t('No sales yet')}
                message={t('Bills will appear here as soon as you start selling.')}
                action={<Link to="/pos" className="btn">{t('Open billing screen')}</Link>} />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>{t('Invoice')}</th><th>{t('When')}</th><th className="num">{t('Items')}</th><th className="num">{t('Total')}</th></tr>
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
            <h2>{t('Needs reordering')}</h2>
            <Link to="/products" className="btn btn-ghost btn-sm spacer">{t('Manage stock')}</Link>
          </div>
          <div className="card-body tight">
            {stats.lowStock.length === 0 ? (
              <Empty icon="✅" title={t('Stock levels are healthy')}
                message={t('No product has dropped to its reorder point.')} />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>{t('Product')}</th><th className="num">{t('Reorder at')}</th><th>{t('Status')}</th></tr>
                  </thead>
                  <tbody>
                    {stats.lowStock.slice(0, 8).map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="cell-title">{p.name}</div>
                          <div className="cell-sub">{p.supplier || t('No supplier set')}</div>
                        </td>
                        <td className="num">{p.lowStockAt}</td>
                        <td><StockBadge stock={p.stock} lowAt={p.lowStockAt} unit={p.unit} /></td>
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
              {t('Billing in {currency} · {paper} receipts', { currency, paper: shop?.paperSize })}
              {Number(shop?.taxRate) > 0 ? t(' · {rate}% tax', { rate: shop.taxRate }) : t(' · no tax')}
            </p>
          </div>
          <Link to="/pos" className="btn">{t('🧾 New bill')}</Link>
          <Link to="/products" className="btn btn-ghost">{t('+ Add product')}</Link>
          <Link to="/labels" className="btn btn-ghost">{t('🏷 Print labels')}</Link>
        </div>
      </div>
    </>
  )
}
