import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { authError } from '../utils/format'
import { Field } from '../components/ui'

export default function Login() {
  const { user, loading, login, resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  if (!loading && user) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(authError(err))
    } finally {
      setBusy(false)
    }
  }

  const forgot = async () => {
    if (!email.trim()) {
      setError('Enter your email address first, then tap “Forgot password”.')
      return
    }
    setError('')
    try {
      await resetPassword(email)
      setNotice('Password reset link sent. Check your inbox.')
    } catch (err) {
      setError(authError(err))
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">📦</div>
        <h1>StockPilot</h1>
        <p className="sub">Sign in to your shop</p>

        {error && <div className="alert alert-red mb-4"><span>⚠</span><span>{error}</span></div>}
        {notice && <div className="alert alert-blue mb-4"><span>✓</span><span>{notice}</span></div>}

        <Field label="Email address">
          <input
            type="email"
            className="input-lg"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@shop.com"
            autoComplete="username"
            required
            autoFocus
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            className="input-lg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </Field>

        <button type="submit" className="btn btn-lg btn-block mt-2" disabled={busy}>
          {busy && <span className="spinner" />} Sign in
        </button>

        <button type="button" className="btn btn-ghost btn-block mt-3" onClick={forgot}>
          Forgot password
        </button>
      </form>
    </div>
  )
}
