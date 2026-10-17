import { describe, expect, it } from 'vitest'

import { isUnspecifiedBatch } from '../../../src/domain/batch.ts'
import { mhFda, mhRows, parseMhTable, readMhDates } from '../../../src/sources/mh-fda.ts'
import { fixtureText } from './fake-http.ts'

const html = fixtureText('html', 'mh-nsq-alerts.html')
const doc = { sha256: 'b'.repeat(64), fetchedAt: '2026-10-17T00:00:00.000Z' }
const NOW = 202610

describe('parseMhTable', () => {
  it('reads every data row of the table', () => {
    const t = parseMhTable(html)
    expect(t).toHaveLength(197)
    expect(t[1]).toEqual({
      srNo: '2',
      product: 'DETAN ADVANCE, WITH ALPHA ARBUTIN, GLYCOLIC ACID & CLOVE OIL',
      manufacturer: 'IRA COSMED PVT. LTD.,GUJARAT',
      batch: 'CA-251',
      mfg: '10-01-2025',
      exp: '09-01-2027',
      reason: 'CONTENT OF MERCURY',
    })
  })
})

describe('readMhDates', () => {
  it('reads MM-01-YYYY rows (top of the table)', () => {
    expect(readMhDates('10-01-2025', '09-01-2027', NOW)).toEqual({ mfgYm: 202510, expYm: 202709, ambiguous: false })
    expect(readMhDates('12-01-2025', '11-01-2027', NOW)).toEqual({ mfgYm: 202512, expYm: 202711, ambiguous: false })
  })
  it('reads 01-MM-YYYY rows', () => {
    expect(readMhDates('01-05-2025', '01-10-2027', NOW)).toEqual({ mfgYm: 202505, expYm: 202710, ambiguous: false })
  })
  it('undoes spreadsheet dates where the day is really the year', () => {
    expect(readMhDates('25-03-2026', '27-02-2026', NOW)).toEqual({ mfgYm: 202503, expYm: 202702, ambiguous: false })
    expect(readMhDates('25-04-2026', '26-09-2026', NOW)).toEqual({ mfgYm: 202504, expYm: 202609, ambiguous: false })
  })
  it('never picks a manufacture date in the future', () => {
    // Read as MM-DD the manufacture date would be May 2026, after "now" (Mar 2026).
    expect(readMhDates('05-01-2026', '01-01-2028', 202603)).toEqual({ mfgYm: 202601, expYm: 202801, ambiguous: false })
  })
  it('handles blanks and flags impossible pairs', () => {
    expect(readMhDates('', '', NOW)).toEqual({ mfgYm: null, expYm: null, ambiguous: false })
    expect(readMhDates('NOT MENTIONED', '01-06-2028', NOW)).toMatchObject({ mfgYm: null, expYm: 202806 })
    expect(readMhDates('07-01-2026', '07-01-2026', NOW).ambiguous).toBe(true)
  })
})

describe('mhRows', () => {
  const rows = mhRows(html, doc)
  const byBatch = (b: string) => rows.find((r) => r.batch === b)

  it('emits one row per usable batch; "not mentioned" batches become placeholders', () => {
    const real = rows.filter((r) => !isUnspecifiedBatch(r.batch))
    expect(real).toHaveLength(162)
    expect(rows.some((r) => /mention/i.test(r.batch))).toBe(false)
    expect(rows.map((r) => r.rowNo)).toEqual(rows.map((_, i) => i + 1))
  })

  it('keeps rows with no batch under a stable placeholder and counts unreadable batches', () => {
    const skipped: Record<string, number> = {}
    const all = mhRows(html, doc, skipped)
    const none = all.filter((r) => isUnspecifiedBatch(r.batch))
    expect(none).toHaveLength(31)
    expect(none[0]).toMatchObject({ batch: expect.stringMatching(/^UNSPECIFIED-[0-9A-F]{8}$/), confidence: 0.5 })
    expect(none[0]!.issues).toContain('batch not stated on the notice')
    // "2", "6", "9" and "2.50E+07" are not batches; they are dropped but counted
    expect(skipped).toEqual({ 'implausible batch': 4 })
    expect(mhRows(html, { ...doc, sha256: 'c'.repeat(64) }).filter((r) => isUnspecifiedBatch(r.batch)).map((r) => r.batch)).toEqual(none.map((r) => r.batch))
  })

  it('says the page has no publication date without lowering confidence', () => {
    const r = byBatch('CA-251')!
    expect(r.issues).toContain('date not published; first seen Oct 2026')
    expect(r.confidence).toBe(0.92)
  })

  it('maps rows 2, 4 and 9 of the page', () => {
    expect(byBatch('CA-251')).toMatchObject({ mfgYm: 202510, expYm: 202709, manufacturer: 'IRA COSMED PVT. LTD.,GUJARAT', reason: 'CONTENT OF MERCURY' })
    expect(byBatch('SPT-41530')).toMatchObject({
      product: 'CEFPODOXIME PROXETIL DISPERSIBLE TABLETS 100 MG “LIVDOX 100 DT”',
      mfgYm: 202512,
      expYm: 202711,
      reason: 'DISSOLUTION',
    })
    expect(byBatch('GB25037')).toMatchObject({ mfgYm: 202505, expYm: 202710, reason: 'DISSOLUTION' })
    expect(byBatch('GT18525A')).toMatchObject({ mfgYm: 202503, expYm: 202702 })
    expect(byBatch('AARK260014')).toBeDefined()
  })

  it('identifies rows by content so ids survive page changes', () => {
    const r = byBatch('CA-251')!
    expect(r.rawText).toMatch(/^key:[0-9a-f]{24} \| 2 \| DETAN/)
    const again = mhRows(html, { ...doc, sha256: 'c'.repeat(64) })
    expect(again.find((x) => x.batch === 'CA-251')!.rid).toBe(r.rid)
    expect(new Set(rows.map((x) => x.rid)).size).toBe(rows.length)
    expect(r).toMatchObject({ method: 'html', parser: 'mh-html@1', reportedBy: 'FDA Maharashtra', page: null })
  })
})

describe('mhFda.discover', () => {
  it('yields the page itself, refreshed every run', async () => {
    const docs = await mhFda.discover({ http: undefined as never, limit: 5 })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ url: 'https://fda.maharashtra.gov.in/nsq-alerts/', kind: 'html', jurisdiction: 'IN-MH', hints: { refresh: 'always' } })
  })
})
