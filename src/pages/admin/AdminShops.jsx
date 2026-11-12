import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import {
  listShops, createShopWithOwner, updateShop, setShopActive, deleteShop, DEFAULT_SHOP, getShopCredentials, changeShopPassword,
} from '../../services/shops'
import { resetShopPassword, adminApiAvailable } from '../../services/adminApi'
import { fileToLogo } from '../../utils/image'
import { authError, formatDate } from '../../utils/format'
import { Modal, ConfirmDialog, Field, Empty, Loading, Stat } from '../../components/ui'
import Pagination, { usePagination } from '../../components/Pagination'
import { useLang, translate as tr } from '../../i18n/LanguageContext'

const BLANK = {
  name: '', email: '', password: '',
  currency: 'Rs.', paperSize: '80mm', taxRate: 0,
  phone: '', address: '', logo: '', receiptFooter: DEFAULT_SHOP.receiptFooter,
}

/**
 * Platform control panel: provision tenants, brand them and switch them on or
 * off. Each shop gets one owner login at creation; the owner adds their own
 * staff from inside the shop.
 */
export default function AdminShops() {
  const { profile } = useAuth()
  const toast = useToast()
  const { t } = useLang()
  const fileRef = useRef(null)

  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [search, setSearch] = useState('')

  // Login manager: which shop is open, its stored credentials, and the form.
  const [loginFor, setLoginFor] = useState(null)
  const [creds, setCreds] = useState(null)
  const [credsLoading, setCredsLoading] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [apiUp, setApiUp] = useState(true)

  const load = useCallback(async () => {
    // No setLoading(true) here: the spinner is for the first load only. Refreshing
    // after a save must not swap the page for a spinner — that looked like a reload.
    try {
      setShops(await listShops())
    } catch {
      toast.error(tr('Could not load shops.'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const pickLogo = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const logo = await fileToLogo(file)
      setForm((f) => ({ ...f, logo }))
    } catch (err) {
      toast.error(err.message)
    } finally {
      e.target.value = ''
    }
  }

  const openCreate = () => { setForm(BLANK); setCreating(true) }

  const openEdit = (shop) => {
    setForm({
      name: shop.name || '', email: shop.ownerEmail || '', password: '',
      currency: shop.currency || 'Rs.', paperSize: shop.paperSize || '80mm',
      taxRate: shop.taxRate ?? 0, phone: shop.phone || '', address: shop.address || '',
      logo: shop.logo || '', receiptFooter: shop.receiptFooter || '',
    })
    setEditing(shop)
  }

  const submitCreate = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error(t('Shop name is required.'))
    if (form.password.length < 6) return toast.error(t('Password must be at least 6 characters.'))

    setSaving(true)
    try {
      await createShopWithOwner({
        shop: {
          name: form.name.trim(), currency: form.currency, paperSize: form.paperSize,
          taxRate: Number(form.taxRate) || 0, phone: form.phone, address: form.address,
          logo: form.logo, receiptFooter: form.receiptFooter,
        },
        email: form.email.trim(),
        password: form.password,
      })
      toast.success(t('{name} is live. Share the login with the owner.', { name: form.name }))
      setCreating(false)
      await load()
    } catch (err) {
      toast.error(authError(err))
    } finally {
      setSaving(false)
    }
  }

  const submitEdit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateShop(editing.id, {
        name: form.name.trim(), currency: form.currency, paperSize: form.paperSize,
        taxRate: Number(form.taxRate) || 0, phone: form.phone, address: form.address,
        logo: form.logo, receiptFooter: form.receiptFooter,
      })
      toast.success(t('Shop updated.'))
      setEditing(null)
      await load()
    } catch (err) {
      toast.error(err.message || t('Could not update the shop.'))
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (shop) => {
    try {
      await setShopActive(shop.id, shop.active === false)
      toast.success(shop.active === false ? t('Shop reactivated.') : t('Shop suspended.'))
      await load()
    } catch {
      toast.error(t('Could not change the shop status.'))
    }
  }

  const confirmDelete = async () => {
    try {
      await deleteShop(deleting.id)
      toast.success(t('Shop record deleted.'))
      setDeleting(null)
      await load()
    } catch {
      toast.error(t('Could not delete the shop.'))
    }
  }

  // Declared before the pager: usePagination is a hook, so it has to run ahead
  // of the loading early-return — and it reads `rows`. Declaring `rows` further
  // down threw "Cannot access 'rows' before initialization" and blanked the page.
  const rows = shops.filter((s) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return s.name?.toLowerCase().includes(q) || s.ownerEmail?.toLowerCase().includes(q)
  })
  const active = shops.filter((s) => s.active !== false).length

  const pager = usePagination(rows)

  if (loading) return <Loading label="Loading shops…" />

  const openLogin = async (shop) => {
    setLoginFor(shop)
    setReveal(false)
    setNewPassword('')
    setCreds(null)
    setCredsLoading(true)
    try {
      setApiUp(await adminApiAvailable())
      setCreds(await getShopCredentials(shop.id))
    } catch {
      toast.error(t('Could not read the stored login.'))
    } finally {
      setCredsLoading(false)
    }
  }

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('{label} copied.', { label }))
    } catch {
      toast.error(t('Could not copy — select the text and copy manually.'))
    }
  }

  const submitPassword = async (e) => {
    e.preventDefault()
    if (newPassword.trim().length < 6) return toast.error(t('Password must be at least 6 characters.'))

    setPwBusy(true)
    try {
      // The admin service can set any password outright. If it is not running,
      // fall back to the browser method, which needs the stored current one.
      try {
        await resetShopPassword({
          shopId: loginFor.id,
          email: loginFor.ownerEmail,
          password: newPassword.trim(),
        })
      } catch (apiErr) {
        if (!apiErr.offline) throw apiErr
        await changeShopPassword(loginFor.id, {
          email: loginFor.ownerEmail,
          currentPassword: creds?.password,
          newPassword: newPassword.trim(),
        })
      }

      setCreds({ email: loginFor.ownerEmail, password: newPassword.trim(), updatedAt: new Date() })
      setNewPassword('')
      setReveal(true)
      toast.success(t('Password changed. Give the shop their new password.'))
    } catch (err) {
      toast.error(err.message || t('Could not change the password.'))
    } finally {
      setPwBusy(false)
    }
  }

  const brandingFields = (
    <>
      <Field label={t('Shop logo / icon')} hint={t("Appears in the shop's sidebar and on its printed bills.")}>
        <div className="flex gap-3 items-center">
          <div className="sidebar-logo" style={{ width: 54, height: 54, fontSize: 22 }}>
            {form.logo
              ? <img src={form.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (form.name || 'S').charAt(0).toUpperCase()}
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>{t('Upload')}</button>
          {form.logo && (
            <button type="button" className="btn btn-ghost" onClick={() => setForm((f) => ({ ...f, logo: '' }))}>
              {t('Remove')}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={pickLogo} style={{ display: 'none' }} />
        </div>
      </Field>

      <div className="row">
        <Field label={t('Currency symbol')}>
          <input value={form.currency} onChange={set('currency')} maxLength={5} />
        </Field>
        <Field label={t('Receipt paper')}>
          <select value={form.paperSize} onChange={set('paperSize')}>
            <option value="80mm">{t('80mm thermal')}</option>
            <option value="75mm">{t('75mm roll')}</option>
            <option value="58mm">{t('58mm thermal')}</option>
            <option value="A4">A4</option>
          </select>
        </Field>
        <Field label={t('Tax rate %')}>
          <input type="number" step="0.01" min="0" max="100" value={form.taxRate} onChange={set('taxRate')} />
        </Field>
      </div>

      <div className="row">
        <Field label={t('Phone')}><input value={form.phone} onChange={set('phone')} /></Field>
        <Field label={t('Address')}><input value={form.address} onChange={set('address')} /></Field>
      </div>
    </>
  )

  return (
    <>
      <div className="grid grid-4 mb-4">
        <Stat label={t('Shops on platform')} value={shops.length} icon="🏬" tone="brand" />
        <Stat label={t('Active')} value={active} foot={t('{n} suspended', { n: shops.length - active })} icon="✅" tone="green" />
        <Stat label={t('Signed in as')} value={t('Super Admin')} foot={profile?.email} icon="★" tone="blue" />
        <Stat label={t('New this month')}
          value={shops.filter((s) => {
            const d = s.createdAt?.toDate?.()
            return d && d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear()
          }).length}
          icon="📈" tone="amber" />
      </div>

      <div className="card">
        <div className="card-head">
          <div className="search-box">
            <span className="ico">🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search shops or owner email…')} />
          </div>
          <button type="button" className="btn spacer" onClick={openCreate}>{t('+ Create shop')}</button>
        </div>

        <div className="card-body tight">
          {rows.length === 0 ? (
            <Empty icon="🏬" title={shops.length ? t('No shops match that search') : t('No shops yet')}
              message={shops.length ? undefined : t('Create your first tenant to get started.')}
              action={!shops.length && <button type="button" className="btn" onClick={openCreate}>{t('+ Create shop')}</button>} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>{t('Shop')}</th><th>{t('Owner login')}</th><th>{t('Currency')}</th><th>{t('Receipt')}</th><th>{t('Status')}</th><th>{t('Created')}</th><th className="num">{t('Actions')}</th></tr>
                </thead>
                <tbody>
                  {pager.slice.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div className="flex gap-2 items-center">
                          <div className="sidebar-logo" style={{ width: 32, height: 32, fontSize: 14, borderRadius: 8 }}>
                            {s.logo
                              ? <img src={s.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : (s.name || 'S').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="cell-title">{s.name}</div>
                            {s.phone && <div className="cell-sub">{s.phone}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="text-sm">{s.ownerEmail}</td>
                      <td className="text-sm">{s.currency}</td>
                      <td className="text-sm">{s.paperSize}</td>
                      <td>
                        <span className={`badge ${s.active === false ? 'badge-red' : 'badge-green'}`}>
                          {s.active === false ? t('Suspended') : t('Active')}
                        </span>
                      </td>
                      <td className="text-sm text-muted nowrap">{formatDate(s.createdAt, false)}</td>
                      <td className="num nowrap">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openLogin(s)}>{t('🔑 Login')}</button>{' '}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(s)}>{t('Edit')}</button>{' '}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(s)}>
                          {s.active === false ? t('Activate') : t('Suspend')}
                        </button>{' '}
                        <button type="button" className="btn btn-icon" title={t('Delete')} onClick={() => setDeleting(s)}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination pager={pager} label="shops" />
        </div>
      </div>


      {loginFor && (
        <Modal
          title={t('{name} — shop login', { name: loginFor.name })}
          subtitle={t('Credentials the shop uses to sign in to the till.')}
          onClose={() => setLoginFor(null)}
          footer={<button type="button" className="btn btn-ghost" onClick={() => setLoginFor(null)}>{t('Close')}</button>}
        >
          <Field label={t('Email')}>
            <div className="flex gap-2">
              <input value={loginFor.ownerEmail} readOnly className="mono" />
              <button type="button" className="btn btn-ghost nowrap"
                onClick={() => copyText(loginFor.ownerEmail, t('Email'))}>{t('Copy')}</button>
            </div>
          </Field>

          <Field label={t('Password')}>
            {credsLoading ? (
              <div className="flex gap-2 items-center text-muted text-sm">
                <span className="spinner spinner-dark" /> {t('Loading…')}
              </div>
            ) : creds?.password ? (
              <>
                <div className="flex gap-2">
                  <input value={reveal ? creds.password : '•'.repeat(creds.password.length)}
                    readOnly className="mono" />
                  <button type="button" className="btn btn-ghost nowrap" onClick={() => setReveal((r) => !r)}>
                    {reveal ? t('Hide') : t('Show')}
                  </button>
                  <button type="button" className="btn btn-ghost nowrap"
                    onClick={() => copyText(creds.password, t('Password'))}>{t('Copy')}</button>
                </div>
                {creds.updatedAt && (
                  <div className="hint">{t('Last set {date}', { date: formatDate(creds.updatedAt) })}</div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted">
                {t('Not recorded yet — reset it below and it will show here from then on.')}
              </div>
            )}
          </Field>

          <form onSubmit={submitPassword} style={{ borderTop: '1px solid var(--border)', marginTop: 18, paddingTop: 18 }}>
            <Field label={t('Reset password')} hint={t('At least 6 characters. Tell the shop their new password.')}>
              <div className="flex gap-2">
                <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('New password')} autoComplete="new-password" autoFocus />
                <button type="submit" className="btn nowrap" disabled={pwBusy || !newPassword.trim()}>
                  {pwBusy && <span className="spinner" />} {t('Reset')}
                </button>
              </div>
            </Field>

            {!apiUp && !creds?.password && (
              <div className="alert alert-amber">
                <span>!</span>
                <span>
                  {t('The admin service is not running, so this shop cannot be reset yet. Stop the app and start it again with')} <code>npm run dev</code>.
                </span>
              </div>
            )}
          </form>

          <div className="alert alert-blue mt-4">
            <span>🔒</span>
            <span>
              {t("Firebase stores only a one-way hash of a password, so it can never be read back. The copy shown here is the app's own, kept when you set it, and readable by you alone. Shop owners cannot change their own password, which is what keeps it accurate.")}
            </span>
          </div>
        </Modal>
      )}

      {creating && (
        <Modal
          wide
          title={t('Create a shop')}
          subtitle={t('This provisions the shop and its owner login in one step.')}
          onClose={() => setCreating(false)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)} disabled={saving}>{t('Cancel')}</button>
              <button type="submit" form="shop-form" className="btn" disabled={saving}>
                {saving && <span className="spinner" />} {t('Create shop')}
              </button>
            </>
          }
        >
          <form id="shop-form" onSubmit={submitCreate}>
            <Field label={t('Shop name')} required>
              <input value={form.name} onChange={set('name')} required autoFocus placeholder={t('e.g. Silva Super Mart')} />
            </Field>

            <div className="row">
              <Field label={t('Owner email')} required hint={t('Their username at sign-in.')}>
                <input type="email" value={form.email} onChange={set('email')} required placeholder="owner@shop.com" />
              </Field>
              <Field label={t('Owner password')} required hint={t('Minimum 6 characters.')}>
                <input type="text" className="mono" value={form.password} onChange={set('password')} required />
              </Field>
            </div>

            {brandingFields}

            <Field label={t('Receipt footer')}>
              <input value={form.receiptFooter} onChange={set('receiptFooter')} />
            </Field>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal
          wide
          title={t('Edit — {name}', { name: editing.name })}
          subtitle={t('Branding and billing setup. The owner can also change these from inside the shop.')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>{t('Cancel')}</button>
              <button type="submit" form="shop-edit-form" className="btn" disabled={saving}>
                {saving && <span className="spinner" />} {t('Save changes')}
              </button>
            </>
          }
        >
          <form id="shop-edit-form" onSubmit={submitEdit}>
            <Field label={t('Shop name')} required>
              <input value={form.name} onChange={set('name')} required autoFocus />
            </Field>
            <Field label={t('Owner login')}>
              <input value={form.email} disabled />
              <div className="hint">
                {t('The owner changes their own password from My Account, or resets it from the sign-in screen.')}
              </div>
            </Field>
            {brandingFields}
            <Field label={t('Receipt footer')}>
              <input value={form.receiptFooter} onChange={set('receiptFooter')} />
            </Field>
          </form>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title={t('Delete shop')}
          message={t("“{name}” will be removed from the platform and its staff will lose access. Products and sales stored under it are no longer reachable from the app. The owner's sign-in record stays in Firebase Authentication.", { name: deleting.name })}
          confirmLabel={t('Delete')}
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}
