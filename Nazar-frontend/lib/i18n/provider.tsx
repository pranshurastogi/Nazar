'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

import {
  INTL,
  isLocale,
  LANG_COOKIE,
  LANG_KEY,
  translate,
  translatePlural,
  translateRich,
  type Locale,
  type MessageKey,
  type PluralKey,
  type Vars,
} from './core'

// Client half of Nazar's i18n. Hydration-safe by construction:
// - The server (and the first client render) always use English, so hydration never mismatches
//   and every page stays statically prerendered (no cookies() in the root layout).
// - LOCALE_SCRIPT in <head> has already set <html lang|data-lang> before first paint and, for
//   Hindi, hidden the English HTML (html[data-i18n-pending]).
// - A layout effect reads the saved choice and re-renders in that language before the browser
//   paints, then lifts the pending flag. Hindi readers never see English flash or text reflow.

type Ctx = {
  locale: Locale
  setLocale: (l: Locale) => void
  /** BCP 47 tag for Intl (en-IN or hi-IN). */
  intl: string
  t: (key: MessageKey, vars?: Vars) => string
  tp: (base: PluralKey, n: number, vars?: Vars) => string
  tr: (key: MessageKey, vars: Record<string, ReactNode>) => ReactNode
}

const make = (locale: Locale, setLocale: (l: Locale) => void): Ctx => ({
  locale,
  setLocale,
  intl: INTL[locale],
  t: (key, vars) => translate(locale, key, vars),
  tp: (base, n, vars) => translatePlural(locale, base, n, vars),
  tr: (key, vars) => translateRich(locale, key, vars),
})

const LocaleContext = createContext<Ctx>(make('en', () => {}))

/** The device's saved language, else Hindi when the browser prefers it, else English. */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (isLocale(saved)) return saved
  } catch {}
  return typeof navigator !== 'undefined' && /^hi\b/i.test(navigator.language || '') ? 'hi' : 'en'
}

function applyToDocument(locale: Locale) {
  const d = document.documentElement
  d.lang = locale
  d.setAttribute('data-lang', locale)
  d.removeAttribute('data-i18n-pending')
  // Lets the server-rendered share page answer in the same language.
  try {
    document.cookie = `${LANG_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax`
  } catch {}
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')
  const [ready, setReady] = useState(false)

  // Before paint: switch to the saved language (one synchronous re-render).
  useLayoutEffect(() => {
    setLocaleState(detectLocale())
    setReady(true)
  }, [])

  useLayoutEffect(() => {
    if (ready) applyToDocument(locale)
  }, [locale, ready])

  // Another tab changed the language: follow it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LANG_KEY && isLocale(e.newValue)) setLocaleState(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setLocale = useCallback((l: Locale) => {
    try {
      localStorage.setItem(LANG_KEY, l)
    } catch {}
    setLocaleState(l)
  }, [])

  const value = useMemo(() => make(locale, setLocale), [locale, setLocale])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/**
 * Pins a subtree to one language chosen on the server (the share page reads the visitor's
 * cookie), so server HTML and hydration agree. Switching still goes to the app-wide provider.
 */
export function LocaleScope({ locale, children }: { locale: Locale; children: ReactNode }) {
  const { setLocale } = useContext(LocaleContext)
  const value = useMemo(() => make(locale, setLocale), [locale, setLocale])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/** `{ t, tp, tr, locale, intl, setLocale }` for the current language. */
export const useT = () => useContext(LocaleContext)
