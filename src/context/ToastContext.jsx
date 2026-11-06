import { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)

  const push = useCallback((message, tone = 'ok', ms = 3200) => {
    const id = nextId.current
    nextId.current += 1
    setToasts((list) => [...list, { id, message, tone }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ms)
  }, [])

  // Must stay the same object for the life of the app. Pages list `toast` in
  // their data-loading hooks, so a new object on every render (each time a
  // message appeared or faded) made every page reload its data — the
  // "page reloads after Saved!" bug.
  const api = useMemo(() => ({
    success: (m) => push(m, 'ok'),
    error: (m) => push(m, 'err', 4600),
    info: (m) => push(m, ''),
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack no-print">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span>{t.tone === 'ok' ? '✓' : t.tone === 'err' ? '⚠' : 'ℹ'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
