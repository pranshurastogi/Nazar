import { createPublicClient, type PublicArkivClient } from '@arkiv-network/sdk'
import { i32, str } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq, gte, or, type Expression } from '@arkiv-network/sdk/query'
import { http, type Hex } from 'viem'

import { ARKIV_RPC_URL, PROJECT, PUBLISHER } from './config'
import { fromArkiv, type ArkivAlert } from './map'
import { confusionVariants, matchKey, resolveResult } from './match'
import type { Alert, CheckResult } from './types'

// Reads Nazar's alerts straight from Arkiv in the browser. This is the path that keeps
// working when every Nazar server is down: the data lives on-chain and every query is
// pinned to Nazar's project tag and publisher wallet, so nobody else can inject alerts.

// The public RPC is rate limited (HTTP 429). Concurrent calls are coalesced into one
// JSON-RPC batch, identical queries share one in-flight request and a short-lived cache,
// and a 429 or network failure pauses every Arkiv read with exponential backoff (honouring
// Retry-After) so a busy node is never hammered. Callers fall through to demo data meanwhile.
let client: PublicArkivClient | undefined
const arkiv = () =>
  (client ??= createPublicClient({
    chain: tiramisu,
    transport: http(ARKIV_RPC_URL, { timeout: 6000, retryCount: 0, batch: { batchSize: 10, wait: 20 } }),
  }))

/** Thrown without touching the network while Arkiv reads are paused after a failure. */
export class ArkivBackoffError extends Error {
  constructor(readonly retryInMs: number) {
    super(`Arkiv reads paused for ${Math.ceil(retryInMs / 1000)} s after a failed request`)
    this.name = 'ArkivBackoffError'
  }
}

const SECOND = 1000
const MAX_BACKOFF_MS = 10 * 60 * SECOND
let failures = 0
let pausedUntil = 0

type HttpLike = { status?: number; headers?: { get?(name: string): string | null }; cause?: unknown; name?: string }

/** Finds the HTTP status and Retry-After header anywhere in viem's error chain. */
function httpInfo(err: unknown) {
  for (let e = err as HttpLike | undefined, depth = 0; e && depth < 6; e = e.cause as HttpLike | undefined, depth++) {
    if (typeof e.status === 'number') return { status: e.status, retryAfter: e.headers?.get?.('retry-after') ?? null }
  }
  return { status: null, retryAfter: null }
}

const retryAfterMs = (v: string | null) => {
  if (!v) return 0
  const secs = Number(v)
  if (Number.isFinite(secs)) return secs * SECOND
  const at = Date.parse(v)
  return Number.isNaN(at) ? 0 : at - Date.now()
}

function noteFailure(err: unknown) {
  const { status, retryAfter } = httpInfo(err)
  // A node that rejects a query (bad syntax, expired cursor) is up; only throttling, server and network errors pause reads.
  const throttled = status === 429
  if (!throttled && status !== null && status < 500) return
  if (status === null && (err as HttpLike)?.name === 'QueryError') return
  failures++
  const base = throttled ? 60 * SECOND : 10 * SECOND
  const wait = Math.max(Math.min(base * 2 ** (failures - 1), MAX_BACKOFF_MS), retryAfterMs(retryAfter))
  pausedUntil = Date.now() + wait
}

/** Milliseconds until Arkiv reads resume; 0 when they are allowed. */
export const arkivPausedFor = () => Math.max(0, pausedUntil - Date.now())

const cache = new Map<string, { until: number; p: Promise<unknown> }>()

/**
 * Runs one RPC read through the shared gate. With a key, identical reads share the
 * in-flight request and its result for `ttlMs`; failures are never cached.
 */
function gated<T>(cacheKey: string | null, ttlMs: number, run: () => Promise<T>): Promise<T> {
  const now = Date.now()
  if (cacheKey) {
    const hit = cache.get(cacheKey)
    if (hit && hit.until > now) return hit.p as Promise<T>
  }
  if (now < pausedUntil) return Promise.reject(new ArkivBackoffError(pausedUntil - now))
  const p = run().then(
    (v) => {
      failures = 0
      return v
    },
    (err) => {
      if (cacheKey) cache.delete(cacheKey)
      noteFailure(err)
      throw err
    },
  )
  if (cacheKey) cache.set(cacheKey, { until: now + ttlMs, p })
  return p
}

const TTL = { status: 60 * SECOND, list: 5 * 60 * SECOND, check: 60 * SECOND }

/** The RPC transport has no per-call signal, so we race it against the caller's. */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

type Attr = { type?: string; value?: unknown } | undefined
type RawEntity = { key?: Hex; creator?: Hex; attributes?: Readonly<Record<string, unknown>>; payload?: Uint8Array; toJson(): unknown }

/** The SDK narrows entity types per selection; we read them through one loose shape. */
const entitiesOf = (page: { entities: readonly unknown[] }) => page.entities as readonly RawEntity[]

const s = (a: Attr) => (a && a.value !== undefined && a.value !== null ? String(a.value) : null)
const n = (a: Attr) => (a && a.value !== undefined && a.value !== null ? Number(a.value) : null)

function payloadOf(e: RawEntity): ArkivAlert['payload'] {
  if (!e.payload?.length) return null
  try {
    return e.toJson() as ArkivAlert['payload']
  } catch {
    try {
      return JSON.parse(new TextDecoder().decode(e.payload)) as ArkivAlert['payload']
    } catch {
      return null
    }
  }
}

/** Mirrors decodeAlert in Nazar-backend/src/arkiv/schema.ts. */
export function decodeAlert(e: RawEntity): ArkivAlert {
  const a = (e.attributes ?? {}) as Record<string, Attr>
  return {
    entityKey: e.key ?? '',
    creator: e.creator ?? null,
    batchKey: s(a.batch) ?? '',
    batch: s(a.batch_raw) ?? s(a.batch) ?? '',
    rid: s(a.rid) ?? '',
    brand: s(a.brand) ?? '',
    form: s(a.form) ?? 'other',
    category: s(a.cat) ?? 'nsq',
    failure: s(a.fail) ?? 'other',
    severity: n(a.sev) ?? 1,
    peds: n(a.peds) === 1,
    mfgYm: n(a.mfg_ym),
    expYm: n(a.exp_ym),
    alertYm: n(a.alert_ym),
    sourceId: s(a.src) ?? '',
    state: s(a.state),
    confidence: (n(a.conf) ?? 0) / 100,
    method: s(a.method) ?? 'text',
    tier: s(a.tier) ?? 'auto',
    payload: payloadOf(e),
  }
}

const mine = (t: string) => [eq('project', str(PROJECT)), eq('t', str(t))]
const anyOf = (exprs: Expression[]) => (exprs.length === 1 ? exprs[0]! : or(exprs))

const ALERT_FIELDS = { key: true, attributes: true, payload: true, creator: true } as const

/** The slice of the SDK's QueryResult we use, independent of the selection's entity type. */
type Page = { entities: readonly unknown[]; hasNextPage(): boolean; next(): Promise<Page> }

/**
 * Nazar may not have published anything yet (fresh deploy, testnet reset). An empty
 * dataset must never be read as "no alert", so callers fall through to the next source.
 * Any alert query that returns entities settles this without a request of its own.
 */
let datasetSeen = false
let emptyCheckedAt = 0
const sawAlerts = (page: Page) => {
  if (page.entities.length) datasetSeen = true
  return page
}

/** Alert query through the gate, cached under its filters. */
function alertQuery(name: string, filters: Expression[], limit: number, ttlMs: number, signal?: AbortSignal): Promise<Page> {
  return abortable(
    gated(`${name}:${limit}`, ttlMs, () => arkiv().select(ALERT_FIELDS).where(filters).createdBy(PUBLISHER).limit(limit).fetch() as Promise<Page>).then(sawAlerts),
    signal,
  )
}

export async function arkivHasData(signal?: AbortSignal) {
  if (datasetSeen) return true
  if (Date.now() - emptyCheckedAt < 60_000) return false
  const page = await abortable(
    gated('has-data', TTL.status, () => arkiv().select({ key: true }).where(mine('alert')).createdBy(PUBLISHER).limit(1).fetch() as Promise<Page>),
    signal,
  )
  datasetSeen = page.entities.length > 0
  if (!datasetSeen) emptyCheckedAt = Date.now()
  return datasetSeen
}

type Retraction = { reason: string; note: string | null }

/** Every retraction Nazar has published, keyed by the alert it withdraws. One shared, cached read. */
function retractions(signal?: AbortSignal): Promise<Map<string, Retraction>> {
  return abortable(
    gated('retractions', TTL.list, async () => {
      const page = await arkiv().select({ key: true, attributes: true, payload: true }).where(mine('retraction')).createdBy(PUBLISHER).limit(200).fetch()
      const byAlert = new Map<string, Retraction>()
      for (const e of entitiesOf(page)) {
        const a = (e.attributes ?? {}) as Record<string, Attr>
        const target = s(a.alert)?.toLowerCase()
        if (!target) continue
        let note: string | null = null
        try {
          note = (e.toJson() as { note?: string })?.note ?? null
        } catch {}
        byAlert.set(target, { reason: s(a.reason) ?? 'correction', note })
      }
      return byAlert
    }),
    signal,
  )
}

/** Retractions point at the alert they withdraw; attach them so the UI can show "Retracted". */
async function withRetractions(alerts: ArkivAlert[], signal?: AbortSignal) {
  if (!alerts.length) return alerts
  const byAlert = await retractions(signal)
  return alerts.map((a) => {
    const r = byAlert.get(a.entityKey.toLowerCase())
    return r ? { ...a, retraction: r } : a
  })
}

/** Returns null when Arkiv has no Nazar data to answer from. */
export async function arkivCheck(batch: string, signal?: AbortSignal): Promise<CheckResult | null> {
  const exactKey = matchKey(batch)
  const variants = confusionVariants(batch)
  const page = await alertQuery(`check:${variants.join(',')}`, [...mine('alert'), anyOf(variants.map((v) => eq('batch', str(v))))], 50, TTL.check, signal)
  const decoded = entitiesOf(page).map(decodeAlert)
  const exact = decoded.filter((a) => a.batchKey === exactKey)
  // Only an empty answer needs to know whether Arkiv holds any Nazar data at all.
  if (!exact.length && !decoded.length && !(await arkivHasData(signal))) return null
  const lookAlike = exact.length ? undefined : decoded[0]?.batch
  const alerts = exact.length ? (await withRetractions(exact, signal)).map(fromArkiv) : []
  return resolveResult(batch, alerts, lookAlike, 'arkiv')
}

const newestActive = (alerts: ArkivAlert[]) =>
  alerts.map(fromArkiv).filter((a) => !a.retraction).sort((a, b) => b.noticeOrder - a.noticeOrder)

/** Recent high-severity alerts for the home page, newest first. Null when Arkiv has no Nazar data. */
export async function arkivAlerts(q: { minSeverity?: number; peds?: boolean; limit?: number } = {}, signal?: AbortSignal): Promise<Alert[] | null> {
  const filters: Expression[] = [...mine('alert')]
  if (q.minSeverity) filters.push(gte('sev', i32(q.minSeverity)))
  if (q.peds) filters.push(eq('peds', i32(1)))
  const page = await alertQuery(`alerts:${q.minSeverity ?? 0}:${q.peds ? 1 : 0}`, filters, q.limit ?? 30, TTL.list, signal)
  if (!page.entities.length) return null
  return newestActive(await withRetractions(entitiesOf(page).map(decodeAlert), signal))
}

export type ArkivFeedQuery = { minSeverity?: number; peds?: boolean; state?: string; source?: string; sinceYm: number; limit: number }
export type ArkivFeedPage = { items: Alert[]; next: ((signal?: AbortSignal) => Promise<ArkivFeedPage>) | null }

async function feedPage(page: Page, signal?: AbortSignal): Promise<ArkivFeedPage> {
  const alerts = await withRetractions(entitiesOf(page).map(decodeAlert), signal)
  return {
    items: newestActive(alerts),
    // Cursor pages are not cached, but still pass the gate so a throttled node is left alone.
    next: page.hasNextPage() ? (sig) => abortable(gated(null, 0, () => page.next()), sig).then((p) => feedPage(p, sig)) : null,
  }
}

/**
 * The alert feed (Q3): Nazar's alerts since a month, narrowed by the feed filters, paged
 * with Arkiv's cursor. Null when Arkiv holds no Nazar data at all, so the caller falls
 * through to demo data; an empty page means the filters matched nothing.
 */
export async function arkivFeed(q: ArkivFeedQuery, signal?: AbortSignal): Promise<ArkivFeedPage | null> {
  const filters: Expression[] = [...mine('alert'), gte('alert_ym', i32(q.sinceYm))]
  if (q.minSeverity) filters.push(gte('sev', i32(q.minSeverity)))
  if (q.peds) filters.push(eq('peds', i32(1)))
  if (q.state) filters.push(eq('state', str(q.state)))
  if (q.source) filters.push(eq('src', str(q.source)))
  const name = `feed:${q.sinceYm}:${q.minSeverity ?? 0}:${q.peds ? 1 : 0}:${q.state ?? ''}:${q.source ?? ''}`
  const page = await alertQuery(name, filters, q.limit, TTL.list, signal)
  if (!page.entities.length && !(await arkivHasData(signal))) return null
  return feedPage(page, signal)
}

/** Last time the pipeline reported in, from its on-chain heartbeat (expires after 20 minutes). */
export async function arkivHeartbeat(signal?: AbortSignal): Promise<number | null> {
  const page = await abortable(
    gated('heartbeat', TTL.status, () => arkiv().select({ key: true, attributes: true }).where(mine('heartbeat')).createdBy(PUBLISHER).limit(10).fetch() as Promise<Page>),
    signal,
  )
  const times = entitiesOf(page)
    .map((e) => n(((e.attributes ?? {}) as Record<string, Attr>).last_ok))
    .filter((t): t is number => t !== null && Number.isFinite(t))
  return times.length ? Math.max(...times) : null
}
