import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { isDesktop, appVersion } from '../utils/desktop'
import { useToast } from '../context/ToastContext'
import { authError } from '../utils/format'
import { Field } from '../components/ui'
import { ROLES } from '../services/users'
import { setStoredPassword } from '../services/shops'

export default function Account() {
  const { profile, shop, changePassword, logout } = useAuth()
  const [tillVersion, setTillVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [updateNote, setUpdateNote] = useState('')

  useEffect(() => {
    if (isDesktop()) appVersion().then(setTillVersion).catch(() => {})
  }, [])

  /** Asks UpdateGate to re-check, and reports whatever it found. */
  const checkUpdates = () => {
    setChecking(true)
    setUpdateNote('')
    const messages = {
      available: '',                       // the popup speaks for itself
      'up-to-date': 'You are on the latest version.',
      'none-published': 'No update has been published yet.',
      error: 'Could not reach the update server. Check your internet connection.',
    }
    window.dispatchEvent(new CustomEvent('sp:check-update', {
      detail: {
        done: (outcome) => {
          setChecking(false)
          setUpdateNote(messages[outcome] ?? '')
        },
      },
    }))
    // Never leave the button spinning if nothing answers.
    setTimeout(() => setChecking(false), 8000)
  }
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (next.length < 6) return toast.error('New password must be at least 6 characters.')
    if (next !== confirm) return toast.error('The two new passwords do not match.')

    setBusy(true)
    try {
      await changePassword(current, next)

      // A shop owner's password is also held by the platform admin so it can be
      // handed back if forgotten. Keep that copy in step with the change.
      if (profile?.role === 'owner' && profile?.shopId) {
        try {
          await setStoredPassword(profile.shopId, profile.email, next)
        } catch {
          // Not fatal — the password itself did change.
        }
      }
      toast.success('Password updated.')
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err) {
      toast.error(authError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-narrow">
      <div className="card mb-4">
        <div className="card-head"><h2>Profile</h2></div>
        <div className="card-body">
          <div className="row">
            <Field label="Name"><input value={profile?.name || '—'} disabled /></Field>
            <Field label="Email"><input value={profile?.email || '—'} disabled /></Field>
          </div>
          <div className="row">
            <Field label="Role"><input value={ROLES[profile?.role] || profile?.role} disabled /></Field>
            <Field label="Shop"><input value={shop?.name || 'Platform (all shops)'} disabled /></Field>
          </div>
        </div>
      </div>

      {isDesktop() && (
        <div className="card">
          <div className="card-head">
            <h2>App version</h2>
            <span className="badge badge-grey spacer">v{tillVersion || '—'}</span>
          </div>
          <div className="card-body">
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              Updates are published by the administrator and offered automatically when
              you open the till.
            </p>
            <div className="flex gap-2 mt-3">
              <button type="button" className="btn btn-ghost" disabled={checking}
                onClick={checkUpdates}>
                {checking && <span className="spinner spinner-dark" />} Check for updates
              </button>
            </div>
            {updateNote && <div className="alert alert-blue mt-3">{updateNote}</div>}
          </div>
        </div>
      )}

      {/* A shop owner's password is held by the platform admin so it can be
          handed back if forgotten. Letting the owner change it here would put
          that copy out of sync and lock the admin out of managing it. */}
      <form className="card" onSubmit={submit}>
        <div className="card-head">
          <h2>Change password</h2>
        </div>
        <div className="card-body">
          <Field label="Current password" required>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password" required />
          </Field>
          <div className="row">
            <Field label="New password" required hint="Minimum 6 characters">
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password" required />
            </Field>
            <Field label="Repeat new password" required>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" required />
            </Field>
          </div>
          <div className="flex gap-2 mt-3">
            <button type="submit" className="btn" disabled={busy}>
              {busy && <span className="spinner" />} Update password
            </button>
            <button type="button" className="btn btn-ghost" onClick={logout}>Sign out</button>
          </div>
        </div>
      </form>
    </div>
  )
}
