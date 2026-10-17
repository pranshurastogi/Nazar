import { env } from '../config/env.ts'
import { confusionKey } from '../domain/batch.ts'
import type { DiscoveredDoc, ExtractedRow, ExtractionResult, RawDoc } from '../domain/types.ts'
import { NazarError, errorMessage } from '../lib/errors.ts'
import type { PoliteHttp } from '../lib/http.ts'
import { child } from '../lib/logger.ts'
import { resolveRows } from '../resolve/index.ts'
import type { SourceAdapter } from '../sources/types.ts'
import type { Ledger } from '../storage/ledger.ts'
import type { RawStore } from '../storage/raw-store.ts'
import { recordSourceCheck } from './status.ts'

const log = child('run')

/**
 * The orchestrator: for each source, discover → harvest → extract (or the adapter's own rows())
 * → resolve → ledger → optional publish. Each document is isolated: one bad PDF is marked failed
 * and the run moves on. A global lock (in-process plus a ledger row) keeps the cron worker and a
 * CLI run from working the same ledger at once.
 */

export type HarvestFn = (doc: DiscoveredDoc, deps: { http: PoliteHttp; store: RawStore; ledger: Ledger }) => Promise<{ raw: RawDoc; bytes: Uint8Array; isNew: boolean } | null>
export type ExtractFn = (doc: RawDoc, bytes: Uint8Array, opts?: { ocr?: boolean; llm?: boolean }) => Promise<ExtractionResult>
export interface NoticePublisher {
  publishNotice(sha: string): Promise<{ published: number; chunks: { status: string }[] }>
}

export interface RunDeps {
  ledger: Ledger
  http?: PoliteHttp
  store?: RawStore
  /** Source list; defaults to the registry's enabled sources (filtered by `sourceIds`). */
  sources?: (ids?: string[]) => SourceAdapter[] | Promise<SourceAdapter[]>
  harvest?: HarvestFn
  extract?: ExtractFn
  publisher?: NoticePublisher
}

export interface RunOptions {
  sourceIds?: string[]
  sinceYm?: number
  /** Documents per source per run. */
  limit?: number
  publish?: boolean
  ocr?: boolean
  llm?: boolean
  signal?: AbortSignal
  job?: string
}

export interface SourceRunStats {
  sourceId: string
  discovered: number
  harvested: number
  skipped: number
  processed: number
  rows: number
  alerts: number
  curator: number
  published: number
  failed: number
  errors: { url: string; error: string }[]
  ms: number
}

export interface RunReport {
  runId: number
  ok: boolean
  aborted: boolean
  startedAt: string
  finishedAt: string
  sources: SourceRunStats[]
  totals: Omit<SourceRunStats, 'sourceId' | 'errors' | 'ms'>
}

export class RunLockedError extends NazarError {
  constructor(holder: string) {
    super(`another pipeline run is in progress (${holder}); try again when it finishes`, 'LOCKED', { holder })
  }
}

const LOCK_KEY = 'lock:run'
const LOCK_STALE_MS = 3 * 60 * 60 * 1000
let inProcess = false

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function acquireRunLock(ledger: Ledger, job: string): () => void {
  if (inProcess) throw new RunLockedError('this process')
  ledger.tx(() => {
    const raw = ledger.getKv(LOCK_KEY)
    if (raw) {
      try {
        const held = JSON.parse(raw) as { pid: number; at: number; job: string }
        const fresh = Date.now() - held.at < LOCK_STALE_MS
        if (fresh && held.pid !== process.pid && pidAlive(held.pid)) throw new RunLockedError(`${held.job}, pid ${held.pid}`)
      } catch (err) {
        if (err instanceof RunLockedError) throw err
      }
    }
    ledger.setKv(LOCK_KEY, JSON.stringify({ pid: process.pid, at: Date.now(), job }))
  })
  inProcess = true
  return () => {
    inProcess = false
    try {
      ledger.db.prepare('DELETE FROM kv WHERE key = ? AND value LIKE ?').run(LOCK_KEY, `{"pid":${process.pid},%`)
    } catch {}
  }
}

export const isRunning = () => inProcess

// Heavy modules (pdf.js, tesseract) load lazily so the API process never pays for them.
const EXTRACT_MODULE = '../extract/index.ts'
async function defaultExtract(): Promise<ExtractFn> {
  const mod = (await import(EXTRACT_MODULE)) as { extractDocument: ExtractFn }
  return mod.extractDocument
}

async function defaultSources(ids?: string[]): Promise<SourceAdapter[]> {
  const { enabledSources } = await import('../sources/registry.ts')
  return enabledSources(ids)
}

const emptyStats = (sourceId: string): SourceRunStats => ({
  sourceId, discovered: 0, harvested: 0, skipped: 0, processed: 0, rows: 0, alerts: 0, curator: 0, published: 0, failed: 0, errors: [], ms: 0,
})

/** Runs one stored document through extract → resolve → ledger (→ publish). Throws on failure; callers isolate. */
export async function processDocument(
  adapter: Pick<SourceAdapter, 'rows'> | undefined,
  raw: RawDoc,
  bytes: Uint8Array,
  deps: { ledger: Ledger; extract: () => Promise<ExtractFn>; publisher?: NoticePublisher },
  opts: { ocr?: boolean; llm?: boolean; publish?: boolean } = {},
) {
  const { ledger } = deps
  let rows: ExtractedRow[]
  let parser: string | undefined
  let method: string | undefined
  let rejected = 0
  if (adapter?.rows) {
    rows = await adapter.rows(raw, bytes)
  } else {
    const extract = await deps.extract()
    const res = await extract(raw, bytes, { ocr: opts.ocr, llm: opts.llm })
    rows = res.rows
    parser = res.parser
    method = res.method
    rejected = res.rejected.length
  }
  ledger.setDocumentStatus(raw.sha256, 'extracted', { rows: rows.length, rejected, parser: parser ?? rows[0]?.parser, method: method ?? rows[0]?.method })
  ledger.replaceRows(raw.sha256, rows)
  const { notice, alerts, curator } = resolveRows(raw, rows)
  ledger.upsertAlerts([...alerts, ...curator], confusionKey)
  ledger.upsertNotice(notice)
  ledger.setDocumentStatus(raw.sha256, 'resolved')
  let published = 0
  if (opts.publish && deps.publisher && alerts.length) {
    const rep = await deps.publisher.publishNotice(raw.sha256)
    published = rep.published
    if (rep.chunks.some((c) => c.status === 'failed')) throw new Error(`publish failed for ${raw.sha256}`)
    if (rep.chunks.length && rep.chunks.every((c) => c.status === 'confirmed' || c.status === 'reconciled')) ledger.setDocumentStatus(raw.sha256, 'published')
  }
  return { rows: rows.length, alerts: alerts.length, curator: curator.length, published }
}

export async function runPipeline(opts: RunOptions, deps: RunDeps): Promise<RunReport> {
  const { ledger } = deps
  const job = opts.job ?? 'run'
  const release = acquireRunLock(ledger, job)
  const startedAt = new Date().toISOString()
  const runId = ledger.startRun(job)
  const stats: SourceRunStats[] = []
  let aborted = false
  let fatal: string | undefined
  try {
    const http = deps.http ?? (await import('../lib/http.ts')).http()
    const store = deps.store ?? new (await import('../storage/raw-store.ts')).RawStore()
    const harvest: HarvestFn = deps.harvest ?? (await import('./harvest.ts')).harvest
    let extractFn: ExtractFn | undefined = deps.extract
    const extract = async () => (extractFn ??= await defaultExtract())
    const sources = await (deps.sources ?? defaultSources)(opts.sourceIds)
    const limit = opts.limit ?? env().NAZAR_MAX_DOCS_PER_RUN

    for (const adapter of sources) {
      if (opts.signal?.aborted) {
        aborted = true
        break
      }
      const s = emptyStats(adapter.id)
      stats.push(s)
      const t0 = Date.now()
      let discovered: DiscoveredDoc[] = []
      try {
        discovered = await adapter.discover({ http, sinceYm: opts.sinceYm, limit, signal: opts.signal })
      } catch (err) {
        s.failed++
        s.errors.push({ url: adapter.homepage, error: `discover: ${errorMessage(err)}` })
        log.error({ source: adapter.id, err: errorMessage(err) }, 'discover failed')
        recordSourceCheck(ledger, adapter.id, { lastCheckedMs: Date.now(), ok: false, docs: 0, error: errorMessage(err) })
        s.ms = Date.now() - t0
        continue
      }
      s.discovered = discovered.length
      for (const doc of discovered.slice(0, limit)) {
        if (opts.signal?.aborted) {
          aborted = true
          break
        }
        let sha: string | null = null
        try {
          const h = await harvest(doc, { http, store, ledger })
          if (!h) {
            s.skipped++
            continue
          }
          sha = h.raw.sha256
          const prior = ledger.getDocument(sha)
          if (!h.isNew && prior && (prior.status === 'resolved' || prior.status === 'published')) {
            s.skipped++
            continue
          }
          s.harvested++
          const r = await processDocument(adapter, h.raw, h.bytes, { ledger, extract, publisher: deps.publisher }, opts)
          s.processed++
          s.rows += r.rows
          s.alerts += r.alerts
          s.curator += r.curator
          s.published += r.published
        } catch (err) {
          s.failed++
          s.errors.push({ url: doc.url, error: errorMessage(err) })
          if (sha) ledger.setDocumentStatus(sha, 'failed', { error: errorMessage(err).slice(0, 1000) })
          log.error({ source: adapter.id, url: doc.url, err: errorMessage(err) }, 'document failed; continuing')
        }
      }
      s.ms = Date.now() - t0
      recordSourceCheck(ledger, adapter.id, {
        lastCheckedMs: Date.now(),
        ok: s.failed === 0,
        docs: s.processed,
        alerts: s.alerts,
        error: s.errors[0]?.error ?? null,
      })
      log.info({ ...s, errors: s.errors.length }, 'source done')
    }
  } catch (err) {
    fatal = errorMessage(err)
    log.error({ err: fatal }, 'run failed')
  } finally {
    release()
  }
  const totals = stats.reduce(
    (t, s) => ({
      discovered: t.discovered + s.discovered,
      harvested: t.harvested + s.harvested,
      skipped: t.skipped + s.skipped,
      processed: t.processed + s.processed,
      rows: t.rows + s.rows,
      alerts: t.alerts + s.alerts,
      curator: t.curator + s.curator,
      published: t.published + s.published,
      failed: t.failed + s.failed,
    }),
    { discovered: 0, harvested: 0, skipped: 0, processed: 0, rows: 0, alerts: 0, curator: 0, published: 0, failed: 0 },
  )
  const ok = !fatal && !aborted
  ledger.finishRun(runId, ok, { sources: stats.map(({ errors, ...rest }) => ({ ...rest, errors: errors.slice(0, 5) })), totals, aborted }, fatal)
  if (fatal) throw new NazarError(`pipeline run failed: ${fatal}`, 'RUN', { runId })
  return { runId, ok, aborted, startedAt, finishedAt: new Date().toISOString(), sources: stats, totals }
}
