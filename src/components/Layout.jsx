import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isDesktop, appVersion } from '../utils/desktop'

const ROLE_LABEL = {
  superadmin: 'Platform Admin',
  owner: 'Shop Owner',
  manager: 'Manager',
  cashier: 'Cashier',
}

// `manageOnly` / `ownerOnly` must mirror the route guards in App.jsx. Listing a
// page a role cannot open just bounces them back to POS, which reads as broken.
const SHOP_NAV = [
  { group: 'Sell' },
  { to: '/pos', icon: '🧾', label: 'Billing / POS' },
  { to: '/sales', icon: '💳', label: 'Sales History' },
  { group: 'Inventory', manageOnly: true },
  { to: '/dashboard', icon: '📊', label: 'Dashboard', manageOnly: true },
  { to: '/products', icon: '📦', label: 'Products', manageOnly: true },
  { to: '/labels', icon: '🏷️', label: 'Barcode Labels', manageOnly: true },
  { to: '/item-list', icon: '🖨️', label: 'Print Item List', manageOnly: true },
  { to: '/stock', icon: '🔄', label: 'Stock Movements', manageOnly: true },
  { to: '/reports', icon: '📈', label: 'Reports', manageOnly: true },
  { group: 'Shop', manageOnly: true },
  { to: '/staff', icon: '👥', label: 'Staff Logins', ownerOnly: true },
  { to: '/settings', icon: '⚙️', label: 'Shop Settings', manageOnly: true },
]

const ADMIN_NAV = [
  { group: 'Platform' },
  { to: '/admin', icon: '🏬', label: 'Shops' },
  { to: '/admin/overview', icon: '📊', label: 'Overview' },
  { to: '/admin/import', icon: '📥', label: 'Import Products' },
  { to: '/admin/release', icon: '🚀', label: 'App Updates' },
]

const TITLES = {
  '/pos': ['Billing / POS', 'Scan items, apply discounts and print the bill'],
  '/sales': ['Sales History', 'Every bill raised by this shop'],
  '/dashboard': ['Dashboard', 'Today at a glance'],
  '/products': ['Products', 'Your catalogue and stock levels'],
  '/labels': ['Barcode Labels', 'Generate and print product barcodes'],
  '/stock': ['Stock Movements', 'Goods in, goods out and adjustments'],
  '/reports': ['Reports', 'Sales performance and inventory health'],
  '/staff': ['Staff Logins', 'Cashier and manager accounts'],
  '/settings': ['Shop Settings', 'Branding, currency, tax and receipt setup'],
  '/admin': ['Shops', 'Every shop on the platform'],
  '/admin/overview': ['Platform Overview', 'Tenant activity across all shops'],
  '/account': ['My Account', 'Your profile and password'],
  '/item-list': ['Print Item List', 'Every product with its SKU, on A4'],
  '/admin/import': ['Import Products', 'Add many products to a shop from JSON'],
  '/admin/release': ['App Updates', 'Publish a new till version to every shop'],
}

export default function Layout() {
  const { profile, shop, logout, canManage, isSuperAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')
  const { pathname } = useLocation()

  // Desktop till only — shown in the header so a shop can quote it on a support
  // call without hunting through menus.
  useEffect(() => {
    if (!isDesktop()) return
    appVersion().then(setVersion).catch(() => {})
  }, [])

  const nav = (isSuperAdmin ? ADMIN_NAV : SHOP_NAV).filter((i) => {
    if (i.ownerOnly) return profile?.role === 'owner'
    if (i.manageOnly) return canManage
    return true
  })
  const [title, subtitle] = TITLES[pathname] || [shop?.name || 'StockPilot', '']
  const initials = (profile?.name || profile?.email || '?').slice(0, 2).toUpperCase()

  return (
    <div className="app-shell">
      {open && <div className="scrim no-print" onClick={() => setOpen(false)} />}

      <aside className={`sidebar no-print ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          {shop?.logo ? (
            <img src={shop.logo} alt="" className="sidebar-logo" />
          ) : (
            <div className="sidebar-logo">{isSuperAdmin ? '★' : (shop?.name || 'S').charAt(0).toUpperCase()}</div>
          )}
          <div className="sidebar-brand-text">
            <strong>{isSuperAdmin ? 'StockPilot Admin' : shop?.name || 'StockPilot'}</strong>
            <span>{isSuperAdmin ? 'Platform control' : 'Inventory & POS'}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {nav.map((item, idx) =>
            item.group ? (
              <div key={`g${idx}`} className="nav-group-label">{item.group}</div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <span className="ico">{item.icon}</span>
                {item.label}
              </NavLink>
            )
          )}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-user">
            <div className="avatar">{initials}</div>
            <div className="sidebar-user-meta">
              <strong>{profile?.name || 'User'}</strong>
              <span style={{ textTransform: 'capitalize' }}>{profile?.role}</span>
            </div>
            <button type="button" className="btn btn-icon" title="Sign out" onClick={logout}
              style={{ color: '#94a3b8' }}>⏻</button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar no-print">
          <button type="button" className="burger" onClick={() => setOpen(true)} aria-label="Menu">☰</button>

          <div className="topbar-title">
            <h1>{title}</h1>
            {subtitle && <div className="topbar-sub">{subtitle}</div>}
          </div>

          <div className="topbar-actions">
            {!isSuperAdmin && shop && (
              <div className="topbar-chips">
                <span className="chip" title="Currency">{shop.currency}</span>
                <span className="chip" title="Receipt paper size">{shop.paperSize}</span>
                {shop.printerName && (
                  <span className="chip chip-ok" title={`Prints to ${shop.printerName}`}>
                    🖨 {shop.printerName}
                  </span>
                )}
              </div>
            )}

            {version && <span className="chip chip-quiet" title="Installed version">v{version}</span>}

            <NavLink to="/account" className="topbar-user" title="My Account">
              <span className="avatar" style={{ width: 30, height: 30, fontSize: 12 }}>{initials}</span>
              <span className="topbar-user-meta">
                <strong>{profile?.name || profile?.email}</strong>
                <span>{ROLE_LABEL[profile?.role] || profile?.role}</span>
              </span>
            </NavLink>
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
