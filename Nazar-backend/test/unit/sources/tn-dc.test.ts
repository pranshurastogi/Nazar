import { describe, expect, it } from 'vitest'

import { TN_NSQ_URL, TN_RECALL_URL, parseTnListing, tnDc } from '../../../src/sources/tn-dc.ts'
import { fakeHttp, fixtureText } from './fake-http.ts'

const nsqHtml = fixtureText('html', 'tn-list-nsq-drugs.html')
const recallHtml = fixtureText('html', 'tn-nsq-recall.html')

describe('parseTnListing', () => {
  it('lists the monthly NSQ PDFs and skips the CDSCO link', () => {
    const links = parseTnListing(nsqHtml, TN_NSQ_URL, 'tn-nsq')
    expect(links.map((l) => l.url)).toEqual([
      'https://drugscontrol.tn.gov.in/pdfs/TN_nsq_list_april_2026.pdf',
      'https://drugscontrol.tn.gov.in/pdfs/TN_nsq_list_may_2026.pdf',
      'https://drugscontrol.tn.gov.in/pdfs/TN_nsq_list_june_2026.pdf',
      'https://drugscontrol.tn.gov.in/pdfs/TN_nsq_list_july_2026.pdf',
      'https://drugscontrol.tn.gov.in/pdfs/TN_nsq_list_august_2026.pdf',
    ])
    expect(links.map((l) => l.noticeYm)).toEqual([202604, 202605, 202606, 202607, 202608])
    expect(links[4]!.title).toBe('List of Drugs Reported to be NSQ for the Month of August 2026')
  })

  it('lists recall PDFs at the site root', () => {
    const links = parseTnListing(recallHtml, TN_RECALL_URL, 'tn-recall')
    expect(links.map((l) => l.url)).toEqual([
      'https://drugscontrol.tn.gov.in/nsq_recall_april_2026.pdf',
      'https://drugscontrol.tn.gov.in/nsq_recall_may_2026.pdf',
      'https://drugscontrol.tn.gov.in/nsq_recall_june_2026.pdf',
    ])
    expect(links.map((l) => l.noticeYm)).toEqual([202604, 202605, 202606])
    expect(links.every((l) => l.template === 'tn-recall')).toBe(true)
  })

  it('falls back to the file name for the month', () => {
    const html = '<div class="style2"><a href="pdfs/TN_nsq_list_march_2026.pdf">Click here</a></div>'
    expect(parseTnListing(html, TN_NSQ_URL, 'tn-nsq')[0]!.noticeYm).toBe(202603)
  })
})

describe('tnDc.discover', () => {
  const routes = { [TN_NSQ_URL]: { body: nsqHtml }, [TN_RECALL_URL]: { body: recallHtml } }

  it('merges both pages newest first with templates as hints', async () => {
    const { http } = fakeHttp(routes)
    const docs = await tnDc.discover({ http, limit: 3 })
    expect(docs.map((d) => [d.noticeYm, d.hints.template])).toEqual([
      [202608, 'tn-nsq'],
      [202607, 'tn-nsq'],
      [202606, 'tn-nsq'],
    ])
    expect(docs[0]).toMatchObject({ sourceId: 'tn-dc', jurisdiction: 'IN-TN', kind: 'pdf', publishedAt: null })
  })

  it('honours sinceYm', async () => {
    const { http } = fakeHttp(routes)
    const docs = await tnDc.discover({ http, limit: 10, sinceYm: 202606 })
    expect(docs.map((d) => d.url.split('/').pop())).toEqual([
      'TN_nsq_list_august_2026.pdf',
      'TN_nsq_list_july_2026.pdf',
      'TN_nsq_list_june_2026.pdf',
      'nsq_recall_june_2026.pdf',
    ])
    expect(docs[3]!.title).toBe('Tamil Nadu NSQ RECALL – JUNE 2026')
  })
})
