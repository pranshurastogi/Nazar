import { env } from '../config/env.ts'
import { confusionKey } from '../domain/batch.ts'
import type { DiscoveredDoc, ExtractedRow, ExtractionResult, RawDoc } from '../domain/types.ts'
import { NazarError, errorMessage } from '../lib/errors.ts'
import type { PoliteHttp } from '../lib/http.ts'
import { child } from '../lib/logger.ts'
import { resolveRows } from '../resolve/index.ts'
import { FIRST_SEEN_ISSUE, firstSeenIssue } from '../sources/common.ts'
import { countSkip, type SkipTally, type SourceAdapter } from '../sources/types.ts'
import type { Ledger } from '../storage/ledger.ts'
import type { RawStore } from '../storage/raw-store.ts'
import { recordSourceCheck } from './status.ts'

const log = child('run')

/**
 * The orchestrator: for each source, discover → harvest → extract (or the adapter's own rows())
 * → resolve → ledger → optional publish. Each document is isolated: one bad PDF is marked failed
 * and the run moves on. A global lock (in-process plus a ledger row) keeps the cron worker and a
 * CLI run from working the same ledger at once.
 *
 * Watchdogs (NAZAR_DOC_TIMEOUT_MS, NAZAR_SOURCE_TIMEOUT_MS) bound every document and every source,
 * so a request or parser that never settles fails that document instead of freezing the run.
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
  /** Overrides NAZAR_DOC_TIMEOUT_MS / NAZAR_SOURCE_TIMEOUT_MS (tests). */
  docTimeoutMs?: number
  sourceTimeoutMs?: number
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
  /** Rows dropped before the ledger, by reason (unreadable batch, no product, rejected by the extractor...). */
  skippedRows: SkipTally
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

/** A document or source ran past its watchdog. */
export class RunTimeoutError extends NazarError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'TIMEOUT', details)
  }
}

/** Resolves or rejects with `p`, or rejects with `onTimeout()` after `ms`, whichever comes first. */
function watchdog<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), Math.max(0, ms))
  })
  p.catch(() => {}) // a late rejection from abandoned work must not surface as unhandled
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer))
}

const checkpoint = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) throw new RunTimeoutError('document abandoned after its watchdog fired')
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
  sourceId, discovered: 0, harvested: 0, skipped: 0, processed: 0, rows: 0, alerts: 0, curator: 0, published: 0, failed: 0, skippedRows: {}, errors: [], ms: 0,
})

const mergeTally = (into: SkipTally, from: SkipTally) => {
  for (const [k, n] of Object.entries(from)) countSkip(into, k, n)
  return into
}

/** 'implausible batch "ABCDEF"' → 'implausible batch', so reasons group in the stats. */
const reasonKey = (reason: string) => reason.replace(/\s*["“].*$/, '').trim() || 'rejected'

/** Rows from pages without dates say when they were first seen; on a re-read, use the month the ledger kept. */
function keepFirstSeen(ledger: Ledger, rows: ExtractedRow[]): ExtractedRow[] {
  if (!rows.some((r) => r.issues.some((i) => i.startsWith(FIRST_SEEN_ISSUE)))) return rows
  const q = ledger.db.prepare('SELECT alert_ym FROM alerts WHERE rid = ?')
  return rows.map((r) => {
    const i = r.issues.findIndex((x) => x.startsWith(FIRST_SEEN_ISSUE))
    const prev = i < 0 ? undefined : (q.get(r.rid) as { alert_ym: number } | undefined)
    if (!prev) return r
    const issues = [...r.issues]
    issues[i] = firstSeenIssue(prev.alert_ym)
    return { ...r, issues }
  })
}

/** Runs one stored document through extract → resolve → ledger (→ publish). Throws on failure; callers isolate. */
export async function processDocument(
  adapter: Pick<SourceAdapter, 'rows'> | undefined,
  raw: RawDoc,
  bytes: Uint8Array,
  deps: { ledger: Ledger; extract: () => Promise<ExtractFn>; publisher?: NoticePublisher },
  opts: { ocr?: boolean; llm?: boolean; publish?: boolean; signal?: AbortSignal } = {},
) {
  const { ledger } = deps
  const skipped: SkipTally = {}
  let rows: ExtractedRow[]
  let parser: string | undefined
  let method: string | undefined
  let rejected = 0
  if (adapter?.rows) {
    rows = await adapter.rows(raw, bytes, skipped)
    rejected = Object.values(skipped).reduce((a, b) => a + b, 0)
  } else {
    const extract = await deps.extract()
    const res = await extract(raw, bytes, { ocr: opts.ocr, llm: opts.llm })
    rows = res.rows
    parser = res.parser
    method = res.method
    rejected = res.rejected.length
    for (const r of res.rejected) countSkip(skipped, reasonKey(r.reason))
  }
  // Work abandoned by the watchdog stops here instead of overwriting the "failed" status later.
  checkpoint(opts.signal)
  rows = keepFirstSeen(ledger, rows)
  ledger.setDocumentStatus(raw.sha256, 'extracted', { rows: rows.length, rejected, parser: parser ?? rows[0]?.parser, method: method ?? rows[0]?.method })
  ledger.replaceRows(raw.sha256, rows)
  const { notice, alerts, curator, merged } = resolveRows(raw, rows, skipped)
  ledger.upsertAlerts([...alerts, ...curator], confusionKey)
  // A repeat listing folded into another alert: hide the copy if an earlier run stored it.
  for (const m of merged) ledger.markSuperseded(m.rid, m.into)
  ledger.upsertNotice(notice)
  ledger.setDocumentStatus(raw.sha256, 'resolved')
  let published = 0
  checkpoint(opts.signal)
  if (opts.publish && deps.publisher && alerts.length) {
    const rep = await deps.publisher.publishNotice(raw.sha256)
    published = rep.published
    if (rep.chunks.some((c) => c.status === 'failed')) throw new Error(`publish failed for ${raw.sha256}`)
    if (rep.chunks.length && rep.chunks.every((c) => c.status === 'confirmed' || c.status === 'reconciled')) ledger.setDocumentStatus(raw.sha256, 'published')
  }
  return { rows: rows.length, alerts: alerts.length, curator: curator.length, published, skipped }
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
    const docMs = opts.docTimeoutMs ?? env().NAZAR_DOC_TIMEOUT_MS
    const sourceMs = opts.sourceTimeoutMs ?? env().NAZAR_SOURCE_TIMEOUT_MS

    for (const adapter of sources) {
      if (opts.signal?.aborted) {
        aborted = true
        break
      }
      const s = emptyStats(adapter.id)
      stats.push(s)
      const t0 = Date.now()
      const remaining = () => t0 + sourceMs - Date.now()
      const sourceAbort = new AbortController()
      const signal = opts.signal ? AbortSignal.any([opts.signal, sourceAbort.signal]) : sourceAbort.signal
      const sourceTimeout = () => new RunTimeoutError(`source ${adapter.id} timed out after ${sourceMs} ms (NAZAR_SOURCE_TIMEOUT_MS)`, { source: adapter.id })
      const finishSource = () => {
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

      let discovered: DiscoveredDoc[] = []
      try {
        discovered = await watchdog(adapter.discover({ http, sinceYm: opts.sinceYm, limit, signal }), remaining(), sourceTimeout)
      } catch (err) {
        if (err instanceof RunTimeoutError) sourceAbort.abort()
        s.failed++
        s.errors.push({ url: adapter.homepage, error: `discover: ${errorMessage(err)}` })
        log.error({ source: adapter.id, err: errorMessage(err) }, 'discover failed')
        finishSource()
        continue
      }
      s.discovered = discovered.length
      for (const doc of discovered.slice(0, limit)) {
        if (opts.signal?.aborted) {
          aborted = true
          break
        }
        if (remaining() <= 0) {
          sourceAbort.abort()
          s.failed++
          s.errors.push({ url: adapter.homepage, error: sourceTimeout().message })
          log.error({ source: adapter.id }, 'source watchdog fired; moving to the next source')
          break
        }
        const docAbort = new AbortController()
        // Only the watchdogs abandon a document midway; a caller's abort still stops between documents.
        const docSignal = AbortSignal.any([sourceAbort.signal, docAbort.signal])
        const sourceBound = remaining() < docMs
        let sha: string | null = null
        const work = async (): Promise<'skipped' | Awaited<ReturnType<typeof processDocument>>> => {
          const h = await harvest(doc, { http, store, ledger })
          checkpoint(docSignal)
          if (!h) return 'skipped'
          sha = h.raw.sha256
          const prior = ledger.getDocument(sha)
          if (!h.isNew && prior && (prior.status === 'resolved' || prior.status === 'published')) {
            // Catch-up: a document resolved while publishing was off (dry-run, unfunded wallet, a fresh
            // server) still has pending alerts. Publish them now; the publisher reconciles with Arkiv first.
            if (opts.publish && deps.publisher && ledger.unpublishedAlerts(sha).length) {
              const rep = await deps.publisher.publishNotice(sha)
              s.published += rep.published
              if (rep.chunks.some((c) => c.status === 'failed')) throw new Error(`catch-up publish failed for ${sha}`)
            }
            return 'skipped'
          }
          s.harvested++
          return processDocument(adapter, h.raw, h.bytes, { ledger, extract, publisher: deps.publisher }, { ...opts, signal: docSignal })
        }
        try {
          const r = await watchdog(work(), Math.min(docMs, remaining()), () =>
            sourceBound ? sourceTimeout() : new RunTimeoutError(`document timed out after ${docMs} ms (NAZAR_DOC_TIMEOUT_MS)`, { url: doc.url }),
          )
          if (r === 'skipped') {
            s.skipped++
            continue
          }
          s.processed++
          s.rows += r.rows
          s.alerts += r.alerts
          s.curator += r.curator
          s.published += r.published
          mergeTally(s.skippedRows, r.skipped)
        } catch (err) {
          if (err instanceof RunTimeoutError) docAbort.abort()
          s.failed++
          s.errors.push({ url: doc.url, error: errorMessage(err) })
          if (sha) ledger.setDocumentStatus(sha, 'failed', { error: errorMessage(err).slice(0, 1000) })
          log.error({ source: adapter.id, url: doc.url, err: errorMessage(err) }, 'document failed; continuing')
          if (err instanceof RunTimeoutError && sourceBound) {
            sourceAbort.abort()
            log.error({ source: adapter.id }, 'source watchdog fired; moving to the next source')
            break
          }
        }
      }
      finishSource()
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
      skippedRows: mergeTally(t.skippedRows, s.skippedRows),
    }),
    { discovered: 0, harvested: 0, skipped: 0, processed: 0, rows: 0, alerts: 0, curator: 0, published: 0, failed: 0, skippedRows: {} as SkipTally },
  )
  const ok = !fatal && !aborted
  ledger.finishRun(runId, ok, { sources: stats.map(({ errors, ...rest }) => ({ ...rest, errors: errors.slice(0, 5) })), totals, aborted }, fatal)
  if (fatal) throw new NazarError(`pipeline run failed: ${fatal}`, 'RUN', { runId })
  return { runId, ok, aborted, startedAt, finishedAt: new Date().toISOString(), sources: stats, totals }
}
