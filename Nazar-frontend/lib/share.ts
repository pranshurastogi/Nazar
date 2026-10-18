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

const asOfText = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** One-line summary of a result, without the link. Never says "safe", "genuine" or "approved". */
export function shareSummary(result: CheckResult): string {
  if (result.state === 'flagged') {
    const a = result.alert
    return `${a.brand} batch ${a.batch}: Flagged by ${a.authority} (${a.noticeDate}). Checked on Nazar.`
  }
  if (result.state === 'retracted') {
    const a = result.alert
    return `${a.brand} batch ${a.batch}: an alert by ${a.authority} was withdrawn (Retracted). Checked on Nazar.`
  }
  if (result.state === 'no_alert') {
    return `Batch ${result.batch}: No alert found on Nazar as of ${asOfText(result.asOf)}. This is not a safety certificate.`
  }
  return `Batch ${result.batch}: Nazar can't tell from this number. Re-check the batch printed on the pack.`
}

/** The message with its link, for the clipboard and WhatsApp. */
export const shareMessage = (result: CheckResult, url = shareUrl(result.batch)) => `${shareSummary(result)}\n${url}`

/** WhatsApp click-to-chat link carrying the message. */
export const whatsappHref = (message: string) => `https://wa.me/?text=${encodeURIComponent(message)}`
