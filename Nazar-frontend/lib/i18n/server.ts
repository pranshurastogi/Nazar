import { cookies } from 'next/headers'

import { isLocale, LANG_COOKIE, type Locale } from './core'

/**
 * The visitor's saved language for a server-rendered page (the share page, already rendered per
 * request): the cookie the app mirrors from localStorage, else English. Only per-request pages
 * call this; the root layout never does, so the app stays statically prerendered.
 */
export async function requestLocale(): Promise<Locale> {
  try {
    const v = (await cookies()).get(LANG_COOKIE)?.value
    return isLocale(v) ? v : 'en'
  } catch {
    return 'en'
  }
}
