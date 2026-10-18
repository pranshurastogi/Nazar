import { brotliDecompressSync, gunzipSync } from 'node:zlib'

import { beforeEach, describe, expect, it } from 'vitest'

import { createApp, type NazarApp } from '../../src/api/app.ts'
import { CACHE, CheckCache } from '../../src/api/cache-policy.ts'
import { SNAPSHOT_CACHE, SnapshotService, buildSnapshot, ledgerFingerprint, pickEncoding, type Snapshot } from '../../src/api/snapshot.ts'
import { confusionKey } from '../../src/domain/batch.ts'
import { Lru } from '../../src/lib/lru.ts'
import { resolveRows } from '../../src/resolve/index.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'

function seeded() {
  const ledger = new Ledger(':memory:')
  const who = rawDoc({ title: 'WHO Medical Product Alert N°5/2025', sourceId: 'who-mpa', noticeYm: 202510, authority: 'WHO' })
  const tn = rawDoc({ title: 'TN NSQ list June 2026', sourceId: 'tn-dc', jurisdiction: 'IN-TN', noticeYm: 202606 })
  for (const { doc, rows } of [
    { doc: who, rows: [
      row(who, 1, { product: 'COLDRIF Syrup (paediatric)', batch: 'SR-13', reason: 'Diethylene glycol 48.6% w/v', manufacturer: 'Sresan Pharmaceutical, Kancheepuram-602106, Tamil Nadu', expYm: 202704 }),
      row(who, 2, { product: 'Respifresh TR syrup', batch: 'R01GL2523', reason: 'Diethylene glycol 1.34%', manufacturer: 'Rednex Pharmaceutical Pvt Ltd, Ahmedabad 382213 Gujarat' }),
    ] },
    { doc: tn, rows: [row(tn, 1, { batch: 'TN-77', reason: 'Dissolution', manufacturer: 'Example Labs Ltd, Chennai 600001' }), row(tn, 2, { batch: 'LOW-1', confidence: 0.3 })] },
  ]) {
    ledger.upsertDocument(doc)
    const r = resolveRows(doc, rows)
    ledger.upsertAlerts([...r.alerts, ...r.curator], confusionKey)
    ledger.upsertNotice(r.notice)
  }
  return ledger
}

const ridOf = (ledger: Ledger, batchKey: string) => ledger.alertsByBatchKey(batchKey)[0]!.rid

describe('snapshot', () => {
  let ledger: Ledger
  beforeEach(() => (ledger = seeded()))

  it('indexes publishable alerts by match key with the fields a verdict needs', () => {
    const s = buildSnapshot(ledger, new Date('2026-10-18T00:00:00Z'))
    expect(Object.keys(s.alerts).sort()).toEqual(['r01gl2523', 'sr13', 'tn77'])
    expect(s.count).toBe(3)
    const [batch, n, brand, , , form, , failure, reason, severity, peds, , , state, , expYm, , , onArkiv, retracted] = s.alerts.sr13![0]!
    expect({ batch, brand, form, failure, reason, severity, peds, state, expYm, onArkiv, retracted }).toMatchObject({
      batch: 'SR-13', form: 'syrup', failure: 'glycol', reason: 'Diethylene glycol 48.6% w/v', severity: 5, peds: 1, expYm: 202704, onArkiv: 0, retracted: 0,
    })
    expect(s.notices[n]).toEqual(['WHO', 'WHO Medical Product Alert N°5/2025', expect.any(String), '2025-10-15', 'who-mpa'])
    expect(s.version).toMatch(/^[0-9a-f]{16}$/)
  })

  it('version is a content hash: stable across builds, moves on a retraction', () => {
    const a = buildSnapshot(ledger, new Date(1))
    const b = buildSnapshot(ledger, new Date(2))
    expect(b.version).toBe(a.version)
    ledger.markRetracted(ridOf(ledger, 'sr13'))
    const c = buildSnapshot(ledger)
    expect(c.version).not.toBe(a.version)
    expect(c.alerts.sr13![0]![19]).toBe(1)
  })

  it('the service rebuilds only when the ledger fingerprint moves', async () => {
    let t = 0
    const svc = new SnapshotService(ledger, { checkMs: 1000, now: () => t })
    const first = await svc.get()
    expect(await svc.get()).toBe(first)
    const fp = ledgerFingerprint(ledger)
    ledger.markAlertPublished(ridOf(ledger, 'tn77'), '0x' + 'ab'.repeat(32), '0x' + 'cd'.repeat(32))
    expect(ledgerFingerprint(ledger)).not.toBe(fp)
    expect((await svc.get()).version).toBe(first.version) // within checkMs: served from memory
    t = 2000
    const second = await svc.get()
    expect(second.version).not.toBe(first.version)
    expect(JSON.parse(second.identity.toString()).alerts.tn77[0][18]).toBe(1)
  })

  it('picks brotli, then gzip, honouring q=0', () => {
    expect(pickEncoding('gzip, deflate, br, zstd')).toBe('br')
    expect(pickEncoding('gzip;q=1.0, br;q=0')).toBe('gzip')
    expect(pickEncoding(undefined)).toBe('identity')
    expect(pickEncoding('*')).toBe('br')
  })
})

describe('GET /v1/snapshot and caching', () => {
  let ledger: Ledger
  let app: NazarApp
  beforeEach(() => {
    ledger = seeded()
    app = createApp({ ledger, reader: null, publisher: null, mode: 'dry-run', corsOrigins: ['*'], explorerBase: 'https://explorer.test', now: () => new Date('2026-10-18T00:00:00Z') })
  })

  it('serves pre-compressed bytes with a strong ETag, long cache and 304s', async () => {
    const res = await app.request('/v1/snapshot', { headers: { 'Accept-Encoding': 'gzip, br' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(res.headers.get('cache-control')).toBe(SNAPSHOT_CACHE)
    expect(res.headers.get('cdn-cache-control')).toMatch(/s-maxage=600/)
    expect(res.headers.get('vary')).toMatch(/Accept-Encoding/)
    const tag = res.headers.get('etag')!
    expect(tag).toMatch(/^"[0-9a-f]{16}-br"$/)
    const snap = JSON.parse(brotliDecompressSync(Buffer.from(await res.arrayBuffer())).toString()) as Snapshot
    expect(snap.v).toBe(1)
    expect(tag).toContain(snap.version)
    expect(res.headers.get('x-nazar-snapshot')).toBe(snap.version)

    const again = await app.request('/v1/snapshot', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': tag } })
    expect(again.status).toBe(304)
    expect(again.headers.get('cache-control')).toBe(SNAPSHOT_CACHE)

    const gz = await app.request('/v1/snapshot', { headers: { 'Accept-Encoding': 'gzip' } })
    expect(gz.headers.get('content-encoding')).toBe('gzip')
    expect(JSON.parse(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).version).toBe(snap.version)
    const plain = await app.request('/v1/snapshot')
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect((await plain.json()).version).toBe(snap.version)
  })

  it('compresses large JSON lists and mirrors s-maxage for the CDN', async () => {
    for (let i = 0; i < 3; i++) ledger.upsertAlerts(ledger.alertsByBatchKey('sr13').map((r) => ({ ...r.record, rid: r.rid + i, batch: `SR-1${i}x`, batchKey: `sr1${i}x` })), confusionKey)
    const res = await app.request('/v1/alerts?limit=50', { headers: { 'Accept-Encoding': 'gzip' } })
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('cache-control')).toBe(CACHE.list)
    expect(res.headers.get('cdn-cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300')
    const body = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString())
    expect(body.total).toBe(6)
    const tag = res.headers.get('etag')!
    const again = await app.request('/v1/alerts?limit=50', { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': tag } })
    expect(again.status).toBe(304)
  })

  it('pipeline status is never cached', async () => {
    const a = createApp({ ledger, reader: null, corsOrigins: ['*'], status: async () => ({}) as never })
    const res = await a.request('/v1/pipeline/status')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('cdn-cache-control')).toBeNull()
  })

  it('remembers /v1/check answers until the ledger changes', async () => {
    const first = await (await app.request('/v1/check?batch=SR-13')).json()
    expect(first.state).toBe('flagged')
    expect(app.checkCache.misses).toBe(1)
    await app.request('/v1/check?batch=sr-13 ')
    expect(app.checkCache.hits).toBe(1)
    ledger.markRetracted(ridOf(ledger, 'sr13'))
    // The fingerprint is re-read at most every 2 s; a fresh cache on the same ledger sees it at once.
    const cache = new CheckCache<{ state: string }>(ledger, { checkMs: 0 })
    let calls = 0
    const compute = async () => ({ state: `v${++calls}` })
    expect(await cache.get('SR-13', compute)).toEqual({ state: 'v1' })
    expect(await cache.get('SR-13', compute)).toEqual({ state: 'v1' })
    ledger.markAlertPublished(ridOf(ledger, 'tn77'), '0x' + 'ab'.repeat(32), '0x' + 'cd'.repeat(32))
    expect(await cache.get('SR-13', compute)).toEqual({ state: 'v2' })
  })
})

describe('Lru', () => {
  it('evicts the least recently used entry and honours the lifetime', () => {
    let t = 0
    const lru = new Lru<string, number>(2, 100, () => t)
    lru.set('a', 1)
    lru.set('b', 2)
    expect(lru.get('a')).toBe(1)
    lru.set('c', 3)
    expect(lru.get('b')).toBeUndefined()
    expect(lru.get('a')).toBe(1)
    t = 150
    expect(lru.get('a')).toBeUndefined()
    expect(lru.size).toBe(1)
  })
})
