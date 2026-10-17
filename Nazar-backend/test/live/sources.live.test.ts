import { describe, expect, it } from 'vitest'

import { PoliteHttp } from '../../src/lib/http.ts'
import { cdscoOnline } from '../../src/sources/cdsco-online.ts'
import { tnDc } from '../../src/sources/tn-dc.ts'

/**
 * Hits the real regulator sites, politely (per-host delay from NAZAR_HOST_DELAY_MS).
 * Runs only with NAZAR_LIVE_TESTS=1 (`pnpm test:live`).
 */
const live = process.env.NAZAR_LIVE_TESTS === '1'
const http = live ? new PoliteHttp() : (undefined as never)

describe.skipIf(!live)('live sources', () => {
  it('cdsco-online lists recent month tables', { timeout: 180_000 }, async () => {
    const docs = await cdscoOnline.discover({ http, limit: 2 })
    expect(docs.length).toBeGreaterThan(0)
    expect(docs[0]!.hints.format).toBe('cdsco-json')
    expect(docs[0]!.noticeYm).toBeGreaterThanOrEqual(202601)
    const doc = docs[0]!
    const r = await http.get(doc.url, {
      accept: 'application/json',
      headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://cdscoonline.gov.in/CDSCO/viewPublicNSQDrug' },
    })
    const table = JSON.parse(new TextDecoder().decode(r.bytes)) as { aaData: unknown[] }
    const rows = await cdscoOnline.rows!({ ...doc, sha256: '0'.repeat(64), path: '', contentType: 'application/json', size: r.bytes.byteLength, fetchedAt: r.fetchedAt, finalUrl: r.finalUrl }, r.bytes)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeGreaterThanOrEqual(table.aaData.length * 0.9)
  })

  it('tn-dc lists monthly NSQ and recall PDFs', { timeout: 120_000 }, async () => {
    const docs = await tnDc.discover({ http, limit: 10 })
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((d) => d.url.startsWith('https://drugscontrol.tn.gov.in/') && d.url.endsWith('.pdf'))).toBe(true)
    expect(docs.some((d) => d.hints.template === 'tn-nsq')).toBe(true)
  })
})
