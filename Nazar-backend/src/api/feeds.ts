import { formatYm } from '../domain/dates.ts'
import { CATEGORY_LABEL, FAILURE_LABEL, type ProductClass } from '../domain/vocab.ts'
import type { AlertDTO } from './dto.ts'

/**
 * Subscribable feeds of the alert list (/v1/alerts.rss, .atom, .json) for journalists, NGOs,
 * pharmacies and feed readers. Same rows as /v1/alerts; this module only renders them. The XML is
 * built with a tiny escaping serializer: every piece of regulator text goes through `xmlEscape`,
 * and links are emitted only when they are http(s), so a notice cannot inject markup or scripts.
 */

export const DISCLAIMER = 'Nazar repeats what the regulator published. It is not medical advice and never a safety certificate.'

export const FEED_CONTENT_TYPE = {
  rss: 'application/rss+xml; charset=utf-8',
  atom: 'application/atom+xml; charset=utf-8',
  json: 'application/feed+json; charset=utf-8',
} as const
export type FeedFormat = keyof typeof FEED_CONTENT_TYPE

/** The /v1/alerts filters a feed was built with (the parsed AlertsQuery). */
export interface FeedFilters {
  limit: number
  offset: number
  state?: string
  minSeverity?: number
  peds?: boolean
  sinceYm?: number
  source?: string
  productClass?: ProductClass
}

export interface FeedContext {
  /** Public web app origin, no trailing slash (NAZAR_SITE_URL). */
  siteUrl: string
  /** Public URL of this API, no trailing slash, for the self link. */
  apiOrigin: string
  filters: FeedFilters
  /** Used for the build date of an empty feed only, so unchanged feeds keep their ETag. */
  now: Date
}

// Stable ids that do not move if the site or API host changes (RFC 4151 tag URIs).
const TAG = 'tag:nazar-nu.vercel.app,2026'

const STATE_NAME: Record<string, string> = {
  'IN-AN': 'Andaman and Nicobar Islands', 'IN-AP': 'Andhra Pradesh', 'IN-AR': 'Arunachal Pradesh', 'IN-AS': 'Assam',
  'IN-BR': 'Bihar', 'IN-CG': 'Chhattisgarh', 'IN-CH': 'Chandigarh', 'IN-DH': 'Dadra and Nagar Haveli and Daman and Diu',
  'IN-DL': 'Delhi', 'IN-GA': 'Goa', 'IN-GJ': 'Gujarat', 'IN-HP': 'Himachal Pradesh', 'IN-HR': 'Haryana',
  'IN-JH': 'Jharkhand', 'IN-JK': 'Jammu and Kashmir', 'IN-KA': 'Karnataka', 'IN-KL': 'Kerala', 'IN-LA': 'Ladakh',
  'IN-LD': 'Lakshadweep', 'IN-MH': 'Maharashtra', 'IN-ML': 'Meghalaya', 'IN-MN': 'Manipur', 'IN-MP': 'Madhya Pradesh',
  'IN-MZ': 'Mizoram', 'IN-NL': 'Nagaland', 'IN-OD': 'Odisha', 'IN-PB': 'Punjab', 'IN-PY': 'Puducherry',
  'IN-RJ': 'Rajasthan', 'IN-SK': 'Sikkim', 'IN-TN': 'Tamil Nadu', 'IN-TR': 'Tripura', 'IN-TS': 'Telangana',
  'IN-UK': 'Uttarakhand', 'IN-UP': 'Uttar Pradesh', 'IN-WB': 'West Bengal',
}
const SOURCE_NAME: Record<string, string> = {
  'cdsco-online': 'CDSCO NSQ portal',
  'cdsco-pdf': 'CDSCO drug alerts',
  'tn-dc': 'Tamil Nadu Drugs Control',
  'mh-fda': 'Maharashtra FDA',
  'who-mpa': 'WHO product alerts',
}
const CLASS_NAME: Record<ProductClass, string> = { medicine: 'Medicines', cosmetic: 'Cosmetics', hygiene: 'Hygiene products' }

const stateName = (code: string | null | undefined) => (code ? (STATE_NAME[code] ?? code) : null)

// ---- tiny XML serializer

// Characters XML 1.0 forbids (most C0 controls, lone surrogates, U+FFFE/U+FFFF) are dropped, not escaped.
const INVALID_XML = /[^\u{9}\u{A}\u{D}\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu

export function xmlEscape(value: string | number): string {
  return String(value)
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

type Attrs = Record<string, string | number | undefined>
interface XmlNode {
  name: string
  attrs?: Attrs
  text?: string
  children?: (XmlNode | null | false | undefined)[]
}

const el = (name: string, attrs: Attrs | null, body?: string | XmlNode['children']): XmlNode =>
  typeof body === 'string' ? { name, attrs: attrs ?? undefined, text: body } : { name, attrs: attrs ?? undefined, children: body }

function renderXml(n: XmlNode, depth = 0): string {
  const pad = '  '.repeat(depth)
  const attrs = Object.entries(n.attrs ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${xmlEscape(v!)}"`)
    .join('')
  const kids = (n.children ?? []).filter((c): c is XmlNode => !!c)
  if (n.text !== undefined) return `${pad}<${n.name}${attrs}>${xmlEscape(n.text)}</${n.name}>`
  if (!kids.length) return `${pad}<${n.name}${attrs}/>`
  return `${pad}<${n.name}${attrs}>\n${kids.map((k) => renderXml(k, depth + 1)).join('\n')}\n${pad}</${n.name}>`
}

const xmlDocument = (root: XmlNode) => `<?xml version="1.0" encoding="UTF-8"?>\n${renderXml(root)}\n`

// HTML for descriptions is escaped once as HTML here, then once more as XML text by the serializer.
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const httpUrl = (u: string | null | undefined): string | null => {
  if (!u) return null
  try {
    const url = new URL(u)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

// ---- one alert → one format-neutral item

export interface FeedItem {
  id: string
  title: string
  link: string
  date: Date
  dateKnown: boolean
  /** When Nazar wrote the alert to Arkiv, if it has; feeds the channel's build date. */
  publishedAt: Date | null
  categories: string[]
  summary: string
  html: string
  text: string
  noticeUrl: string | null
}

const ymDate = (ym: number) => new Date(Date.UTC(Math.floor(ym / 100), (ym % 100) - 1, 1))
const validDate = (s: string | null | undefined) => {
  if (!s) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s)
  return Number.isNaN(d.getTime()) ? null : d
}
const dayLabel = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function feedItem(a: AlertDTO, siteUrl: string): FeedItem {
  const name = a.brand && a.brand.toLowerCase() !== 'unknown' ? a.brand : a.product
  const authority = a.authority || 'the regulator'
  const verb = a.category === 'spurious' ? 'reported spurious by' : 'flagged by'
  const noticeDate = a.dateKnown ? validDate(a.noticeDate) : null
  const date = noticeDate ?? ymDate(a.alertYm)
  const state = stateName(a.state)
  const reason = a.reason.trim() || a.failures.map((f) => FAILURE_LABEL[f]).join('; ')
  const noticeUrl = httpUrl(a.noticeUrl)
  const entityUrl = httpUrl(a.explorer.entity)

  const when = !a.dateKnown
    ? `Undated: the regulator gave no date. ${formatYm(a.alertYm)} is the month Nazar first saw this alert.`
    : noticeDate
      ? `Notice date ${dayLabel(noticeDate)}.`
      : `Notice month ${formatYm(a.alertYm)}.`
  const maker = a.manufacturer
    ? a.manufacturerRole === 'label_claim'
      ? `${a.manufacturer} (named on the label; the regulator reports this batch as not made by them)`
      : a.manufacturer
    : null
  const dates = [a.mfgYm && `Mfg ${formatYm(a.mfgYm)}`, a.expYm && `Exp ${formatYm(a.expYm)}`].filter(Boolean).join(' · ')
  const severity = `${a.severity} of 5${a.severityRules.length ? ` (${a.severityRules.join('; ')})` : ''}`

  // [label, plain value, optional link]
  const lines: [string, string, string | null][] = [
    ['Reason', reason, null],
    ['Category', CATEGORY_LABEL[a.category], null],
    ...(maker ? [['Manufacturer', maker, null] as [string, string, null]] : []),
    ...(state ? [['State', state, null] as [string, string, null]] : []),
    ...(dates ? [['Batch dates', dates, null] as [string, string, null]] : []),
    ['Severity', severity, null],
    ...(a.peds ? [['Child Shield', 'paediatric formulation', null] as [string, string, null]] : []),
    ['Date', when, null],
    ['Regulator notice', a.noticeTitle || authority, noticeUrl],
    ...(entityUrl ? [['On Arkiv', 'entity in the explorer', entityUrl] as [string, string, string]] : []),
  ]
  const htmlBody = [
    '<ul>',
    ...lines.map(([k, v, href]) => `<li><strong>${html(k)}:</strong> ${href ? `<a href="${html(href)}">${html(v)}</a>` : html(v)}</li>`),
    '</ul>',
    `<p><em>${html(DISCLAIMER)}</em></p>`,
  ].join('')
  const text = [...lines.map(([k, v, href]) => `${k}: ${v}${href ? ` <${href}>` : ''}`), '', DISCLAIMER].join('\n')

  return {
    id: `${TAG}:alert:${a.rid}`,
    title: `${name} · batch ${a.batch} · ${verb} ${authority}`,
    link: `${siteUrl}/b/${encodeURIComponent(a.batch)}`,
    date,
    dateKnown: a.dateKnown,
    publishedAt: validDate(a.publishedAt),
    categories: [CATEGORY_LABEL[a.category], state, `Severity ${a.severity}`, a.peds ? 'Child Shield' : null].filter((c): c is string => !!c),
    summary: `${reason}${a.dateKnown ? '' : ' (undated)'}`,
    html: htmlBody,
    text,
    noticeUrl,
  }
}

// ---- channel metadata

function titleSuffix(f: FeedFilters): string {
  const parts = [
    f.state && stateName(f.state),
    f.source && (SOURCE_NAME[f.source] ?? f.source),
    f.productClass && CLASS_NAME[f.productClass],
    f.peds === true && 'Child Shield',
    f.peds === false && 'Excluding Child Shield',
    f.minSeverity && f.minSeverity > 1 && `Severity ${f.minSeverity}+`,
    f.sinceYm && `Since ${formatYm(f.sinceYm)}`,
  ].filter((p): p is string => !!p)
  return parts.map((p) => ` · ${p}`).join('')
}

/** The query string that reproduces these filters on the API (defaults left out), with a leading "?". */
export function canonicalQuery(f: FeedFilters): string {
  const p = new URLSearchParams()
  if (f.state) p.set('state', f.state)
  if (f.peds !== undefined) p.set('peds', String(f.peds))
  if (f.minSeverity) p.set('minSeverity', String(f.minSeverity))
  if (f.source) p.set('source', f.source)
  if (f.productClass) p.set('productClass', f.productClass)
  if (f.sinceYm) p.set('sinceYm', String(f.sinceYm))
  if (f.limit !== 50) p.set('limit', String(f.limit))
  if (f.offset) p.set('offset', String(f.offset))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

/** The web app's /feed page with the filters it understands (see Nazar-frontend/components/nazar/feed.tsx). */
function siteFeedUrl(siteUrl: string, f: FeedFilters): string {
  const p = new URLSearchParams()
  if (f.minSeverity) p.set('sev', String(f.minSeverity))
  if (f.peds) p.set('peds', '1')
  if (f.state) p.set('state', f.state)
  if (f.source) p.set('source', f.source)
  const qs = p.toString()
  return `${siteUrl}/feed${qs ? `?${qs}` : ''}`
}

interface Channel {
  title: string
  description: string
  link: string
  selfUrl: (format: FeedFormat) => string
  id: string
  updated: Date
}

function channel(items: FeedItem[], ctx: FeedContext): Channel {
  const query = canonicalQuery(ctx.filters)
  const times = items.flatMap((i) => [i.date.getTime(), i.publishedAt?.getTime() ?? 0])
  return {
    title: `Nazar · Indian medicine batch alerts${titleSuffix(ctx.filters)}`,
    description: `Medicine batch alerts from CDSCO, state drug regulators and WHO, newest first. ${DISCLAIMER}`,
    link: siteFeedUrl(ctx.siteUrl, ctx.filters),
    selfUrl: (format) => `${ctx.apiOrigin}/v1/alerts.${format}${query}`,
    id: `${TAG}:alerts${query}`,
    updated: times.length ? new Date(Math.max(...times)) : ctx.now,
  }
}

// ---- renderers

export function renderRss(alerts: AlertDTO[], ctx: FeedContext): string {
  const items = alerts.map((a) => feedItem(a, ctx.siteUrl))
  const ch = channel(items, ctx)
  return xmlDocument(
    el('rss', { version: '2.0', 'xmlns:atom': 'http://www.w3.org/2005/Atom' }, [
      el('channel', null, [
        el('title', null, ch.title),
        el('link', null, ch.link),
        el('description', null, ch.description),
        el('language', null, 'en-IN'),
        el('lastBuildDate', null, ch.updated.toUTCString()),
        el('atom:link', { href: ch.selfUrl('rss'), rel: 'self', type: 'application/rss+xml' }),
        el('docs', null, 'https://www.rssboard.org/rss-specification'),
        el('generator', null, 'Nazar'),
        el('ttl', null, '60'),
        ...items.map((i) =>
          el('item', null, [
            el('title', null, i.title),
            el('link', null, i.link),
            el('guid', { isPermaLink: 'false' }, i.id),
            el('pubDate', null, i.date.toUTCString()),
            ...i.categories.map((c) => el('category', null, c)),
            el('description', null, i.html),
          ]),
        ),
      ]),
    ]),
  )
}

export function renderAtom(alerts: AlertDTO[], ctx: FeedContext): string {
  const items = alerts.map((a) => feedItem(a, ctx.siteUrl))
  const ch = channel(items, ctx)
  return xmlDocument(
    el('feed', { xmlns: 'http://www.w3.org/2005/Atom', 'xml:lang': 'en-IN' }, [
      el('title', null, ch.title),
      el('subtitle', null, ch.description),
      el('link', { rel: 'self', type: 'application/atom+xml', href: ch.selfUrl('atom') }),
      el('link', { rel: 'alternate', type: 'text/html', href: ch.link }),
      el('id', null, ch.id),
      el('updated', null, ch.updated.toISOString()),
      el('author', null, [el('name', null, 'Nazar'), el('uri', null, ctx.siteUrl)]),
      el('generator', null, 'Nazar'),
      ...items.map((i) =>
        el('entry', null, [
          el('title', { type: 'text' }, i.title),
          el('link', { rel: 'alternate', type: 'text/html', href: i.link }),
          i.noticeUrl ? el('link', { rel: 'related', href: i.noticeUrl }) : null,
          el('id', null, i.id),
          el('published', null, i.date.toISOString()),
          el('updated', null, i.date.toISOString()),
          ...i.categories.map((c) => el('category', { term: c })),
          el('summary', { type: 'text' }, i.summary),
          el('content', { type: 'html' }, i.html),
        ]),
      ),
    ]),
  )
}

/** JSON Feed 1.1 (https://jsonfeed.org/version/1.1). */
export function renderJsonFeed(alerts: AlertDTO[], ctx: FeedContext): string {
  const items = alerts.map((a) => feedItem(a, ctx.siteUrl))
  const ch = channel(items, ctx)
  return JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: ch.title,
    home_page_url: ch.link,
    feed_url: ch.selfUrl('json'),
    description: ch.description,
    language: 'en-IN',
    authors: [{ name: 'Nazar', url: ctx.siteUrl }],
    items: items.map((i) => ({
      id: i.id,
      url: i.link,
      ...(i.noticeUrl ? { external_url: i.noticeUrl } : {}),
      title: i.title,
      summary: i.summary,
      content_html: i.html,
      content_text: i.text,
      date_published: i.date.toISOString(),
      tags: i.categories,
    })),
  })
}

export const renderFeed: Record<FeedFormat, (alerts: AlertDTO[], ctx: FeedContext) => string> = {
  rss: renderRss,
  atom: renderAtom,
  json: renderJsonFeed,
}
