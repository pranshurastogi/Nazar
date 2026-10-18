import { Fragment, createElement, type ReactNode } from 'react'

import { en } from './en'
import { hi } from './hi'

// The framework-free half of Nazar's i18n: locales, dictionaries, interpolation, plurals and
// Indian date formatting. Safe to import from Server Components (the share page) and from plain
// functions (toasts); React components use the hooks in ./provider instead.

export const LOCALES = ['en', 'hi'] as const
export type Locale = (typeof LOCALES)[number]
export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>
/** Keys that come as a `.one` / `.other` pair, named without the suffix. */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer B}.one` ? B : never) : never
export type Vars = Record<string, string | number>

/** The device's choice. URLs never carry the language, so deep links and /b/ pages stay the same. */
export const LANG_KEY = 'nazar:lang'
/** Mirror of the choice for the server-rendered share page (cookie names cannot contain ':'). */
export const LANG_COOKIE = 'nazar_lang'

const DICTS: Record<Locale, Messages> = { en, hi }

/** BCP 47 tag used for Intl formatting: Indian English or Hindi (both keep Latin digits). */
export const INTL: Record<Locale, string> = { en: 'en-IN', hi: 'hi-IN' }

export const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'hi'

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s)

/** One string, with {placeholders} filled. Falls back to English, then to the key, so nothing renders blank. */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  return fill(DICTS[locale][key] ?? en[key] ?? key, vars)
}

const plurals = new Map<Locale, Intl.PluralRules>()
/** A counted phrase: `.one` or `.other` by the locale's plural rules ({n} is filled with a formatted number). */
export function translatePlural(locale: Locale, base: PluralKey, n: number, vars?: Vars): string {
  let rules = plurals.get(locale)
  if (!rules) plurals.set(locale, (rules = new Intl.PluralRules(INTL[locale])))
  const key = `${base}.${rules.select(n) === 'one' ? 'one' : 'other'}` as MessageKey
  return translate(locale, key, { n: n.toLocaleString(INTL[locale]), ...vars })
}

/**
 * A string with React nodes in its placeholders, for sentences that wrap a batch number in mono
 * or a key in <kbd>. Word order comes from the dictionary, so Hindi can put the batch where Hindi puts it.
 */
export function translateRich(locale: Locale, key: MessageKey, vars: Record<string, ReactNode>): ReactNode {
  const parts = (DICTS[locale][key] ?? en[key] ?? key).split(/(\{\w+\})/g)
  return parts.map((p, i) => {
    const m = /^\{(\w+)\}$/.exec(p)
    return createElement(Fragment, { key: i }, m && m[1] in vars ? vars[m[1]] : p)
  })
}

/** "18 Oct, 4:29 pm IST" / "18 अक्टूबर, 4:29 pm IST": always Indian time, whatever the device's zone. */
export function formatAsOfIn(locale: Locale, d: Date, withYear = false) {
  const zone = { timeZone: 'Asia/Kolkata' } as const
  const year = withYear ? ({ year: 'numeric' } as const) : {}
  if (locale === 'en') return `${d.toLocaleString('en-IN', { day: 'numeric', month: 'short', ...year, hour: 'numeric', minute: '2-digit', ...zone })} IST`
  // hi-IN joins a date and a time as "18 अक्टूबर को 4:29 pm बजे", which reads badly before "तक", so the
  // two halves are formatted apart. Hindi short months ("अक्टू॰") read worse than the full name.
  const day = d.toLocaleDateString(INTL[locale], { day: 'numeric', month: 'long', ...year, ...zone })
  const time = d.toLocaleTimeString(INTL[locale], { hour: 'numeric', minute: '2-digit', ...zone })
  // The time and "IST" stay on one line in a wrapping headline.
  return `${day}, ${time.replace(/\s+/g, '\u00a0')}\u00a0IST`
}

/** A calendar date: "13 Oct 2025" / "13 अक्टूबर 2025". */
export const formatDay = (locale: Locale, d: Date) =>
  d.toLocaleDateString(INTL[locale], { day: 'numeric', month: locale === 'hi' ? 'long' : 'short', year: 'numeric' })

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** 202510 → "Oct 2025" / "अक्टूबर 2025" (the month a feed group heading names). */
export function formatYmLocale(locale: Locale, ym: number | null | undefined): string | null {
  if (!ym) return null
  const y = Math.floor(ym / 100)
  const m = ym % 100
  if (m < 1 || m > 12) return null
  if (locale === 'en') return `${MONTHS_EN[m - 1]} ${y}`
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(INTL[locale], { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The locale the page is showing right now, read from <html data-lang>. For code outside React (toasts). */
export function currentLocale(): Locale {
  if (typeof document === 'undefined') return 'en'
  const l = document.documentElement.getAttribute('data-lang')
  return isLocale(l) ? l : 'en'
}

/** translate() in the page's current locale, for toasts and other non-React callers. */
export const tNow = (key: MessageKey, vars?: Vars) => translate(currentLocale(), key, vars)

/**
 * Runs in <head> before first paint: picks the saved language (or Hindi when the browser asks for
 * it), sets <html lang> and data-lang, and when that is not English marks the page as pending so
 * CSS holds the English server HTML back until React has rendered the translation (no flash, no
 * jump). A CSS timer reveals the page anyway if scripts never run.
 */
export const LOCALE_SCRIPT = `(function(){try{var d=document.documentElement,l=null;try{l=localStorage.getItem(${JSON.stringify(LANG_KEY)})}catch(e){}if(l!=='en'&&l!=='hi'){l=String(navigator.language||'').toLowerCase().indexOf('hi')===0?'hi':'en'}d.lang=l;d.setAttribute('data-lang',l);if(l!=='en')d.setAttribute('data-i18n-pending','')}catch(e){}})()`
