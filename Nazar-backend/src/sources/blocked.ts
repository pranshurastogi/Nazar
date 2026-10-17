import { env } from '../config/env.ts'
import type { Jurisdiction } from '../domain/types.ts'
import { docBase, fetchHtml, newestFirst, relevantDocLinks, ymFromTitle, type ManagedSource } from './common.ts'

/**
 * State regulators whose sites refuse connections from outside India (or currently serve a broken
 * certificate). They stay registered so /v1/sources is honest about coverage, are off by default,
 * and can be switched on by naming them in NAZAR_SOURCES from a host inside India. Their discovery
 * is a generic "relevant PDF links on the listing page" scrape, since we could not verify the markup.
 */
function blockedState(o: {
  id: string
  authority: string
  jurisdiction: Jurisdiction
  homepage: string
  listing: string
  description: string
  disabledReason: string
}): ManagedSource {
  const source: ManagedSource = {
    id: o.id,
    authority: o.authority,
    jurisdiction: o.jurisdiction,
    description: o.description,
    homepage: o.homepage,
    schedule: env().NAZAR_CRON_STATES,
    enabled: false,
    disabledReason: o.disabledReason,
    async discover(ctx) {
      const page = await fetchHtml(ctx.http, o.listing)
      const docs = relevantDocLinks(page.$, page.finalUrl).map((l) => ({
        ...docBase(source),
        url: l.url,
        title: l.text,
        publishedAt: null,
        noticeYm: ymFromTitle(l.text) ?? ymFromTitle(decodeURIComponent(l.url)),
        kind: 'pdf' as const,
        hints: { template: 'generic', listing: o.listing },
      }))
      return newestFirst(docs, ctx)
    },
  }
  return source
}

export const telanganaDca = blockedState({
  id: 'tg-dca',
  authority: 'Drugs Control Administration, Telangana',
  jurisdiction: 'IN-TG',
  homepage: 'https://dca.telangana.gov.in/',
  listing: 'https://dca.telangana.gov.in/',
  description: 'Telangana DCA drug alerts and NSQ/spurious notices (documents served via openfile.php?f=<id>).',
  disabledReason: 'dca.telangana.gov.in refuses connections from outside India; enable from an Indian host via NAZAR_SOURCES=tg-dca.',
})

export const karnatakaDc = blockedState({
  id: 'ka-dc',
  authority: 'Drugs Control Department, Karnataka',
  jurisdiction: 'IN-KA',
  homepage: 'https://drugs.karnataka.gov.in/',
  listing: 'https://drugs.karnataka.gov.in/',
  description: 'Karnataka Drugs Control Department NSQ and spurious drug notices.',
  disabledReason: 'drugs.karnataka.gov.in is geo-blocked outside India; enable from an Indian host via NAZAR_SOURCES=ka-dc.',
})

export const keralaDc = blockedState({
  id: 'kl-dc',
  authority: 'Drugs Control Department, Kerala',
  jurisdiction: 'IN-KL',
  homepage: 'https://dc.kerala.gov.in/',
  listing: 'https://dc.kerala.gov.in/',
  description: 'Kerala Drugs Control Department banned/NSQ drug notices.',
  disabledReason:
    'dc.kerala.gov.in currently answers 403 and serves an expired certificate; enable via NAZAR_SOURCES=kl-dc (and NAZAR_INSECURE_TLS_HOSTS=dc.kerala.gov.in) once it is reachable.',
})

export const blockedSources: ManagedSource[] = [telanganaDca, karnatakaDc, keralaDc]
