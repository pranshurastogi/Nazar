import { Hono, type Context } from 'hono'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { etag } from 'hono/etag'
import type { Hex } from 'viem'
import { z } from 'zod'

import { publicClient } from '../arkiv/client.ts'
import { DirectoryError, EntitiesQuery, type ArkivDirectory } from '../arkiv/directory.ts'
import type { ArkivReader } from '../arkiv/reader.ts'
import { env } from '../config/env.ts'
import { BATCH_SHAPE, confusionKey, matchKey, stripBatchLabel } from '../domain/batch.ts'
import { PRODUCT_CLASSES } from '../domain/vocab.ts'
import { NazarError, errorMessage, redactSecrets } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { ExplainError, MedicineExplainer } from '../medicine/explain.ts'
import { MedicineIdentifier } from '../medicine/identify.ts'
import { clientIp } from '../medicine/limits.ts'
import { ExplainInput, IDENTIFY_MAX_BODY_BYTES, IdentifyInput, MAX_BODY_BYTES } from '../medicine/schema.ts'
import { mcpHandler, type McpHttpOptions } from '../mcp/http.ts'
import { readProof, type ProofClient } from '../mcp/proof.ts'
import type { PipelineStatus } from '../pipeline/status.ts'
import { isPublishableTier } from '../resolve/case.ts'
import type { EgressStatus } from '../pipeline/egress.ts'
import { FEED_ORDER, type AlertRow, type Ledger } from '../storage/ledger.ts'
import { alertDto, noticeDto, viewDto, type AlertDTO, type DtoContext } from './dto.ts'
import { CACHE, CheckCache, cdnCacheHeaders } from './cache-policy.ts'
import { SnapshotService, serveSnapshot } from './snapshot.ts'

const log = child('api')

/**
 * Read API for the web app. Answers from the local ledger (fast, complete) and falls back to
 * reading Arkiv directly when the ledger has nothing for a batch, so a fresh deploy with an empty
 * ledger still answers from the chain. Result states follow the app's rules exactly:
 *   bad shape → unreadable; exact match → flagged / retracted;
 *   look-alike (0/O, 1/I/L, 5/S, 8/B) → unreadable + "did you mean", never flagged.
 */

export interface SourceInfo {
  id: string
  authority: string
  jurisdiction: string
  homepage: string
  description: string
  schedule: string
  enabled: boolean
  /** Why a source is paused, in plain words for people using the app. */
  disabledReason?: string | null
  /** How an operator would switch it on (env vars, hosting). Not for display to the public. */
  operatorNote?: string | null
  lastRun: unknown
}

export interface AppDeps {
  ledger: Ledger
  /** Arkiv fallback for /v1/check; null disables it (tests, offline). */
  reader?: Pick<ArkivReader, 'byBatch' | 'retractionsFor'> | null
  sources?: () => SourceInfo[] | Promise<SourceInfo[]>
  status?: () => Promise<PipelineStatus>
  version?: string
  mode?: 'dry-run' | 'live'
  publisher?: Hex | null
  chainId?: number
  corsOrigins?: string[]
  explorerBase?: string
  readerTimeoutMs?: number
  now?: () => Date
  /** Startup egress check (region + CDSCO reachability); see src/pipeline/egress.ts. */
  egress?: () => EgressStatus | null
  /** Arkiv directory (/v1/arkiv/*): live counts and filtered entity pages read from Arkiv; null disables it. */
  directory?: Pick<ArkivDirectory, 'summary' | 'entities'> | null
  /** Pre-compressed alert snapshot for on-device checks (/v1/snapshot); defaults to one over the ledger. */
  snapshot?: SnapshotService
  /** "About this medicine" (POST /v1/medicine/explain); defaults to one built from env. */
  medicine?: Pick<MedicineExplainer, 'explain'>
  /** Pack identification from OCR'd label text (POST /v1/medicine/identify); defaults to one built from env. */
  identify?: Pick<MedicineIdentifier, 'identify'>
  /** MCP server (/mcp). arkiv_proof reads entities live through `proofClient` (null disables it) and trusts `publisher`. */
  mcp?: { proofClient?: ProofClient | null; publisher?: Hex | null; limits?: McpHttpOptions }
}

export type CheckState = 'flagged' | 'retracted' | 'no_alert' | 'unreadable'
export interface CheckResponse {
  state: CheckState
  batch: string
  asOf: string
  alerts: AlertDTO[]
  suggestion?: string
  source: 'ledger' | 'arkiv'
}

class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 410 | 413 | 500 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

// ---- input validation
const intParam = (min: number, max: number) => z.coerce.number().int().min(min).max(max)
const ymParam = z.coerce.number().int().min(199001).max(209912).refine((v) => v % 100 >= 1 && v % 100 <= 12, 'must be YYYYMM')
const boolParam = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

const AlertsQuery = z.object({
  limit: intParam(1, 200).default(50),
  offset: intParam(0, 100_000).default(0),
  state: z.string().regex(/^IN-[A-Z]{2}$/, 'must be an ISO 3166-2:IN code like IN-TN').optional(),
  minSeverity: intParam(1, 5).optional(),
  peds: boolParam.optional(),
  sinceYm: ymParam.optional(),
  source: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, 'must be a source id like cdsco-online').optional(),
  productClass: z.enum(PRODUCT_CLASSES).optional(),
})
const CheckQuery = z.object({ batch: z.string().max(200) })
const SearchQuery = z.object({ q: z.string().trim().min(1).max(100), limit: intParam(1, 100).default(25) })
const NoticesQuery = z.object({ limit: intParam(1, 200).default(50) })
const IdParam = z.string().regex(/^[0-9a-f]{8,64}$/, 'must be a hex id')

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input)
  if (!r.success) {
    throw new HttpError(400, 'BAD_REQUEST', 'invalid request', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  }
  return r.data
}

const LIST_CACHE = CACHE.list
const CHECK_CACHE = CACHE.check

const publishable = (rows: AlertRow[]) => rows.filter((r) => isPublishableTier(r.record.tier))

function parseRow(r: Record<string, unknown>): AlertRow {
  return {
    rid: String(r.rid),
    record: JSON.parse(String(r.data)),
    entityKey: (r.entity_key as string | null) ?? null,
    txHash: (r.tx_hash as string | null) ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
    retracted: r.retracted === 1,
  }
}

/** Feed query: like Ledger.recentAlerts but only batch-level tiers, with a total for paging. */
function listAlerts(ledger: Ledger, q: z.infer<typeof AlertsQuery>) {
  const where = ["retracted = 0", "tier IN ('auto','machine_read')"]
  const args: (string | number)[] = []
  if (q.state) (where.push('state = ?'), args.push(q.state))
  if (q.minSeverity) (where.push('severity >= ?'), args.push(q.minSeverity))
  if (q.peds !== undefined) (where.push('peds = ?'), args.push(q.peds ? 1 : 0))
  if (q.sinceYm) (where.push('alert_ym >= ?'), args.push(q.sinceYm))
  if (q.source) (where.push('source_id = ?'), args.push(q.source))
  if (q.productClass) (where.push('product_class = ?'), args.push(q.productClass))
  const w = where.join(' AND ')
  const total = (ledger.db.prepare(`SELECT COUNT(*) n FROM alerts WHERE ${w}`).get(...args) as { n: number }).n
  const rows = (
    ledger.db
      .prepare(`SELECT * FROM alerts WHERE ${w} ORDER BY ${FEED_ORDER} LIMIT ? OFFSET ?`)
      .all(...args, q.limit, q.offset) as Record<string, unknown>[]
  ).map(parseRow)
  return { rows, total }
}

function listNotices(ledger: Ledger, limit: number) {
  return (
    ledger.db
      .prepare("SELECT data, entity_key, tx_hash FROM notices ORDER BY json_extract(data, '$.noticeYm') DESC, sha LIMIT ?")
      .all(limit) as { data: string; entity_key: string | null; tx_hash: string | null }[]
  ).map((r) => ({ record: JSON.parse(r.data), entityKey: r.entity_key, txHash: r.tx_hash }))
}

function getAlert(ledger: Ledger, rid: string): AlertRow | undefined {
  const r = ledger.db.prepare('SELECT * FROM alerts WHERE rid = ?').get(rid) as Record<string, unknown> | undefined
  return r ? parseRow(r) : undefined
}

const timeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms))])

async function defaultSources(ledger: Ledger): Promise<SourceInfo[]> {
  const [{ allSources, sourceStatus }, { sourceLastCheck }] = await Promise.all([import('../sources/registry.ts'), import('../pipeline/status.ts')])
  return allSources().map((s) => {
    const st = sourceStatus(s)
    return {
      id: s.id,
      authority: s.authority,
      jurisdiction: s.jurisdiction,
      homepage: s.homepage,
      description: s.description,
      schedule: s.schedule,
      enabled: st.enabled,
      disabledReason: st.disabledReason,
      operatorNote: st.operatorNote,
      lastRun: sourceLastCheck(ledger, s.id),
    }
  })
}

export function createApp(deps: AppDeps) {
  const { ledger } = deps
  const e = env()
  const ctx: DtoContext = { publisher: deps.publisher ?? null, explorerBase: deps.explorerBase ?? e.ARKIV_EXPLORER_URL }
  const now = deps.now ?? (() => new Date())
  const origins = deps.corsOrigins ?? e.NAZAR_CORS_ORIGINS
  const app = new Hono()

  app.use('*', async (c, next) => {
    const t0 = performance.now()
    await next()
    log.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - t0) }, 'request')
  })
  const webCors = cors({
    origin: origins.includes('*') ? '*' : origins,
    allowMethods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    exposeHeaders: ['Retry-After'],
    maxAge: 600,
  })
  // MCP clients run anywhere (desktop apps, browser inspectors, hosted assistants), so /mcp is open to every origin.
  const mcpCors = cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept', 'Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'Last-Event-ID'],
    exposeHeaders: ['Mcp-Session-Id', 'Mcp-Protocol-Version', 'Retry-After'],
    maxAge: 600,
  })
  app.use('*', (c, next) => (c.req.path === '/mcp' ? mcpCors(c, next) : webCors(c, next)))
  // Outside etag, so tags are computed on the plain body; the snapshot ships pre-compressed and is skipped.
  const gzip = compress()
  app.use('*', (c, next) => (c.req.path === '/mcp' ? next() : gzip(c, next)))
  app.use('/v1/*', cdnCacheHeaders())
  app.use('/v1/*', etag({ weak: true }))

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: redactSecrets(err.message), details: err.details } }, err.status)
    if (err instanceof ExplainError) {
      if (err.retryAfterSec) c.header('Retry-After', String(err.retryAfterSec))
      c.header('Cache-Control', 'no-store')
      return c.json({ error: { code: err.code, message: err.message, ...(err.retryAfterSec ? { retryAfterSec: err.retryAfterSec } : {}) } }, err.status)
    }
    if (err instanceof DirectoryError) {
      if (err.retryAfterSec) c.header('Retry-After', String(err.retryAfterSec))
      c.header('Cache-Control', 'no-store')
      return c.json({ error: { code: err.code, message: redactSecrets(err.message) } }, err.code === 'CURSOR_EXPIRED' ? 410 : 503)
    }
    log.error({ err: errorMessage(err), path: c.req.path }, 'unhandled error')
    const code = err instanceof NazarError ? err.code : 'INTERNAL'
    return c.json({ error: { code, message: 'internal error' } }, 500)
  })
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: `no route for ${c.req.method} ${c.req.path}` } }, 404))

  const listJson = (c: Context, body: unknown) => {
    c.header('Cache-Control', LIST_CACHE)
    return c.json(body)
  }

  app.get('/health', (c) =>
    c.json({
      ok: true,
      version: deps.version ?? '0.1.0',
      mode: deps.mode ?? e.NAZAR_PUBLISH_MODE,
      publisher: deps.publisher ?? null,
      chainId: deps.chainId ?? e.ARKIV_CHAIN_ID,
      stats: ledger.stats(),
      egress: deps.egress?.() ?? null,
      warnings: [deps.egress?.()?.warning].filter(Boolean),
    }),
  )

  const checkCache = new CheckCache<CheckResponse>(ledger)
  const snapshot = deps.snapshot ?? new SnapshotService(ledger)
  app.get('/v1/snapshot', (c) => serveSnapshot(c, snapshot))

  /** The cached check shared by /v1/check and the MCP check_batch tool. */
  const cachedCheck = async (raw: string): Promise<CheckResponse> => {
    const key = stripBatchLabel(raw).replace(/\s+/g, ' ').toUpperCase()
    return { ...(await checkCache.get(key, () => check(raw))), asOf: now().toISOString() }
  }

  app.get('/v1/check', async (c) => {
    const { batch: raw } = parse(CheckQuery, c.req.query())
    const result = await cachedCheck(raw)
    c.header('Cache-Control', CHECK_CACHE)
    return c.json(result)
  })

  async function check(raw: string): Promise<CheckResponse> {
    // People type what the pack says, label included ("B.No. SR-13"); match the batch alone.
    const batch = stripBatchLabel(raw).replace(/\s+/g, ' ').toUpperCase()
    const asOf = now().toISOString()
    const base = { batch, asOf, alerts: [] as AlertDTO[], source: 'ledger' as const }
    if (!BATCH_SHAPE.test(batch) || matchKey(batch).length < 2) return { ...base, state: 'unreadable' }

    const exact = publishable(ledger.alertsByBatchKey(matchKey(batch)))
    if (exact.length) {
      const alerts = exact.map((r) => alertDto(r, ctx)).sort((a, b) => Number(a.retracted) - Number(b.retracted) || b.severity - a.severity)
      return { ...base, batch: exact[0]!.record.batch, alerts, state: alerts.every((a) => a.retracted) ? 'retracted' : 'flagged' }
    }

    if (deps.reader) {
      try {
        const views = (await timeout(deps.reader.byBatch(batch), deps.readerTimeoutMs ?? 6000)).filter((v) => isPublishableTier(v.tier))
        if (views.length) {
          const retractions = await timeout(deps.reader.retractionsFor(views.map((v) => v.entityKey)), deps.readerTimeoutMs ?? 6000).catch(() => new Map())
          const alerts = views.map((v) => viewDto(v, retractions.has(v.entityKey.toLowerCase()), ctx))
          return { batch: alerts[0]!.batch || batch, asOf, alerts, source: 'arkiv', state: alerts.every((a) => a.retracted) ? 'retracted' : 'flagged' }
        }
      } catch (err) {
        log.warn({ err: errorMessage(err) }, 'arkiv fallback failed; answering from the ledger')
      }
    }

    // A look-alike is never a flag: ask the person to re-read the pack.
    const look = publishable(ledger.alertsByConfusionKey(confusionKey(batch))).find((r) => r.record.batchKey !== matchKey(batch))
    if (look) return { ...base, state: 'unreadable', suggestion: look.record.batch }
    return { ...base, state: 'no_alert' }
  }

  app.get('/v1/alerts', (c) => {
    const q = parse(AlertsQuery, c.req.query())
    const { rows, total } = listAlerts(ledger, q)
    return listJson(c, { items: rows.map((r) => alertDto(r, ctx)), total })
  })

  app.get('/v1/alerts/:rid', (c) => {
    const rid = parse(IdParam, c.req.param('rid'))
    const row = getAlert(ledger, rid)
    if (!row || !isPublishableTier(row.record.tier)) throw new HttpError(404, 'NOT_FOUND', `no alert ${rid}`)
    return listJson(c, alertDto(row, ctx))
  })

  app.get('/v1/search', (c) => {
    const q = parse(SearchQuery, c.req.query())
    return listJson(c, { items: publishable(ledger.searchAlerts(q.q, q.limit)).map((r) => alertDto(r, ctx)) })
  })

  app.get('/v1/cases/:caseId', (c) => {
    const caseId = parse(IdParam, c.req.param('caseId'))
    const items = publishable(ledger.alertsByCase(caseId)).map((r) => alertDto(r, ctx))
    if (!items.length) throw new HttpError(404, 'NOT_FOUND', `no case ${caseId}`)
    return listJson(c, { caseId, items })
  })

  app.get('/v1/notices', (c) => {
    const q = parse(NoticesQuery, c.req.query())
    return listJson(c, { items: listNotices(ledger, q.limit).map((n) => noticeDto(n, ctx)) })
  })

  app.get('/v1/sources', async (c) => {
    const items = await (deps.sources ?? (() => defaultSources(ledger)))()
    return listJson(c, { items })
  })

  app.get('/v1/pipeline/status', async (c) => {
    if (!deps.status) throw new HttpError(503, 'UNAVAILABLE', 'pipeline status is not wired in this process')
    c.header('Cache-Control', 'no-store')
    return c.json({ ...(await deps.status()), egress: deps.egress?.() ?? null })
  })

  // ---- Arkiv directory: read straight from Arkiv, never from the ledger.
  const directory = () => {
    if (!deps.directory) throw new HttpError(503, 'UNAVAILABLE', 'the Arkiv directory is not wired in this process (no publisher configured)')
    return deps.directory
  }

  app.get('/v1/arkiv/summary', async (c) => {
    const body = await directory().summary()
    c.header('Cache-Control', body.stale ? CACHE.arkivSummaryStale : CACHE.arkivSummary)
    return c.json(body)
  })

  app.get('/v1/arkiv/entities', async (c) => {
    const q = parse(EntitiesQuery, c.req.query())
    const body = await directory().entities(q)
    // Pages read at a pinned block never change; first pages follow the chain head.
    c.header('Cache-Control', q.cursor ? CACHE.arkivPinnedPage : CACHE.arkivFirstPage)
    return c.json(body)
  })

  // ---- About this medicine: general LLM reference text + Nazar's own alert count. Opt-in from the app.
  const readJson = async (c: Context, max: number): Promise<unknown> => {
    if (Number(c.req.header('content-length') ?? 0) > max) throw new HttpError(413, 'TOO_LARGE', `body must be at most ${max} bytes`)
    const raw = await c.req.text()
    if (Buffer.byteLength(raw) > max) throw new HttpError(413, 'TOO_LARGE', `body must be at most ${max} bytes`)
    try {
      return JSON.parse(raw)
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'body must be JSON')
    }
  }
  const callerIp = (c: Context) => clientIp(c.req.header(), (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress)

  let medicine = deps.medicine
  app.post('/v1/medicine/explain', async (c) => {
    const input = parse(ExplainInput, await readJson(c, MAX_BODY_BYTES))
    medicine ??= new MedicineExplainer({ ledger })
    const result = await medicine.explain(input, callerIp(c))
    c.header('Cache-Control', 'no-store')
    return c.json(result)
  })

  // ---- Add to cabinet from a photo: the device OCRs the label and sends text only; values are grounded in that text.
  let identifier = deps.identify
  app.post('/v1/medicine/identify', async (c) => {
    const input = parse(IdentifyInput, await readJson(c, IDENTIFY_MAX_BODY_BYTES))
    identifier ??= new MedicineIdentifier({ ledger })
    const result = await identifier.identify(input, callerIp(c))
    c.header('Cache-Control', 'no-store')
    return c.json(result)
  })

  // ---- MCP: the same answers for AI assistants (see src/mcp). Read-only; no Gemini explainer or pack identification here.
  const proofClient = deps.mcp?.proofClient === undefined ? () => publicClient() : deps.mcp.proofClient ? () => deps.mcp!.proofClient! : null
  const proofPublisher = deps.mcp?.publisher !== undefined ? deps.mcp.publisher : (deps.publisher ?? null)
  const mcp = mcpHandler(
    {
      check: cachedCheck,
      alerts: (q) => {
        const { rows, total } = listAlerts(ledger, { offset: 0, ...q })
        return { items: rows.map((r) => alertDto(r, ctx)), total }
      },
      search: (q, limit) => publishable(ledger.searchAlerts(q, limit)).map((r) => alertDto(r, ctx)),
      caseItems: (caseId) => publishable(ledger.alertsByCase(caseId)).map((r) => alertDto(r, ctx)),
      sources: async () => (deps.sources ?? (() => defaultSources(ledger)))(),
      proof: proofClient ? (key) => readProof(key, { client: proofClient(), publisher: proofPublisher, explorerBase: ctx.explorerBase }) : null,
    },
    deps.mcp?.limits,
  )
  app.on(['GET', 'POST', 'DELETE'], '/mcp', mcp)

  return Object.assign(app, { check, checkCache, snapshot })
}

export type NazarApp = ReturnType<typeof createApp>
