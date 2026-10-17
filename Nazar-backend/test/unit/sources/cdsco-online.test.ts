import { describe, expect, it } from 'vitest'

import { classifyCategory } from '../../../src/domain/vocab.ts'
import { cdscoOnline, cdscoRows, tableUrl, type CdscoTable } from '../../../src/sources/cdsco-online.ts'
import { fakeHttp, fixture, fixtureText } from './fake-http.ts'

const nsq = JSON.parse(fixtureText('json', 'cdscoonline-nsq-aug-2026.json')) as CdscoTable
const spurious = JSON.parse(fixtureText('json', 'cdscoonline-spurious-aug-2026.json')) as CdscoTable
const nsqDoc = { sha256: 'a'.repeat(64), hints: { format: 'cdsco-json', tab: 'nsq', month: 'Aug-2026' } }
const spuriousDoc = { sha256: 'd'.repeat(64), hints: { format: 'cdsco-json', tab: 'spurious', month: 'Aug-2026' } }

describe('cdscoRows (NSQ)', () => {
  const rows = cdscoRows(nsq, nsqDoc)

  it('turns every table row into one batch row', () => {
    expect(nsq.aaData).toHaveLength(220)
    expect(rows).toHaveLength(220)
    expect(rows.every((r) => r.method === 'api' && r.parser === 'cdsco-json@1' && r.confidence >= 0.9)).toBe(true)
    expect(rows.map((r) => r.rowNo)).toEqual(rows.map((_, i) => i + 1))
  })

  it('maps a known batch', () => {
    expect(rows.find((r) => r.batch === 'VRNT-933')).toMatchObject({
      product: 'Montelukast sodium & Levocetirizine hydrochloride Tablets IP',
      mfgYm: 202503,
      expYm: 202702,
      manufacturer: 'Vrihaan Pharmaceuticals LLP. Plot no 17A, V2 House, Shreenathji ESTATE, Changodar. Ahmadabad 382213',
      reason: 'Dissolution',
      reportedBy: 'FDL, Vadodara',
      page: null,
      sourceSha: nsqDoc.sha256,
      issues: [],
    })
  })

  it('gives content-derived ids that survive a refreshed (re-hashed) table', () => {
    const again = cdscoRows(nsq, { ...nsqDoc, sha256: 'f'.repeat(64) })
    expect(again.map((r) => r.rid)).toEqual(rows.map((r) => r.rid))
    expect(new Set(rows.map((r) => r.rid)).size).toBe(rows.length)
  })

  it('splits cells that list several batches', () => {
    const t: CdscoTable = { aaData: [{ ...nsq.aaData[0]!, str_batch_no: 'AB1201, AB1202 & AB1203' }] }
    const out = cdscoRows(t, nsqDoc)
    expect(out.map((r) => r.batch)).toEqual(['AB1201', 'AB1202', 'AB1203'])
    expect(out[0]!.issues).toContain('cell listed 3 batches')
  })
})

describe('cdscoRows (spurious)', () => {
  const rows = cdscoRows(spurious, spuriousDoc)

  it('reads the spurious tab, with the firm reply in the reason so it classifies as spurious', () => {
    expect(rows).toHaveLength(1)
    const r = rows[0]!
    expect(r).toMatchObject({ batch: '18230791', product: 'Telmisartan 40 mg and Amlodipine 5mg tablets IP (TELMA AM)', mfgYm: 202312, expYm: 202611, manufacturer: null, reportedBy: 'DTL, Delhi' })
    expect(r.reason).toMatch(/not been manufactured by them/)
    expect(classifyCategory(r.reason!)).toBe('spurious')
  })
})

describe('cdscoOnline.rows', () => {
  it('parses stored bytes', async () => {
    const raw = { ...nsqDoc, contentType: 'application/json' } as never
    expect(await cdscoOnline.rows!(raw, fixture('json', 'cdscoonline-nsq-aug-2026.json'))).toHaveLength(220)
  })
})

describe('cdscoOnline.discover', () => {
  const B = 'https://cdscoonline.gov.in/CDSCO'
  const json = (v: unknown) => ({ body: JSON.stringify(v), type: 'application/json' })
  const routes = {
    [`${B}/reportingYears?tab=nsq`]: json(['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']),
    [`${B}/publicReportingMonths?year=2026&tab=nsq`]: json(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']),
    [`${B}/publicReportingMonths?year=2025&tab=nsq`]: json(['Oct', 'Nov', 'Dec']),
    [`${B}/reportingYears?tab=spurious`]: json(['2025', '2026']),
    [`${B}/publicReportingMonths?year=2026&tab=spurious`]: json(['Aug', 'Jan']),
    [`${B}/publicReportingMonths?year=2025&tab=spurious`]: json(['Dec']),
  }

  it('lists month × tab tables newest first and marks the newest month for refresh', async () => {
    const { http, calls } = fakeHttp(routes)
    const docs = await cdscoOnline.discover({ http, limit: 3 })
    expect(docs.map((d) => [d.hints.tab, d.hints.month, d.hints.refresh ?? null])).toEqual([
      ['nsq', 'Aug-2026', 'always'],
      ['spurious', 'Aug-2026', 'always'],
      ['nsq', 'Jul-2026', null],
    ])
    expect(docs[0]).toMatchObject({
      sourceId: 'cdsco-online',
      url: tableUrl('nsq', 'Aug-2026'),
      noticeYm: 202608,
      kind: 'html',
      hints: { format: 'cdsco-json' },
    })
    expect(docs[1]!.url).toBe(`${B}/filteredSpuriousDrugTable?month=Aug-2026&source=All&tab=spurious`)
    // Stops reading older years once it has enough months.
    expect(calls.some((c) => c.url.includes('year=2025&tab=nsq'))).toBe(false)
    const api = calls.filter((c) => c.url.startsWith(B) && !c.url.endsWith('robots.txt'))
    expect(api.every((c) => c.headers['x-requested-with'] === 'XMLHttpRequest' && c.headers.referer === `${B}/viewPublicNSQDrug`)).toBe(true)
  })

  it('honours sinceYm across year boundaries', async () => {
    const { http } = fakeHttp(routes)
    const docs = await cdscoOnline.discover({ http, limit: 50, sinceYm: 202512 })
    expect(docs.filter((d) => d.hints.tab === 'nsq')).toHaveLength(9)
    expect(docs.filter((d) => d.hints.tab === 'spurious').map((d) => d.hints.month)).toEqual(['Aug-2026', 'Jan-2026', 'Dec-2025'])
    expect(docs.every((d) => d.noticeYm! >= 202512)).toBe(true)
  })
})
