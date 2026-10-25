import { createContext, useContext, useState, useCallback, useRef } from 'react'

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

  const api = {
    success: useCallback((m) => push(m, 'ok'), [push]),
    error: useCallback((m) => push(m, 'err', 4600), [push]),
    info: useCallback((m) => push(m, ''), [push]),
  }

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
