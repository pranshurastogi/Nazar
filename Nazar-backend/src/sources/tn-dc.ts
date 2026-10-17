import { env } from '../config/env.ts'
import type { DiscoveredDoc } from '../domain/types.ts'
import { absoluteUrl, clean, docBase, fetchHtml, loadHtml, newestFirst, ymFromTitle, type ManagedSource } from './common.ts'

export const TN_BASE = 'https://drugscontrol.tn.gov.in/'
export const TN_NSQ_URL = `${TN_BASE}list_nsq_drugs.html`
export const TN_RECALL_URL = `${TN_BASE}nsq_recall.html`

export type TnTemplate = 'tn-nsq' | 'tn-recall'

export interface TnLink {
  url: string
  title: string
  noticeYm: number | null
  template: TnTemplate
}

/**
 * Both TN listing pages are a column of `div.style2 > a` links, oldest first. The NSQ page also
 * links CDSCO's own list (another host), which the cdsco adapters already cover.
 */
export function parseTnListing(html: string, pageUrl: string, template: TnTemplate): TnLink[] {
  const $ = loadHtml(html)
  const host = new URL(pageUrl).host
  const out: TnLink[] = []
  $('div.style2 a[href]').each((_, a) => {
    const url = absoluteUrl($(a).attr('href'), pageUrl)
    if (!url || new URL(url).host !== host || !/\.pdf$/i.test(new URL(url).pathname)) return
    const title = clean($(a).text())
    // Link text says "for the Month of April 2026"; the file name (…_april_2026.pdf) is the fallback.
    const fromName = decodeURIComponent(new URL(url).pathname).replace(/[_/]+/g, ' ')
    out.push({ url, title: title || fromName, noticeYm: ymFromTitle(title) ?? ymFromTitle(fromName), template })
  })
  return out
}

export const tnDc: ManagedSource = {
  id: 'tn-dc',
  authority: 'Drugs Control Department, Tamil Nadu',
  jurisdiction: 'IN-TN',
  description: 'Tamil Nadu Drugs Control Department: monthly lists of drugs reported NSQ in the state, and NSQ recall notices.',
  homepage: TN_NSQ_URL,
  schedule: env().NAZAR_CRON_STATES,

  async discover(ctx) {
    const docs: DiscoveredDoc[] = []
    for (const [pageUrl, template] of [
      [TN_NSQ_URL, 'tn-nsq'],
      [TN_RECALL_URL, 'tn-recall'],
    ] as const) {
      if (ctx.signal?.aborted) break
      const page = await fetchHtml(ctx.http, pageUrl)
      for (const l of parseTnListing(page.text, page.finalUrl, template)) {
        docs.push({
          ...docBase(tnDc),
          url: l.url,
          title: template === 'tn-recall' ? `Tamil Nadu ${l.title}` : l.title,
          publishedAt: null,
          noticeYm: l.noticeYm,
          kind: 'pdf',
          hints: { template, listing: pageUrl },
        })
      }
    }
    return newestFirst(docs, ctx)
  },
}
