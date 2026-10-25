import { useEffect } from 'react'

export function Modal({ title, subtitle, children, footer, onClose, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="modal-backdrop no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-lg' : ''}`}>
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <h2>{title}</h2>
            {subtitle && <p className="text-sm text-muted mt-2">{subtitle}</p>}
          </div>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', danger = true, busy, onConfirm, onClose }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : ''}`} onClick={onConfirm} disabled={busy}>
            {busy && <span className="spinner" />} {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-2)' }}>{message}</p>
    </Modal>
  )
}

export function Empty({ icon = '📭', title, message, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {message && <p className="text-sm">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading-page">
      <span className="spinner spinner-dark" style={{ width: 26, height: 26 }} />
      <span className="text-sm text-muted">{label}</span>
    </div>
  )
}

export function Field({ label, hint, children, required }) {
  return (
    <div className="field">
      {label && (
        <label>
          {label} {required && <span style={{ color: 'var(--red)' }}>*</span>}
        </label>
      )}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function Stat({ label, value, foot, icon, tone = 'brand' }) {
  const tones = {
    brand: ['var(--brand-soft)', 'var(--brand)'],
    green: ['var(--green-soft)', 'var(--green)'],
    amber: ['var(--amber-soft)', 'var(--amber)'],
    red: ['var(--red-soft)', 'var(--red)'],
    blue: ['var(--blue-soft)', 'var(--blue)'],
  }
  const [bg, fg] = tones[tone] || tones.brand
  return (
    <div className="stat">
      {icon && <div className="stat-icon" style={{ background: bg, color: fg }}>{icon}</div>}
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  )
}

/** Stock level shown as a colour-coded pill against the product's reorder point. */
export function StockBadge({ stock, lowAt = 0 }) {
  const n = Number(stock) || 0
  if (n <= 0) return <span className="badge badge-red">Out of stock</span>
  if (lowAt > 0 && n <= lowAt) return <span className="badge badge-amber">Low · {n}</span>
  return <span className="badge badge-green">{n} in stock</span>
}
