import { formatDay, translate, type Locale } from '@/lib/i18n/core'
import type { CheckResult } from '@/lib/source/types'

// Share links for a batch. A shared link names only the batch: the page behind it shows
// public regulator data and nothing from the sender's device (cabinet and history stay private).

const trimSlash = (s: string) => s.replace(/\/+$/, '')

/** The site origin for absolute links: NEXT_PUBLIC_SITE_URL when set, else the page's own origin. */
export function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured && /^https?:\/\//.test(configured)) return trimSlash(configured)
  if (typeof window !== 'undefined') return window.location.origin
  return 'https://nazar-nu.vercel.app'
}

/** Path of the public share page for a batch: /b/SR-13. */
export const sharePath = (batch: string) => `/b/${encodeURIComponent(batch.trim().toUpperCase())}`

/** Absolute share URL for a batch. */
export const shareUrl = (batch: string) => `${siteOrigin()}${sharePath(batch)}`

/** Path that opens Check with the batch filled in and checked: /?batch=SR-13. */
export const checkPath = (batch: string) => `/?batch=${encodeURIComponent(batch.trim().toUpperCase())}`

/**
 * One-line summary of a result, without the link, in the reader's language. Never says "safe",
 * "genuine" or "approved" (in Hindi: never सुरक्षित, असली or स्वीकृत); a no-alert summary always
 * says it is not a safety certificate.
 */
export function shareSummary(result: CheckResult, locale: Locale = 'en'): string {
  if (result.state === 'flagged' || result.state === 'retracted') {
    const a = result.alert
    return translate(locale, `sharetext.${result.state}`, { brand: a.brand, batch: a.batch, authority: a.authority, date: a.noticeDate })
  }
  if (result.state === 'no_alert') return translate(locale, 'sharetext.no_alert', { batch: result.batch, date: formatDay(locale, result.asOf) })
  return translate(locale, 'sharetext.unreadable', { batch: result.batch })
}

/** The message with its link, for the clipboard and WhatsApp. */
export const shareMessage = (result: CheckResult, url = shareUrl(result.batch), locale: Locale = 'en') => `${shareSummary(result, locale)}\n${url}`

/** WhatsApp click-to-chat link carrying the message. */
export const whatsappHref = (message: string) => `https://wa.me/?text=${encodeURIComponent(message)}`
