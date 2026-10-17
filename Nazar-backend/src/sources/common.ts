import * as cheerio from 'cheerio'

import { findYmInText } from '../domain/dates.ts'
import { decodeText, type PoliteFetchOptions, type PoliteHttp } from '../lib/http.ts'
import type { DiscoveredDoc } from '../domain/types.ts'
import type { SourceAdapter, SourceContext } from './types.ts'

/**
 * A registered adapter. `enabled: false` keeps a source listed (so /v1/sources can say why it is off)
 * without polling it; naming it explicitly in NAZAR_SOURCES turns it on, e.g. when deployed inside India.
 */
export type ManagedSource = SourceAdapter & { readonly enabled?: boolean; readonly disabledReason?: string }

export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** 202610 → "Oct 2026". */
export const monthLabel = (ym: number) => `${MONTH_ABBR[(ym % 100) - 1] ?? '?'} ${Math.floor(ym / 100)}`

/**
 * Issue on rows from pages that print no publication date (Maharashtra): the alert month is the
 * month Nazar first saw the row, and the pipeline keeps that earliest month when the page is re-read.
 */
export const FIRST_SEEN_ISSUE = 'date not published; first seen'
export const firstSeenIssue = (ym: number) => `${FIRST_SEEN_ISSUE} ${monthLabel(ym)}`

/** "Aug" → 8, "august" → 8. */
export function monthIndex(name: string): number | null {
  const i = MONTH_ABBR.findIndex((m) => m.toLowerCase() === name.trim().slice(0, 3).toLowerCase())
  return i < 0 ? null : i + 1
}

/**
 * Some listings are UTF-8 that was decoded as Latin-1 and re-encoded ("Januaryâ\x80\x93 2025").
 * Undo that only when the string is pure Latin-1 and the round trip yields valid UTF-8.
 */
export function fixMojibake(s: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s
  const fixed = Buffer.from(s, 'latin1').toString('utf8')
  return fixed.includes('�') ? s : fixed
}

/** Collapses whitespace (including &nbsp;) the way cells read on screen. */
export const clean = (s: string | null | undefined) => fixMojibake(s ?? '').replace(/[\s ]+/g, ' ').trim()

/** Month-year named in a notice title; dashes of every width count as separators ("March– 2025"). */
export const ymFromTitle = (title: string) => findYmInText(title.replace(/[‐-―]/g, '-'))

/** Resolves a listing href against its page; null for javascript:, mailto: and junk. */
export function absoluteUrl(href: string | undefined, base: string): string | null {
  if (!href || /^(javascript|mailto|tel):|^#/i.test(href.trim())) return null
  try {
    return new URL(href.trim(), base).toString()
  } catch {
    return null
  }
}

/** Server paths on government sites often contain spaces; '#' would otherwise start a fragment. */
export const encodePath = (p: string) => encodeURI(p).replace(/#/g, '%23')

/** "2025-Jul-18" → "2025-07-18". */
export function parseListingDate(raw: string): string | null {
  const m = /^(\d{4})-([A-Za-z]{3})-(\d{1,2})$/.exec(clean(raw))
  if (!m) return null
  const mon = monthIndex(m[2]!)
  if (!mon) return null
  return `${m[1]}-${String(mon).padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
}

/** "2025-07-18" → 202507. */
export const ymOfIso = (iso: string | null | undefined) => {
  const m = iso ? /^(\d{4})-(\d{2})/.exec(iso) : null
  return m ? Number(m[1]) * 100 + Number(m[2]) : null
}

/** For hosts that answer 403 to anything that does not look like a browser. */
export const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'accept-language': 'en-IN,en;q=0.9',
}

export const CDSCO_ONLINE_BASE = 'https://cdscoonline.gov.in/CDSCO'

/** The cdscoonline JSON endpoints only answer requests that look like the page's own XHR calls. */
export const CDSCO_ONLINE_HEADERS: Record<string, string> = {
  'x-requested-with': 'XMLHttpRequest',
  referer: `${CDSCO_ONLINE_BASE}/viewPublicNSQDrug`,
}

/** Extra request headers a host needs, shared by discovery and the harvest stage. */
export function requestHeadersFor(url: string): Record<string, string> | undefined {
  const host = new URL(url).hostname.toLowerCase()
  if (host === 'cdscoonline.gov.in') return CDSCO_ONLINE_HEADERS
  if (host === 'dc.kerala.gov.in' || host.endsWith('karnataka.gov.in') || host.endsWith('telangana.gov.in')) return BROWSER_HEADERS
  return undefined
}

export const politeOptions = (url: string, accept?: string): PoliteFetchOptions => ({ accept, headers: requestHeadersFor(url) })

export const loadHtml = (html: string) => cheerio.load(html)

/** Text of a selection with a space between nodes (cheerio's .text() glues "India" and "Download" together). */
export function spacedText($: cheerio.CheerioAPI, selector: string): string {
  const parts: string[] = []
  $(selector)
    .find('*')
    .addBack()
    .contents()
    .each((_, n) => {
      if (n.type === 'text') parts.push(n.data)
    })
  return clean(parts.join(' '))
}

export async function fetchHtml(http: PoliteHttp, url: string) {
  const r = await http.getText(url, { headers: requestHeadersFor(url) })
  return { ...r, $: loadHtml(r.text) }
}

export async function fetchJson<T>(http: PoliteHttp, url: string): Promise<T> {
  const r = await http.get(url, politeOptions(url, 'application/json, text/javascript, */*; q=0.01'))
  return JSON.parse(decodeText(r.bytes, r.contentType)) as T
}

/** The fields every document from one adapter shares. */
export const docBase = (s: Pick<SourceAdapter, 'id' | 'authority' | 'jurisdiction'>) => ({
  sourceId: s.id,
  authority: s.authority,
  jurisdiction: s.jurisdiction,
})

/** Newest first, honouring sinceYm (documents with an unknown month are kept) and the limit. */
export function newestFirst(docs: DiscoveredDoc[], ctx: Pick<SourceContext, 'sinceYm' | 'limit'>): DiscoveredDoc[] {
  return docs
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => !ctx.sinceYm || d.noticeYm === null || d.noticeYm >= ctx.sinceYm)
    .sort((a, b) => (b.d.noticeYm ?? 0) - (a.d.noticeYm ?? 0) || a.i - b.i)
    .slice(0, Math.max(0, ctx.limit))
    .map(({ d }) => d)
}

export const RELEVANT_TITLE = /\bnsq\b|not\s+of\s+standard|spurious|drugs?\s+alerts?/i

/**
 * Generic listing scraper for state sites whose structure we could not verify from outside India:
 * every link that looks like a document and whose text reads like an NSQ/spurious notice.
 */
export function relevantDocLinks($: cheerio.CheerioAPI, base: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = []
  const seen = new Set<string>()
  $('a[href]').each((_, a) => {
    const text = clean($(a).text()) || clean($(a).attr('title'))
    const url = absoluteUrl($(a).attr('href'), base)
    if (!url || seen.has(url)) return
    if (!/\.pdf($|\?)|openfile\.php|download/i.test(url)) return
    if (!RELEVANT_TITLE.test(`${text} ${url}`)) return
    seen.add(url)
    out.push({ url, text: text || url })
  })
  return out
}
