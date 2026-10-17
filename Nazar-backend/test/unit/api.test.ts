import { beforeEach, describe, expect, it } from 'vitest'

import { createApp, type NazarApp } from '../../src/api/app.ts'
import { confusionKey } from '../../src/domain/batch.ts'
import { resolveRows } from '../../src/resolve/index.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'

const ORIGIN = 'http://localhost:3000'
const PUB = '0x1111111111111111111111111111111111111111' as const

function seeded() {
  const ledger = new Ledger(':memory:')
  const who = rawDoc({ title: 'WHO Medical Product Alert N°5/2025', sourceId: 'who-mpa', noticeYm: 202510, authority: 'WHO' })
  const tn = rawDoc({ title: 'TN NSQ list June 2026', sourceId: 'tn-dc', jurisdiction: 'IN-TN', noticeYm: 202606 })
  const all = [
    { doc: who, rows: [
      row(who, 1, { product: 'COLDRIF Syrup (paediatric)', batch: 'SR-13', reason: 'Diethylene glycol 48.6% w/v', manufacturer: 'Sresan Pharmaceutical, Kancheepuram-602106, Tamil Nadu', expYm: 202704 }),
      row(who, 2, { product: 'Respifresh TR syrup', batch: 'R01GL2523', reason: 'Diethylene glycol 1.34%', manufacturer: 'Rednex Pharmaceutical Pvt Ltd, Ahmedabad 382213 Gujarat' }),
    ] },
    { doc: tn, rows: [
      row(tn, 1, { batch: 'TN-77', reason: 'Dissolution', manufacturer: 'Example Labs Ltd, Chennai 600001' }),
      row(tn, 2, { batch: 'LOW-1', confidence: 0.3 }),
    ] },
  ]
  for (const { doc, rows } of all) {
    ledger.upsertDocument(doc)
    const r = resolveRows(doc, rows)
    ledger.upsertAlerts([...r.alerts, ...r.curator], confusionKey)
    ledger.upsertNotice(r.notice)
  }
  return ledger
}

describe('API', () => {
  let ledger: Ledger
  let app: NazarApp
  beforeEach(() => {
    ledger = seeded()
    app = createApp({
      ledger,
      reader: null,
      publisher: PUB,
      mode: 'dry-run',
      chainId: 7738577,
      corsOrigins: [ORIGIN],
      explorerBase: 'https://explorer.test',
      now: () => new Date('2026-10-17T00:00:00Z'),
      sources: () => [{ id: 'tn-dc', authority: 'TN DCD', jurisdiction: 'IN-TN', homepage: 'https://drugscontrol.tn.gov.in', description: 'TN', schedule: '30 */3 * * *', enabled: true, lastRun: null }],
    })
  })
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const res = await app.request(path, { headers })
    return { res, body: res.status === 304 ? null : await res.json() }
  }

  it('GET /health', async () => {
    const { body } = await get('/health')
    expect(body).toMatchObject({ ok: true, mode: 'dry-run', publisher: PUB, chainId: 7738577 })
    expect(body.stats.alerts).toBe(4)
  })

  it('SR-13 is flagged, with Child Shield fields', async () => {
    const { res, body } = await get('/v1/check?batch=sr%2013')
    expect(res.headers.get('cache-control')).toMatch(/max-age/)
    expect(body).toMatchObject({ state: 'flagged', batch: 'SR-13', source: 'ledger', asOf: '2026-10-17T00:00:00.000Z' })
    expect(body.alerts).toHaveLength(1)
    expect(body.alerts[0]).toMatchObject({ peds: true, severity: 5, category: 'adulterated', state: 'IN-TN', entityKey: null, retracted: false, explorer: { entity: null, tx: null } })
  })

  it('5R-13 is a look-alike: unreadable with a suggestion, never flagged', async () => {
    const { body } = await get('/v1/check?batch=5R-13')
    expect(body).toMatchObject({ state: 'unreadable', suggestion: 'SR-13', alerts: [] })
  })

  it('unknown batch → no_alert; junk → unreadable; missing param → 400', async () => {
    expect((await get('/v1/check?batch=AB1234')).body).toMatchObject({ state: 'no_alert', batch: 'AB1234' })
    expect((await get('/v1/check?batch=!!')).body).toMatchObject({ state: 'unreadable' })
    const bad = await get('/v1/check')
    expect(bad.res.status).toBe(400)
    expect(bad.body.error.code).toBe('BAD_REQUEST')
  })

  it('retracted when every matching alert is retracted', async () => {
    const rid = ledger.alertsByBatchKey('sr13')[0]!.rid
    ledger.markRetracted(rid)
    expect((await get('/v1/check?batch=SR-13')).body).toMatchObject({ state: 'retracted' })
  })

  it('curator-tier rows never flag a batch', async () => {
    expect((await get('/v1/check?batch=LOW-1')).body.state).toBe('no_alert')
  })

  it('lists alerts with filters, ETag and Cache-Control', async () => {
    const all = await get('/v1/alerts')
    expect(all.body.total).toBe(3)
    expect(all.res.headers.get('cache-control')).toMatch(/max-age=30/)
    const tag = all.res.headers.get('etag')
    expect(tag).toBeTruthy()
    expect((await get('/v1/alerts', { 'if-none-match': tag! })).res.status).toBe(304)
    expect((await get('/v1/alerts?peds=true')).body.items.map((a: { batch: string }) => a.batch)).toEqual(['SR-13'])
    expect((await get('/v1/alerts?state=IN-GJ')).body.items.map((a: { batch: string }) => a.batch)).toEqual(['R01GL2523'])
    expect((await get('/v1/alerts?minSeverity=5&sinceYm=202601')).body.total).toBe(0)
    expect((await get('/v1/alerts?limit=1&offset=1')).body.items).toHaveLength(1)
    expect((await get('/v1/alerts?limit=999')).res.status).toBe(400)
    expect((await get('/v1/alerts?state=Tamil')).res.status).toBe(400)
  })

  it('alert, case, search, notices, sources', async () => {
    const sr = ledger.alertsByBatchKey('sr13')[0]!.record
    expect((await get(`/v1/alerts/${sr.rid}`)).body).toMatchObject({ batch: 'SR-13', creator: null })
    expect((await get(`/v1/cases/${sr.caseId}`)).body).toMatchObject({ caseId: sr.caseId, items: [{ rid: sr.rid }] })
    expect((await get('/v1/search?q=coldrif')).body.items.map((a: { batch: string }) => a.batch)).toEqual(['SR-13'])
    const notices = (await get('/v1/notices')).body.items
    expect(notices.map((n: { noticeYm: number }) => n.noticeYm)).toEqual([202606, 202510])
    expect((await get('/v1/sources')).body.items[0]).toMatchObject({ id: 'tn-dc', enabled: true })
  })

  it('publishes explorer links once an alert is on chain', async () => {
    const rid = ledger.alertsByBatchKey('sr13')[0]!.rid
    ledger.markAlertPublished(rid, `0x${'ab'.repeat(32)}`, `0x${'cd'.repeat(32)}`)
    const a = (await get(`/v1/alerts/${rid}`)).body
    expect(a).toMatchObject({ entityKey: `0x${'ab'.repeat(32)}`, creator: PUB, explorer: { entity: `https://explorer.test/entity/0x${'ab'.repeat(32)}`, tx: `https://explorer.test/tx/0x${'cd'.repeat(32)}` } })
  })

  it('404s as JSON', async () => {
    expect((await get('/v1/alerts/deadbeefdeadbeef')).res.status).toBe(404)
    expect((await get(`/v1/cases/${'0'.repeat(24)}`)).res.status).toBe(404)
    const nf = await get('/nope')
    expect(nf.res.status).toBe(404)
    expect(nf.body.error.code).toBe('NOT_FOUND')
    expect((await get('/v1/pipeline/status')).res.status).toBe(503)
  })

  it('sends CORS headers for the web app only', async () => {
    const ok = await app.request('/v1/alerts', { headers: { Origin: ORIGIN } })
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const pre = await app.request('/v1/check?batch=x', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } })
    expect(pre.status).toBe(204)
    const other = await app.request('/v1/alerts', { headers: { Origin: 'https://evil.example' } })
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('falls back to Arkiv when the ledger has nothing for a batch', async () => {
    const view = {
      entityKey: `0x${'ef'.repeat(32)}`, creator: PUB, owner: PUB, expiresAtBlock: null, createdAtBlock: null,
      batchKey: 'zz99', batch: 'ZZ-99', caseId: 'c', rid: 'r', brand: 'x', form: 'syrup', category: 'nsq', failure: 'assay',
      severity: 3, peds: false, manufacturerSlug: 'm', state: null, mfgYm: null, expYm: null, alertYm: 202601, sourceId: 'cdsco-pdf',
      jurisdiction: 'IN', noticeKey: null, confidence: 0.95, method: 'text', tier: 'auto', payload: null,
    } as const
    const withReader = createApp({ ledger, publisher: PUB, corsOrigins: [ORIGIN], reader: { byBatch: async () => [view as never], retractionsFor: async () => new Map() } })
    const body = await (await withReader.request('/v1/check?batch=ZZ-99')).json()
    expect(body).toMatchObject({ state: 'flagged', source: 'arkiv', alerts: [{ batch: 'ZZ-99', entityKey: view.entityKey }] })
  })
})
