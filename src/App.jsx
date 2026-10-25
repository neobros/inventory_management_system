import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import { isDesktop } from './utils/desktop'

import Login from './pages/Login'
import Account from './pages/Account'
import Dashboard from './pages/Dashboard'
import POS from './pages/POS'
import Sales from './pages/Sales'
import Products from './pages/Products'
import Labels from './pages/Labels'
import Stock from './pages/Stock'
import Reports from './pages/Reports'
import Staff from './pages/Staff'
import Settings from './pages/Settings'
import AdminShops from './pages/admin/AdminShops'
import AdminOverview from './pages/admin/AdminOverview'
import AdminRelease from './pages/admin/AdminRelease'
import UpdateGate from './components/UpdateGate'
import TitleBar from './components/TitleBar'

/**
 * file:// has no usable history API — pushing "/login" there resolves to
 * file:///D:/login and the app dies. Keyed off the protocol rather than the
 * Electron bridge so a failed preload degrades to a working app instead of a
 * blank window.
 */
const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:'
const Router = isDesktop() || isFileProtocol ? HashRouter : BrowserRouter

// Shifts the layout down to clear the app-painted title strip.
if (typeof document !== 'undefined' && isDesktop()) {
  document.body.classList.add('desktop-chrome')
}

/** Where a user lands after sign-in, based on what they are allowed to do. */
function homeFor(profile) {
  if (profile?.role === 'superadmin') return '/admin'
  if (profile?.role === 'cashier') return '/pos'
  return '/dashboard'
}

function Guard({ allow, children }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Loading label="Signing you in…" />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />

  if (profile?.role === 'none') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">🔒</div>
          <h1>No shop assigned</h1>
          <p className="sub">
            This login exists but is not linked to a shop yet. Ask your administrator to
            finish setting up your account.
          </p>
          <SignOutButton />
        </div>
      </div>
    )
  }

  if (profile && profile.active === false) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">⛔</div>
          <h1>Account disabled</h1>
          <p className="sub">Your access has been switched off. Contact your shop owner.</p>
          <SignOutButton />
        </div>
      </div>
    )
  }

  // The till is a shop tool. Platform administration lives on the web app, so
  // a super admin signing in here is told where to go rather than shown a
  // half-usable panel.
  if (isDesktop() && profile?.role === 'superadmin') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-logo">🖥️</div>
          <h1>Admin panel is on the web</h1>
          <p className="sub">
            This is the shop till app. Sign in to the web application to create
            shops and manage the platform.
          </p>
          <SignOutButton />
        </div>
      </div>
    )
  }

  if (allow && !allow.includes(profile?.role)) {
    return <Navigate to={homeFor(profile)} replace />
  }
  return children
}

function SignOutButton() {
  const { logout } = useAuth()
  return (
    <button type="button" className="btn btn-ghost btn-block" onClick={logout}>Sign out</button>
  )
}

function RootRedirect() {
  const { user, profile, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={homeFor(profile)} replace />
}

const SHOP_ROLES = ['owner', 'manager', 'cashier']
const MANAGER_ROLES = ['owner', 'manager']

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <ToastProvider>
          {/* Both render nothing on the web. */}
          <TitleBar />
          <UpdateGate />
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<Guard><Layout /></Guard>}>
              <Route path="/account" element={<Account />} />

              <Route path="/dashboard" element={<Guard allow={MANAGER_ROLES}><Dashboard /></Guard>} />
              <Route path="/pos" element={<Guard allow={SHOP_ROLES}><POS /></Guard>} />
              <Route path="/sales" element={<Guard allow={SHOP_ROLES}><Sales /></Guard>} />
              <Route path="/products" element={<Guard allow={MANAGER_ROLES}><Products /></Guard>} />
              <Route path="/labels" element={<Guard allow={MANAGER_ROLES}><Labels /></Guard>} />
              <Route path="/stock" element={<Guard allow={MANAGER_ROLES}><Stock /></Guard>} />
              <Route path="/reports" element={<Guard allow={MANAGER_ROLES}><Reports /></Guard>} />
              <Route path="/staff" element={<Guard allow={['owner']}><Staff /></Guard>} />
              <Route path="/settings" element={<Guard allow={MANAGER_ROLES}><Settings /></Guard>} />

              <Route path="/admin" element={<Guard allow={['superadmin']}><AdminShops /></Guard>} />
              <Route path="/admin/overview" element={<Guard allow={['superadmin']}><AdminOverview /></Guard>} />
              <Route path="/admin/release" element={<Guard allow={['superadmin']}><AdminRelease /></Guard>} />
            </Route>

            <Route path="/" element={<RootRedirect />} />
            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </Router>
  )
}
