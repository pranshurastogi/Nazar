import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import type { DiscoveredDoc, ExtractionResult, RawDoc } from '../../src/domain/types.ts'
import type { PoliteHttp } from '../../src/lib/http.ts'
import { runPipeline, type ExtractFn, type HarvestFn } from '../../src/pipeline/run.ts'
import { mhRows } from '../../src/sources/mh-fda.ts'
import type { SourceAdapter } from '../../src/sources/types.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import type { RawStore } from '../../src/storage/raw-store.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'
import { fixtureText } from './sources/fake-http.ts'

const discovered = (sourceId: string, n: number, o: Partial<DiscoveredDoc> = {}): DiscoveredDoc => ({
  sourceId,
  url: `https://example.gov.in/${sourceId}/${n}.pdf`,
  title: `${sourceId} notice ${n}`,
  authority: 'Test',
  jurisdiction: 'IN',
  publishedAt: null,
  noticeYm: 202509,
  kind: 'pdf',
  hints: {},
  ...o,
})

const source = (id: string, docs: DiscoveredDoc[], o: Partial<SourceAdapter> = {}): SourceAdapter => ({
  id, authority: 'Test', jurisdiction: 'IN', description: id, homepage: `https://example.gov.in/${id}`, schedule: '0 * * * *', discover: async () => docs, ...o,
})

const harvestAll: HarvestFn = async (doc, { ledger }) => {
  const raw: RawDoc = rawDoc({ ...doc, finalUrl: doc.url })
  ledger.upsertDocument(raw)
  ledger.markUrl(doc.url, doc.sourceId, raw.sha256)
  return { raw, bytes: new TextEncoder().encode(doc.title), isNew: true }
}

const never = <T>() => new Promise<T>(() => {})

/** Hangs on any document whose title says "hang"; otherwise two rows and one rejected cell. */
const extract: ExtractFn = async (doc) => {
  if (doc.title.includes('hang')) return never()
  return {
    sourceSha: doc.sha256, parser: 'test@1', method: 'text', pages: 1,
    rows: [row(doc, 1), row(doc, 2)],
    rejected: [{ rowNo: 3, page: 1, rawText: '', reason: 'implausible batch "ABCDEF"' }, { rowNo: 4, page: 1, rawText: '', reason: 'no batch number on the notice' }],
    warnings: [],
  } satisfies ExtractionResult
}

const deps = (ledger: Ledger, sources: SourceAdapter[], extra = {}) => ({
  ledger, http: {} as PoliteHttp, store: {} as RawStore, sources: () => sources, harvest: harvestAll, extract, ...extra,
})

describe('run watchdogs', () => {
  it('fails a document whose extractor never resolves and finishes the run', async () => {
    const ledger = new Ledger(':memory:')
    const docs = [discovered('cdsco-pdf', 1), discovered('cdsco-pdf', 2, { title: 'hang notice' }), discovered('cdsco-pdf', 3)]
    const t0 = Date.now()
    const rep = await runPipeline({ limit: 10, docTimeoutMs: 150 }, deps(ledger, [source('cdsco-pdf', docs)]))
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(rep.ok).toBe(true)
    expect(rep.sources[0]).toMatchObject({ discovered: 3, processed: 2, failed: 1, rows: 4 })
    expect(rep.sources[0]!.errors).toEqual([{ url: docs[1]!.url, error: expect.stringMatching(/document timed out after 150 ms \(NAZAR_DOC_TIMEOUT_MS\)/) }])
    const hung = ledger.listDocuments(10).find((d) => d.title === 'hang notice')!
    expect(hung).toMatchObject({ status: 'failed', error: expect.stringMatching(/timed out/) })
    expect(ledger.recentRuns(1)[0]).toMatchObject({ ok: true })
  })

  it('fails a document whose harvest never resolves', async () => {
    const ledger = new Ledger(':memory:')
    const harvest: HarvestFn = async (doc, d) => (doc.url.endsWith('/1.pdf') ? never() : harvestAll(doc, d))
    const rep = await runPipeline({ limit: 10, docTimeoutMs: 100 }, deps(ledger, [source('tn-dc', [discovered('tn-dc', 1), discovered('tn-dc', 2)])], { harvest }))
    expect(rep.sources[0]).toMatchObject({ failed: 1, processed: 1 })
  })

  it('moves to the next source when discovery never returns', async () => {
    const ledger = new Ledger(':memory:')
    const stuck = source('mh-fda', [], { discover: () => never() })
    const good = source('tn-dc', [discovered('tn-dc', 1)])
    const rep = await runPipeline({ sourceTimeoutMs: 150 }, deps(ledger, [stuck, good]))
    expect(rep.sources.map((s) => [s.sourceId, s.failed, s.processed])).toEqual([['mh-fda', 1, 0], ['tn-dc', 0, 1]])
    expect(rep.sources[0]!.errors[0]!.error).toMatch(/source mh-fda timed out after 150 ms \(NAZAR_SOURCE_TIMEOUT_MS\)/)
  })

  it('stops a source that runs past its budget and still runs the next one', async () => {
    const ledger = new Ledger(':memory:')
    const docs = [discovered('cdsco-pdf', 1, { title: 'hang 1' }), discovered('cdsco-pdf', 2, { title: 'hang 2' }), discovered('cdsco-pdf', 3)]
    const rep = await runPipeline({ limit: 10, docTimeoutMs: 10_000, sourceTimeoutMs: 200 }, deps(ledger, [source('cdsco-pdf', docs), source('tn-dc', [discovered('tn-dc', 1)])]))
    expect(rep.sources[0]).toMatchObject({ processed: 0, failed: 1 })
    expect(rep.sources[0]!.errors[0]!.error).toMatch(/NAZAR_SOURCE_TIMEOUT_MS/)
    expect(rep.sources[1]).toMatchObject({ sourceId: 'tn-dc', processed: 1, failed: 0 })
  })
})

describe('run stats', () => {
  it('counts skipped rows by reason, per source and in totals', async () => {
    const ledger = new Ledger(':memory:')
    const rep = await runPipeline({ limit: 10 }, deps(ledger, [source('cdsco-pdf', [discovered('cdsco-pdf', 1), discovered('cdsco-pdf', 2)])]))
    expect(rep.sources[0]!.skippedRows).toEqual({ 'implausible batch': 2, 'no batch number on the notice': 2 })
    expect(rep.totals.skippedRows).toEqual({ 'implausible batch': 2, 'no batch number on the notice': 2 })
    const stored = ledger.recentRuns(1)[0]!.stats as { sources: { skippedRows: Record<string, number> }[] }
    expect(stored.sources[0]!.skippedRows).toEqual({ 'implausible batch': 2, 'no batch number on the notice': 2 })
  })

  it('counts rows a structured source drops', async () => {
    const ledger = new Ledger(':memory:')
    const api = source('cdsco-online', [discovered('cdsco-online', 1)], {
      rows: async (doc, _bytes, skipped) => {
        if (skipped) skipped['implausible batch'] = 3
        return [row(doc, 1, { method: 'api' })]
      },
    })
    const rep = await runPipeline({}, deps(ledger, [api]))
    expect(rep.sources[0]!.skippedRows).toEqual({ 'implausible batch': 3 })
  })
})

describe('Maharashtra first-seen month', () => {
  const html = fixtureText('html', 'mh-nsq-alerts.html')
  const mh = (ym: number, fetchedAt: string): { adapter: SourceAdapter; harvest: HarvestFn } => {
    const doc: DiscoveredDoc = {
      sourceId: 'mh-fda', url: 'https://fda.maharashtra.gov.in/nsq-alerts/', title: `Maharashtra FDA NSQ alerts ${ym}`, authority: 'FDA Maharashtra',
      jurisdiction: 'IN-MH', publishedAt: null, noticeYm: ym, kind: 'html', hints: { format: 'mh-html', refresh: 'always' },
    }
    return {
      adapter: source('mh-fda', [doc], { rows: async (raw, _b, skipped) => mhRows(html, raw, skipped) }),
      harvest: async (d, { ledger }) => {
        const raw = rawDoc({ ...d, finalUrl: d.url, fetchedAt, sha256: createHash('sha256').update(`${ym}`).digest('hex'), contentType: 'text/html' })
        ledger.upsertDocument(raw)
        ledger.markUrl(d.url, d.sourceId, raw.sha256)
        return { raw, bytes: new Uint8Array(), isNew: true }
      },
    }
  }

  it('publishes no notice date, and a re-harvest months later keeps the first-seen month', async () => {
    const ledger = new Ledger(':memory:')
    const first = mh(202610, '2026-10-17T00:00:00.000Z')
    await runPipeline({}, deps(ledger, [first.adapter], { harvest: first.harvest }))
    const key = 'ca251'
    const before = ledger.alertsByBatchKey(key)[0]!.record
    expect(before).toMatchObject({ alertYm: 202610, noticeDate: null })

    const later = mh(202612, '2026-12-05T00:00:00.000Z')
    await runPipeline({}, deps(ledger, [later.adapter], { harvest: later.harvest }))
    const after = ledger.alertsByBatchKey(key)
    expect(after).toHaveLength(1)
    expect(after[0]!.record).toMatchObject({ alertYm: 202610, noticeDate: null })
    const laterSha = createHash('sha256').update('202612').digest('hex')
    const r = ledger.rowsFor(laterSha).find((x) => x.batch === 'CA-251')!
    expect(r.issues).toContain('date not published; first seen Oct 2026')
  })
})
