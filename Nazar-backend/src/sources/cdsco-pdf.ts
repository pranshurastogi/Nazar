import { env } from '../config/env.ts'
import type { DiscoveredDoc } from '../domain/types.ts'
import { NazarError, errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { RELEVANT_TITLE, absoluteUrl, clean, docBase, encodePath, fetchHtml, loadHtml, parseListingDate, ymFromTitle, ymOfIso, type ManagedSource } from './common.ts'

const log = child('source:cdsco-pdf')

export const CDSCO_BASE = 'https://cdsco.gov.in'
export const CDSCO_ALERTS_URL = `${CDSCO_BASE}/opencms/opencms/en/Notifications/Alerts/`

export type CdscoTemplate = 'cdsco-legacy' | 'cdsco-modern' | 'cdsco-state' | 'cdsco-spurious'

export interface CdscoListingEntry {
  title: string
  publishedAt: string | null
  numId: string
  downloadUrl: string
  noticeYm: number | null
  template: CdscoTemplate
}

/** Matches the relevance regex but are announcements or policy documents, not lists of batches. */
const NOT_A_LIST = /availability\s+of|reward\s+scheme|guidelines?\s+for|countrywide\s+survey|\btheft\b|new\s+link/i

/**
 * Which extraction profile a notice probably needs. CDSCO switched from the portrait one-cell
 * layout to landscape tables (with separate state and spurious lists) in 2024. This is only a
 * hint: the extractor confirms it from the page header.
 */
export function guessTemplate(title: string, publishedAt: string | null): CdscoTemplate {
  const year = Number(publishedAt?.slice(0, 4) ?? 0)
  if (year && year < 2024) return 'cdsco-legacy'
  if (/spurious/i.test(title) && !/not\s+of\s+standard|\bnsq\b/i.test(title)) return 'cdsco-spurious'
  if (/\bstate\b/i.test(title)) return 'cdsco-state'
  return 'cdsco-modern'
}

/** Parses the Alerts listing table: S.no | Title | Release Date | Download | Size. Relevant rows only, in page order (newest first). */
export function parseCdscoListing(html: string, base = CDSCO_ALERTS_URL): CdscoListingEntry[] {
  const $ = loadHtml(html)
  const out: CdscoListingEntry[] = []
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td')
    if (cells.length < 4) return
    const title = clean(cells.eq(1).text())
    if (!RELEVANT_TITLE.test(title) || NOT_A_LIST.test(title)) return
    const href = cells.eq(3).find('a').attr('href')
    const downloadUrl = absoluteUrl(href, base)
    const numId = downloadUrl ? new URL(downloadUrl).searchParams.get('num_id') : null
    if (!downloadUrl || !numId) return
    const publishedAt = parseListingDate(cells.eq(2).text())
    out.push({
      title,
      publishedAt,
      numId,
      downloadUrl,
      noticeYm: ymFromTitle(title) ?? ymOfIso(publishedAt),
      template: guessTemplate(title, publishedAt),
    })
  })
  return out
}

/** The download link answers with a tiny page holding `<iframe src='/opencms/.../file name.pdf'>`. */
export function iframeTarget(html: string, base = CDSCO_BASE): string | null {
  const src = loadHtml(html)('iframe').attr('src') ?? /src\s*=\s*['"]([^'"]+\.pdf)['"]/i.exec(html)?.[1]
  if (!src) return null
  if (/^https?:/i.test(src)) return new URL(src).toString()
  return absoluteUrl(/%[0-9a-f]{2}/i.test(src) ? src : encodePath(src), base)
}

export const cdscoPdf: ManagedSource = {
  id: 'cdsco-pdf',
  authority: 'CDSCO',
  jurisdiction: 'IN',
  description:
    'CDSCO monthly Drug Alert / NSQ / spurious PDF notices from cdsco.gov.in (2013 onwards): the original signed lists behind every alert.',
  homepage: CDSCO_ALERTS_URL,
  schedule: env().NAZAR_CRON_CDSCO,

  async discover(ctx) {
    const listing = await fetchHtml(ctx.http, CDSCO_ALERTS_URL)
    const entries = parseCdscoListing(listing.text, listing.finalUrl)
      .filter((e) => !ctx.sinceYm || (e.noticeYm ?? 0) >= ctx.sinceYm)
      .slice(0, ctx.limit)
    const docs: DiscoveredDoc[] = []
    let failures = 0
    let lastError: unknown
    for (const e of entries) {
      if (ctx.signal?.aborted) break
      try {
        const page = await ctx.http.getText(e.downloadUrl)
        const url = iframeTarget(page.text)
        if (!url) {
          log.warn({ numId: e.numId, title: e.title }, 'download page has no iframe; skipping')
          continue
        }
        docs.push({
          ...docBase(cdscoPdf),
          url,
          title: e.title,
          publishedAt: e.publishedAt,
          noticeYm: e.noticeYm,
          kind: 'pdf',
          hints: { template: e.template, numId: e.numId, listing: e.downloadUrl },
        })
      } catch (err) {
        if (!(err instanceof NazarError)) throw err
        failures++
        lastError = err
        log.warn({ numId: e.numId, err: errorMessage(err) }, 'could not resolve CDSCO download link')
      }
    }
    if (!docs.length && failures) throw lastError
    return docs
  },
}
