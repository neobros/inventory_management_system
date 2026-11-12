/**
 * English / Sinhala.
 *
 * The English text itself is the key: t('Products') returns the Sinhala from
 * si.js, or the English when no translation has been written yet — so a
 * missing line never shows a blank or a code, it just stays in English.
 *
 *   t('Only {qty} of {name} left.', { qty: '2 kg', name: 'Rice' })
 *
 * The choice is saved on this device and comes back on the next visit.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import si from './si'

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'si', label: 'සිංහල', short: 'සිං' },
]

const STORAGE_KEY = 'stockpilot.lang'
const DICTS = { si }

function savedLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return LANGUAGES.some((l) => l.code === v) ? v : 'en'
  } catch {
    return 'en'
  }
}

/** Fills {name} placeholders. */
function fill(text, vars) {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
}

/** Usable outside React (services, plain helpers). Follows the saved choice. */
export function translate(text, vars, lang = savedLang()) {
  const dict = DICTS[lang]
  return fill((dict && dict[text]) || text, vars)
}

const LanguageContext = createContext({ lang: 'en', setLang: () => {}, t: (s, v) => fill(s, v) })

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(savedLang)

  const setLang = useCallback((code) => {
    setLangState(code)
    try { localStorage.setItem(STORAGE_KEY, code) } catch { /* private mode: lasts this visit only */ }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.body.classList.toggle('lang-si', lang === 'si')
  }, [lang])

  // Stable between renders of the same language, so pages that list `t` in a
  // hook's dependencies do not reload their data on every render.
  const t = useCallback((text, vars) => translate(text, vars, lang), [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLang() {
  return useContext(LanguageContext)
}

/** EN | සිං switch for the top bar. */
export function LanguageSwitch() {
  const { lang, setLang, t } = useLang()
  return (
    <div className="lang-switch" role="group" aria-label={t('Language')}>
      {LANGUAGES.map((l) => (
        <button key={l.code} type="button" title={l.label}
          className={lang === l.code ? 'active' : ''} aria-pressed={lang === l.code}
          onClick={() => setLang(l.code)}>
          {l.short}
        </button>
      ))}
    </div>
  )
}
