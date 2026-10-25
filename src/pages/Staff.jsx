import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  listShopUsers, createStaffUser, updateUser, removeUser, ROLES,
  listStaffCredentials, changeStaffPassword,
} from '../services/users'
import { authError, formatDate } from '../utils/format'
import { Modal, ConfirmDialog, Field, Empty, Loading } from '../components/ui'

const BLANK = { name: '', email: '', password: '', role: 'cashier' }

const ROLE_HELP = {
  cashier: 'Can raise bills and view sales. Cannot see costs, reports or settings.',
  manager: 'Everything a cashier can do, plus products, stock, reports and shop settings.',
}

export default function Staff() {
  const { shopId, profile } = useAuth()
  const toast = useToast()

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [removingUser, setRemovingUser] = useState(null)

  // Stored staff passwords, so the owner can look one up or reset it.
  const [creds, setCreds] = useState({})
  const [resetting, setResetting] = useState(null)   // the user being reset
  const [newPassword, setNewPassword] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [revealed, setRevealed] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, credentials] = await Promise.all([
        listShopUsers(shopId),
        listStaffCredentials(shopId).catch(() => ({})),
      ])
      setUsers(list)
      setCreds(credentials)
    } catch {
      toast.error('Could not load staff accounts.')
    } finally {
      setLoading(false)
    }
  }, [shopId, toast])

  useEffect(() => { load() }, [load])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (form.password.length < 6) return toast.error('Password must be at least 6 characters.')

    setSaving(true)
    try {
      await createStaffUser({ shopId, ...form })
      toast.success(`${form.name} can now sign in.`)
      setForm(BLANK)
      setCreating(false)
      await load()
    } catch (err) {
      toast.error(authError(err))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (user) => {
    try {
      await updateUser(user.uid, { active: user.active === false })
      await load()
      toast.success(user.active === false ? 'Access restored.' : 'Access suspended.')
    } catch {
      toast.error('Could not update that account.')
    }
  }

  const confirmRemove = async () => {
    try {
      await removeUser(removingUser.uid, shopId)
      toast.success('Staff member removed.')
      setRemovingUser(null)
      await load()
    } catch {
      toast.error('Could not remove that account.')
    }
  }

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied.`)
    } catch {
      toast.error('Could not copy — select the text and copy it manually.')
    }
  }

  const submitReset = async (e) => {
    e.preventDefault()
    if (newPassword.trim().length < 6) return toast.error('Password must be at least 6 characters.')

    setPwBusy(true)
    try {
      await changeStaffPassword({
        shopId,
        uid: resetting.uid,
        email: resetting.email,
        currentPassword: creds[resetting.uid]?.password,
        newPassword: newPassword.trim(),
      })
      setCreds((c) => ({
        ...c,
        [resetting.uid]: { email: resetting.email, password: newPassword.trim(), updatedAt: new Date() },
      }))
      setRevealed((r) => ({ ...r, [resetting.uid]: true }))
      toast.success(`Password reset. Give ${resetting.name || resetting.email} the new one.`)
      setResetting(null)
      setNewPassword('')
    } catch (err) {
      toast.error(err.message || 'Could not reset the password.')
    } finally {
      setPwBusy(false)
    }
    return undefined
  }

  if (loading) return <Loading label="Loading staff…" />

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Staff logins</h2>
          <button type="button" className="btn spacer" onClick={() => { setForm(BLANK); setCreating(true) }}>
            + Add staff member
          </button>
        </div>
        <div className="card-body tight">
          {users.length === 0 ? (
            <Empty icon="👥" title="No staff accounts yet"
              message="Give your cashiers their own login so every bill records who raised it." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th><th>Status</th><th>Added</th><th className="num">Actions</th></tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const self = u.uid === profile?.uid
                    return (
                      <tr key={u.uid}>
                        <td className="cell-title">
                          {u.name || '—'}
                          {self && <span className="badge badge-brand" style={{ marginLeft: 7 }}>You</span>}
                        </td>
                        <td className="text-sm">{u.email}</td>
                        <td><span className="badge badge-grey">{ROLES[u.role] || u.role}</span></td>
                        <td className="nowrap">
                          {creds[u.uid]?.password ? (
                            <span className="flex gap-2 items-center">
                              <span className="mono text-sm">
                                {revealed[u.uid] ? creds[u.uid].password : '•'.repeat(8)}
                              </span>
                              <button type="button" className="btn btn-icon"
                                title={revealed[u.uid] ? 'Hide' : 'Show'}
                                onClick={() => setRevealed((r) => ({ ...r, [u.uid]: !r[u.uid] }))}>
                                {revealed[u.uid] ? '🙈' : '👁'}
                              </button>
                              <button type="button" className="btn btn-icon" title="Copy password"
                                onClick={() => copyText(creds[u.uid].password, 'Password')}>📋</button>
                            </span>
                          ) : (
                            <span className="text-sm text-muted">not recorded</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${u.active === false ? 'badge-red' : 'badge-green'}`}>
                            {u.active === false ? 'Suspended' : 'Active'}
                          </span>
                        </td>
                        <td className="text-sm text-muted nowrap">{formatDate(u.createdAt, false)}</td>
                        <td className="num nowrap">
                          {!self && u.role !== 'owner' && (
                            <>
                              <button type="button" className="btn btn-ghost btn-sm"
                                onClick={() => { setResetting(u); setNewPassword('') }}>
                                Reset password
                              </button>{' '}
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleActive(u)}>
                                {u.active === false ? 'Restore' : 'Suspend'}
                              </button>{' '}
                              <button type="button" className="btn btn-icon" title="Remove"
                                onClick={() => setRemovingUser(u)}>🗑</button>
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
        </div>
      </div>

      <div className="alert alert-blue mt-4">
        <span>ℹ</span>
        <span>
          Removing a staff member revokes their access to this shop immediately. Their
          sign-in record stays in Firebase Authentication — delete it there if you want the
          email freed up for reuse.
        </span>
      </div>

      {creating && (
        <Modal
          title="Add staff member"
          subtitle="They sign in with this email and password."
          onClose={() => setCreating(false)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)} disabled={saving}>Cancel</button>
              <button type="submit" form="staff-form" className="btn" disabled={saving}>
                {saving && <span className="spinner" />} Create login
              </button>
            </>
          }
        >
          <form id="staff-form" onSubmit={submit}>
            <Field label="Full name" required>
              <input value={form.name} onChange={set('name')} required autoFocus placeholder="e.g. Nimal Perera" />
            </Field>
            <Field label="Email address" required hint="Used as the username at sign-in.">
              <input type="email" value={form.email} onChange={set('email')} required placeholder="cashier@shop.com" />
            </Field>
            <Field label="Password" required hint="Minimum 6 characters. Share it with them privately.">
              <input type="text" className="mono" value={form.password} onChange={set('password')} required
                placeholder="Set a starting password" />
            </Field>
            <Field label="Role" hint={ROLE_HELP[form.role]}>
              <select value={form.role} onChange={set('role')}>
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
              </select>
            </Field>
          </form>
        </Modal>
      )}


      {resetting && (
        <Modal
          title={`Reset password — ${resetting.name || resetting.email}`}
          subtitle={resetting.email}
          onClose={() => setResetting(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setResetting(null)} disabled={pwBusy}>
                Cancel
              </button>
              <button type="submit" form="staff-pw-form" className="btn" disabled={pwBusy || !newPassword.trim()}>
                {pwBusy && <span className="spinner" />} Reset password
              </button>
            </>
          }
        >
          <form id="staff-pw-form" onSubmit={submitReset}>
            <Field label="New password" required hint="At least 6 characters. Tell them their new password.">
              <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                autoFocus autoComplete="new-password" placeholder="New password" />
            </Field>
          </form>

          {!creds[resetting.uid]?.password && (
            <div className="alert alert-amber">
              <span>!</span>
              <span>
                No password on record for this login — it was created before passwords were
                stored here. Ask the platform administrator to reset it.
              </span>
            </div>
          )}
        </Modal>
      )}

      {removingUser && (
        <ConfirmDialog
          title="Remove staff member"
          message={`${removingUser.name || removingUser.email} will lose access to this shop straight away.`}
          confirmLabel="Remove"
          onConfirm={confirmRemove}
          onClose={() => setRemovingUser(null)}
        />
      )}
    </>
  )
}
