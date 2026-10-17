import { describe, expect, it } from 'vitest'

import { readWhoAlertPage, whoCandidates, whoListUrl, whoMpa, type WhoNewsItem } from '../../../src/sources/who-mpa.ts'
import { fakeHttp, fixtureText } from './fake-http.ts'

const list = JSON.parse(fixtureText('json', 'who-mpa-list.json')) as { value: WhoNewsItem[] }
const N5_PAGE = 'https://www.who.int/news/item/13-10-2025-medical-product-alert-n-5-2025--substandard-(contaminated)-oral-liquid-medicines'
const N5_PDF = 'https://cdn.who.int/media/docs/default-source/substandard-and-falsified/n5_2025_syrup-medicines_en.pdf?sfvrsn=652770c2_7'
const N4_PDF = 'https://cdn.who.int/media/docs/default-source/substandard-and-falsified/n4_2025_fentanilo-hlb_en.pdf?sfvrsn=d1f750c8_6'

const page = (body: string, links: string[] = []) => `<html><body>
  <nav><a href="/countries/ind">India</a></nav>
  <div class="sf-detail-body-wrapper"><p>${body}</p>${links.map((l) => `<a href="${l}">Download</a>`).join('')}</div>
  <aside>${[N4_PDF].map((l) => `<a href="${l}">Previous alert</a>`).join('')}</aside>
</body></html>`

describe('whoCandidates', () => {
  it('keeps Medical Product Alerts only, newest first', () => {
    const c = whoCandidates(list)
    expect(list.value).toHaveLength(83)
    expect(c).toHaveLength(82)
    expect(c.some((x) => /Information Notice/.test(x.title))).toBe(false)
    expect(c[0]!.publishedAt).toBe('2026-07-03')
  })

  it('derives page URL, month and alert number', () => {
    const n5 = whoCandidates(list).find((x) => x.alertNo === '5/2025')!
    expect(n5).toMatchObject({ pageUrl: N5_PAGE, publishedAt: '2025-10-13', noticeYm: 202510 })
    expect(whoCandidates(list).find((x) => x.title.includes('N° 11/2019'))?.alertNo).toBe('11/2019')
  })

  it('honours sinceYm', () => {
    expect(whoCandidates(list, 202510).map((x) => x.alertNo)).toEqual(['3/2026', '2/2026', '1/2026', '7/2025', '6/2025', '5/2025'])
  })

  it('builds an OData query on the alert news type', () => {
    const u = new URL(whoListUrl(10))
    expect(u.searchParams.get('$filter')).toMatch(/^newstypes\/any\(x:x eq [0-9a-f-]{36}\)$/)
    expect(u.searchParams.get('$top')).toBe('10')
  })
})

describe('readWhoAlertPage', () => {
  it('finds India in the alert body and picks this alert’s own PDF', () => {
    const html = page('three substandard (contaminated) oral liquid medicines identified in India', [N5_PDF])
    expect(readWhoAlertPage(html, N5_PAGE, '5/2025')).toMatchObject({ india: true, pdfUrl: N5_PDF })
  })
  it('ignores India in navigation and other alerts’ PDFs', () => {
    const html = page('falsified product detected in Brazil and Mexico')
    expect(readWhoAlertPage(html, N5_PAGE, '5/2025')).toMatchObject({ india: false, pdfUrl: null })
  })
  it('matches Indian manufacturers', () => {
    expect(readWhoAlertPage(page('stated manufacturer is an Indian company'), N5_PAGE, null).india).toBe(true)
  })
})

describe('whoMpa.discover', () => {
  it('reads alert pages and yields only India-related alerts, PDF preferred', async () => {
    const { http, calls } = fakeHttp((url) => {
      if (url.startsWith('https://www.who.int/api/news/newsitems')) return { body: JSON.stringify(list), type: 'application/json' }
      if (url === N5_PAGE) return { body: page('identified in India and reported to WHO', [N5_PDF]) }
      if (url.startsWith('https://www.who.int/news/item/')) return { body: page('detected in Europe') }
      return undefined
    })
    const docs = await whoMpa.discover({ http, limit: 3, sinceYm: 202510 })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      sourceId: 'who-mpa',
      authority: 'WHO',
      url: N5_PDF,
      kind: 'pdf',
      noticeYm: 202510,
      publishedAt: '2025-10-13',
      hints: { template: 'who-annex', alertNo: '5/2025', page: N5_PAGE },
    })
    expect(calls.filter((c) => c.url.startsWith('https://www.who.int/news/item/'))).toHaveLength(6)
  })
})

describe('readWhoAlertPage: children', () => {
  it('flags alerts that say children consumed the products', async () => {
    const { readWhoAlertPage } = await import('../../../src/sources/who-mpa.ts')
    const html = '<main><p>Medicines identified in India. CDSCO informed WHO that the contaminated products were reportedly consumed by the affected children.</p></main>'
    expect(readWhoAlertPage(html, 'https://www.who.int/x', null)).toMatchObject({ india: true, children: true })
    expect(readWhoAlertPage('<main><p>Falsified vaccine found in India.</p></main>', 'https://www.who.int/x', null).children).toBe(false)
  })
})
