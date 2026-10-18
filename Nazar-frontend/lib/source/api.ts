import { API_URL } from './config'
import { fromDto, type AlertDTO } from './map'
import { orderAlerts } from './match'
import type { Alert, CheckResult } from './types'

// Typed client for the Nazar HTTP API. Every call has a timeout and honours an outer
// AbortSignal, and a failed connection pauses API calls briefly so a dead server does
// not add latency to every check.

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

const COOL_OFF_MS = 20_000
let downUntil = 0

/** True when no API is configured for this build, or it recently failed to connect. */
export const apiLikelyDown = () => !API_URL || Date.now() < downUntil

/** Combines an outer signal with a timeout, without relying on AbortSignal.any. */
function withTimeout(outer: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), ms)
  const onAbort = () => ctrl.abort(outer?.reason)
  if (outer?.aborted) ctrl.abort(outer.reason)
  else outer?.addEventListener('abort', onAbort, { once: true })
  return { signal: ctrl.signal, done: () => (clearTimeout(timer), outer?.removeEventListener('abort', onAbort)) }
}

type Opts = { signal?: AbortSignal; timeoutMs?: number }

async function getJson<T>(path: string, { signal, timeoutMs = 4000 }: Opts = {}): Promise<T> {
  if (!API_URL) throw new ApiError('No Nazar API configured for this build')
  const t = withTimeout(signal, timeoutMs)
  try {
    const res = await fetch(`${API_URL}${path}`, { signal: t.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new ApiError(`${path} returned ${res.status}`, res.status)
    downUntil = 0
    return (await res.json()) as T
  } catch (err) {
    // Only network-level failures cool the API off; an HTTP error means it is up.
    if (!(err instanceof ApiError) && !signal?.aborted) downUntil = Date.now() + COOL_OFF_MS
    throw err
  } finally {
    t.done()
  }
}

type CheckResponse = {
  state: CheckResult['state']
  batch: string
  asOf: string
  alerts: AlertDTO[]
  suggestion?: string
  source: 'ledger' | 'arkiv'
}

const STATES = new Set(['flagged', 'retracted', 'no_alert', 'unreadable'])

export async function apiCheck(batch: string, opts?: Opts): Promise<CheckResult> {
  const r = await getJson<CheckResponse>(`/v1/check?batch=${encodeURIComponent(batch)}`, opts)
  if (!r || !STATES.has(r.state) || !Array.isArray(r.alerts)) throw new ApiError('Unexpected /v1/check response')
  const asOf = r.asOf && !Number.isNaN(Date.parse(r.asOf)) ? new Date(r.asOf) : new Date()
  const alerts = orderAlerts(r.alerts.map(fromDto))
  const base = { batch: r.batch || batch, asOf, source: 'api' as const }
  if ((r.state === 'flagged' || r.state === 'retracted') && alerts[0]) {
    return { ...base, state: r.state, batch: alerts[0].batch, alert: alerts[0], alerts }
  }
  if (r.state === 'unreadable') return { ...base, state: 'unreadable', ...(r.suggestion ? { suggestion: r.suggestion } : {}) }
  // A flagged state with no alerts attached would be a server bug; never show it as a flag without evidence.
  if (r.state !== 'no_alert') throw new ApiError('Flagged response without alerts')
  return { ...base, state: 'no_alert' }
}

export type AlertQuery = {
  limit?: number
  offset?: number
  minSeverity?: number
  peds?: boolean
  sinceYm?: number
  /** Manufacturing state, ISO 3166-2:IN (IN-TN). */
  state?: string
  /** Pipeline source id. Older servers ignore it, so callers filter again. */
  source?: string
}

export async function apiAlerts(q: AlertQuery = {}, opts?: Opts): Promise<{ items: Alert[]; total: number | null }> {
  const params = new URLSearchParams()
  if (q.limit) params.set('limit', String(q.limit))
  if (q.offset) params.set('offset', String(q.offset))
  if (q.minSeverity) params.set('minSeverity', String(q.minSeverity))
  if (q.peds !== undefined) params.set('peds', q.peds ? '1' : '0')
  if (q.sinceYm) params.set('sinceYm', String(q.sinceYm))
  if (q.state) params.set('state', q.state)
  if (q.source) params.set('source', q.source)
  const r = await getJson<{ items: AlertDTO[]; total?: number }>(`/v1/alerts?${params}`, opts)
  if (!r || !Array.isArray(r.items)) throw new ApiError('Unexpected /v1/alerts response')
  return { items: r.items.map(fromDto), total: typeof r.total === 'number' ? r.total : null }
}

export type PipelineStatusResponse = {
  heartbeat: { lastOkMs: number; entityKey: string | null } | null
  runs?: unknown
  /** Per-source last successful check from the ledger, used when no on-chain heartbeat exists yet. */
  sources?: Record<string, { lastCheckedMs: number | null; ok: boolean }>
  stats?: unknown
  publisher: { address: string; balanceGlm: number | string } | null
  mode: string
}

export const apiPipelineStatus = (opts?: Opts) => getJson<PipelineStatusResponse>('/v1/pipeline/status', opts)

export type SourceInfo = {
  id: string
  authority: string
  jurisdiction: string
  homepage: string
  description: string
  schedule: string
  enabled: boolean
  disabledReason: string | null
  lastRun: { lastCheckedMs: number; ok: boolean; docs: number; alerts?: number; error?: string | null } | null
}

export async function apiSources(opts?: Opts): Promise<SourceInfo[]> {
  const r = await getJson<{ items: SourceInfo[] }>('/v1/sources', opts)
  if (!r || !Array.isArray(r.items)) throw new ApiError('Unexpected /v1/sources response')
  return r.items
    .filter((s) => s && typeof s.id === 'string' && typeof s.authority === 'string')
    .map((s) => ({
      ...s,
      enabled: s.enabled !== false,
      disabledReason: s.disabledReason ?? null,
      lastRun: s.lastRun && typeof s.lastRun.lastCheckedMs === 'number' ? s.lastRun : null,
    }))
}
