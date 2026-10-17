import { findYmInText } from '../domain/dates.ts'
import type { DiscoveredDoc } from '../domain/types.ts'
import { NazarError, errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { absoluteUrl, clean, docBase, fetchHtml, fetchJson, loadHtml, spacedText, ymOfIso, type ManagedSource } from './common.ts'

const log = child('source:who-mpa')

/** Sitefinity taxonomy id of the "Medical product alert" news type. */
const MPA_NEWS_TYPE = '1ec8e1e7-8c50-4649-8502-c0e24fa9ed02'

export const WHO_MPA_HOME = 'https://www.who.int/teams/regulation-prequalification/incidents-and-SF/full-list-of-who-medical-product-alerts'

export const whoListUrl = (top = 25) => {
  const u = new URL('https://www.who.int/api/news/newsitems')
  u.searchParams.set('$filter', `newstypes/any(x:x eq ${MPA_NEWS_TYPE})`)
  u.searchParams.set('$orderby', 'PublicationDateAndTime desc')
  u.searchParams.set('$select', 'Id,Title,UrlName,ItemDefaultUrl,FormatedDate,PublicationDateAndTime')
  u.searchParams.set('$top', String(top))
  return u.toString()
}

export interface WhoNewsItem {
  Id?: string
  Title: string
  ItemDefaultUrl: string
  PublicationDateAndTime: string
}

export interface WhoCandidate {
  title: string
  pageUrl: string
  publishedAt: string
  noticeYm: number | null
  /** "5/2025" from "Medical Product Alert N°5/2025". */
  alertNo: string | null
}

/** Medical Product Alerts only (the news type also carries statements and IVD notices), newest first. */
export function whoCandidates(list: { value: WhoNewsItem[] }, sinceYm?: number): WhoCandidate[] {
  return list.value
    .filter((v) => /^\s*medical\s+product\s+alert/i.test(v.Title))
    .map((v) => {
      const publishedAt = v.PublicationDateAndTime.slice(0, 10)
      const no = /N\s*°\s*(\d{1,2})\s*\/\s*(\d{4})/i.exec(v.Title)
      return {
        title: clean(v.Title),
        pageUrl: `https://www.who.int/news/item${v.ItemDefaultUrl.startsWith('/') ? '' : '/'}${v.ItemDefaultUrl}`,
        publishedAt,
        noticeYm: ymOfIso(publishedAt) ?? findYmInText(v.Title),
        alertNo: no ? `${no[1]}/${no[2]}` : null,
      }
    })
    .filter((c) => !sinceYm || (c.noticeYm ?? 0) >= sinceYm)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

const INDIA = /\bIndia(n|'s)?\b/

/**
 * Reads an alert page: does the alert body mention India, and which PDF is the alert itself?
 * The page sidebar links other alerts' PDFs too, so the PDF must carry this alert's number (n5_2025_…).
 */
export function readWhoAlertPage(html: string, pageUrl: string, alertNo: string | null): { india: boolean; pdfUrl: string | null } {
  const $ = loadHtml(html)
  const sel = ['.sf-detail-body-wrapper', 'article', 'main', 'body'].find((q) => $(q).length) ?? 'body'
  const india = INDIA.test(spacedText($, sel)) || INDIA.test(clean($('h1').first().text()))
  const [n, y] = alertNo?.split('/') ?? []
  const own = n && y ? new RegExp(`(^|[^0-9])n\\s*0?${n}[_-]${y}`, 'i') : null
  const pdfs = $('a[href]')
    .toArray()
    .map((a) => absoluteUrl($(a).attr('href'), pageUrl))
    .filter((u): u is string => !!u && /\.pdf($|\?)/i.test(u))
  const pdfUrl = (own ? pdfs.find((u) => own.test(decodeURIComponent(new URL(u).pathname.split('/').pop() ?? ''))) : undefined) ?? null
  return { india, pdfUrl }
}

export const whoMpa: ManagedSource = {
  id: 'who-mpa',
  authority: 'WHO',
  jurisdiction: 'IN',
  description: 'WHO Medical Product Alerts that concern products made in or reported by India (e.g. the 2025 DEG-contaminated syrups).',
  homepage: WHO_MPA_HOME,
  schedule: '0 7 * * *',

  async discover(ctx) {
    const list = await fetchJson<{ value: WhoNewsItem[] }>(ctx.http, whoListUrl())
    // The list API has no body text, so each alert page is read to find India-related ones; cap the reads.
    const maxPages = Math.min(12, Math.max(4, ctx.limit * 2))
    const docs: DiscoveredDoc[] = []
    for (const c of whoCandidates(list, ctx.sinceYm).slice(0, maxPages)) {
      if (ctx.signal?.aborted || docs.length >= ctx.limit) break
      try {
        const page = await fetchHtml(ctx.http, c.pageUrl)
        const { india, pdfUrl } = readWhoAlertPage(page.text, page.finalUrl, c.alertNo)
        if (!india) continue
        docs.push({
          ...docBase(whoMpa),
          url: pdfUrl ?? c.pageUrl,
          title: `WHO ${c.title}`,
          publishedAt: c.publishedAt,
          noticeYm: c.noticeYm,
          kind: pdfUrl ? 'pdf' : 'html',
          hints: { template: 'who-annex', page: c.pageUrl, ...(c.alertNo ? { alertNo: c.alertNo } : {}) },
        })
      } catch (err) {
        if (!(err instanceof NazarError)) throw err
        log.warn({ url: c.pageUrl, err: errorMessage(err) }, 'could not read WHO alert page')
      }
    }
    return docs
  },
}
