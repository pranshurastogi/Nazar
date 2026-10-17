import { describe, expect, it } from 'vitest'

import type { DiscoveredDoc, ExtractionResult, RawDoc } from '../../src/domain/types.ts'
import type { PoliteHttp } from '../../src/lib/http.ts'
import { RunLockedError, acquireRunLock, runPipeline, type ExtractFn, type HarvestFn } from '../../src/pipeline/run.ts'
import { sourceLastCheck } from '../../src/pipeline/status.ts'
import type { SourceAdapter } from '../../src/sources/types.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import type { RawStore } from '../../src/storage/raw-store.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'

const discovered = (sourceId: string, n: number): DiscoveredDoc => ({
  sourceId,
  url: `https://example.gov.in/${sourceId}/${n}.pdf`,
  title: `${sourceId} notice ${n}`,
  authority: 'Test',
  jurisdiction: 'IN',
  publishedAt: null,
  noticeYm: 202509,
  kind: 'pdf',
  hints: {},
})

function source(id: string, docs: DiscoveredDoc[], o: Partial<SourceAdapter> = {}): SourceAdapter {
  return { id, authority: 'Test', jurisdiction: 'IN', description: id, homepage: `https://example.gov.in/${id}`, schedule: '0 * * * *', discover: async () => docs, ...o }
}

/** Harvest stand-in: "stores" the doc and records it in the ledger, like the real stage does. */
const fakeHarvest: HarvestFn = async (doc, { ledger }) => {
  if (ledger.hasSeenUrl(doc.url)) return null
  const raw: RawDoc = rawDoc({ ...doc, finalUrl: doc.url })
  ledger.upsertDocument(raw)
  ledger.markUrl(doc.url, doc.sourceId, raw.sha256)
  return { raw, bytes: new TextEncoder().encode(doc.title), isNew: true }
}

const fakeExtract: ExtractFn = async (doc) => {
  if (doc.title.includes('broken')) throw new Error('pdf is corrupt')
  const rows = [row(doc, 1), row(doc, 2, { batch: 'SR-13', product: 'COLDRIF Syrup', reason: 'Diethylene glycol' }), row(doc, 3, { confidence: 0.3 })]
  return { sourceSha: doc.sha256, parser: 'test@1', method: 'text', pages: 1, rows, rejected: [], warnings: [] } satisfies ExtractionResult
}

const deps = (ledger: Ledger, sources: SourceAdapter[], extra = {}) => ({
  ledger,
  http: {} as PoliteHttp,
  store: {} as RawStore,
  sources: () => sources,
  harvest: fakeHarvest,
  extract: fakeExtract,
  ...extra,
})

describe('runPipeline', () => {
  it('runs discover → harvest → extract → resolve → ledger, isolating a bad document', async () => {
    const ledger = new Ledger(':memory:')
    const docs = [discovered('cdsco-pdf', 1), { ...discovered('cdsco-pdf', 2), title: 'broken notice' }, discovered('cdsco-pdf', 3)]
    const rep = await runPipeline({ limit: 10 }, deps(ledger, [source('cdsco-pdf', docs)]))
    expect(rep.ok).toBe(true)
    const s = rep.sources[0]!
    expect(s).toMatchObject({ discovered: 3, harvested: 3, processed: 2, failed: 1, rows: 6, alerts: 4, curator: 2 })
    expect(s.errors[0]!.error).toMatch(/corrupt/)
    expect(ledger.stats()).toMatchObject({ documents: 3, alerts: 6, failedDocuments: 1, curatorQueue: 2 })
    expect(ledger.alertsByBatchKey('sr13')).toHaveLength(2)
    expect(ledger.recentRuns(1)[0]).toMatchObject({ ok: true, job: 'run' })
    expect(sourceLastCheck(ledger, 'cdsco-pdf')).toMatchObject({ ok: false, docs: 2 })
  })

  it('uses adapter.rows() for structured sources instead of the PDF extractor', async () => {
    const ledger = new Ledger(':memory:')
    let extractCalls = 0
    const api = source('cdsco-online', [discovered('cdsco-online', 1)], { rows: async (doc) => [row(doc, 1, { method: 'api' })] })
    const rep = await runPipeline({}, deps(ledger, [api], { extract: async () => (extractCalls++, fakeExtract as never) }))
    expect(extractCalls).toBe(0)
    expect(rep.totals).toMatchObject({ processed: 1, alerts: 1 })
  })

  it('is idempotent: a second run skips seen documents', async () => {
    const ledger = new Ledger(':memory:')
    const src = [source('tn-dc', [discovered('tn-dc', 1)])]
    await runPipeline({}, deps(ledger, src))
    const again = await runPipeline({}, deps(ledger, src))
    expect(again.totals).toMatchObject({ skipped: 1, processed: 0 })
    expect(ledger.stats().alerts).toBe(3)
  })

  it('keeps going when one source fails to discover, and respects limit', async () => {
    const ledger = new Ledger(':memory:')
    const bad = source('mh-fda', [], { discover: async () => { throw new Error('DNS failure') } })
    const good = source('tn-dc', [discovered('tn-dc', 1), discovered('tn-dc', 2), discovered('tn-dc', 3)])
    const rep = await runPipeline({ limit: 2 }, deps(ledger, [bad, good]))
    expect(rep.sources.map((s) => [s.sourceId, s.failed, s.processed])).toEqual([['mh-fda', 1, 0], ['tn-dc', 0, 2]])
  })

  it('publishes resolved notices when asked', async () => {
    const ledger = new Ledger(':memory:')
    const published: string[] = []
    const publisher = { publishNotice: async (sha: string) => (published.push(sha), { published: 2, chunks: [{ status: 'confirmed' }] }) }
    const rep = await runPipeline({ publish: true }, deps(ledger, [source('tn-dc', [discovered('tn-dc', 1)])], { publisher }))
    expect(published).toHaveLength(1)
    expect(rep.totals.published).toBe(2)
    expect(ledger.getDocument(published[0]!)?.status).toBe('published')
  })

  it('stops between documents when aborted', async () => {
    const ledger = new Ledger(':memory:')
    const ac = new AbortController()
    const harvest: HarvestFn = async (d, x) => {
      ac.abort()
      return fakeHarvest(d, x)
    }
    const rep = await runPipeline({ signal: ac.signal }, deps(ledger, [source('tn-dc', [discovered('tn-dc', 1), discovered('tn-dc', 2)])], { harvest }))
    expect(rep.aborted).toBe(true)
    expect(rep.totals.processed).toBe(1)
  })

  it('holds a global run lock', async () => {
    const ledger = new Ledger(':memory:')
    const release = acquireRunLock(ledger, 'cron')
    await expect(runPipeline({}, deps(ledger, []))).rejects.toThrow(RunLockedError)
    release()
    // a lock left by a dead process is taken over
    ledger.setKv('lock:run', JSON.stringify({ pid: 999_999_999, at: Date.now(), job: 'ghost' }))
    await expect(runPipeline({}, deps(ledger, []))).resolves.toMatchObject({ ok: true })
  })
})
