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
    // Only real connection failures and timeouts cool the API off. An HTTP error means it is up,
    // and a cancelled request (a superseded check, an aborted prefetch) says nothing about it.
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError'
    if ((err instanceof TypeError || timedOut) && !signal?.aborted) downUntil = Date.now() + COOL_OFF_MS
    throw err
  } finally {
    t.done()
  }
}

export type CheckResponse = {
  state: CheckResult['state']
  batch: string
  asOf: string
  alerts: AlertDTO[]
  suggestion?: string
  source: 'ledger' | 'arkiv'
}

const STATES = new Set(['flagged', 'retracted', 'no_alert', 'unreadable'])

export async function apiCheck(batch: string, opts?: Opts): Promise<CheckResult> {
  return parseCheck(await getJson<CheckResponse>(`/v1/check?batch=${encodeURIComponent(batch)}`, opts), batch)
}

/** Maps a /v1/check body onto a result; also used by the server-rendered share page. Throws on a malformed body. */
export function parseCheck(r: CheckResponse | null | undefined, batch: string): CheckResult {
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
  /** 'medicine' leaves out cosmetics and hygiene products. Older servers ignore it, so callers filter again. */
  productClass?: 'medicine' | 'cosmetic' | 'hygiene'
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
  if (q.productClass) params.set('productClass', q.productClass)
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

// ---- About this medicine (opt-in; general AI-written reference text, never regulator data)

/**
 * Notice entity keys by the notice's SHA-256, from GET /v1/notices. The alert DTO names its
 * notice by SHA only, so the proof looks the Arkiv notice entity up here.
 */
export async function apiNoticeKeys(opts?: Opts): Promise<Map<string, string>> {
  const r = await getJson<{ items?: { sha?: unknown; entityKey?: unknown }[] }>('/v1/notices?limit=200', { timeoutMs: 8000, ...opts })
  const out = new Map<string, string>()
  for (const n of Array.isArray(r?.items) ? r.items : []) {
    if (typeof n?.sha === 'string' && typeof n.entityKey === 'string' && /^0x[0-9a-fA-F]{64}$/.test(n.entityKey)) out.set(n.sha.toLowerCase(), n.entityKey)
  }
  return out
}

export type MedicineQuery = { product?: string; brand?: string; composition?: string[]; form?: string; manufacturer?: string; batch?: string }

export type MedicineInfo = {
  name: string
  genericNames: string[]
  drugClass: string
  whatItIsFor: string[]
  howItWorks: string
  commonSideEffects: string[]
  seriousWarnings: string[]
  whoShouldBeCareful: string[]
  interactions: string[]
  storage: string
  prescriptionStatus: string
  lookAlikeNames: string[]
  confidence: 'high' | 'medium' | 'low'
  notMedicalAdvice: true
}

export type MedicineExplain = {
  medicine: MedicineInfo
  disclaimer: string
  aiGenerated: true
  /** Alerts for this brand (same as brandAlerts; older servers send only this, blended with ingredient matches). */
  nazarAlerts: number
  /** The brand the count is for, or null for an unbranded/generic product. */
  brandName: string | null
  brandAlerts: number
  ingredientName: string | null
  /** Alerts for OTHER products sharing an ingredient: context only, never about this pack. */
  ingredientAlerts: number
  nazarQuery: string | null
  batchAlerts: number
  cached: boolean
  model: string
  generatedAt: string
}

export type MedicineAnswer =
  | { ok: true; data: MedicineExplain }
  | { ok: false; kind: 'disabled' | 'limited' | 'error'; message: string; retryAfterSec?: number }

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Asks the API to explain a medicine. Never throws: every failure becomes a state the card can show. */
export async function apiExplainMedicine(q: MedicineQuery, { signal, timeoutMs = 25_000 }: Opts = {}): Promise<MedicineAnswer> {
  if (!API_URL) return { ok: false, kind: 'disabled', message: 'Medicine information is not available in this version.' }
  const t = withTimeout(signal, timeoutMs)
  try {
    const res = await fetch(`${API_URL}/v1/medicine/explain`, {
      method: 'POST',
      signal: t.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(q),
    })
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; retryAfterSec?: number } } & Partial<MedicineExplain> | null
    if (res.status === 503 && body?.error?.code === 'LLM_DISABLED') return { ok: false, kind: 'disabled', message: 'Medicine information is not available right now.' }
    if (res.status === 429) {
      const retry = Number(res.headers.get('Retry-After') ?? body?.error?.retryAfterSec ?? 0) || undefined
      return { ok: false, kind: 'limited', message: body?.error?.message || 'Too many questions right now. Please try again later.', retryAfterSec: retry }
    }
    const m = body?.medicine
    if (!res.ok || !m || typeof m.name !== 'string') return { ok: false, kind: 'error', message: 'Could not get medicine information right now. Please try again.' }
    const medicine: MedicineInfo = {
      name: m.name,
      genericNames: strings(m.genericNames),
      drugClass: typeof m.drugClass === 'string' ? m.drugClass : 'unknown',
      whatItIsFor: strings(m.whatItIsFor),
      howItWorks: typeof m.howItWorks === 'string' ? m.howItWorks : '',
      commonSideEffects: strings(m.commonSideEffects),
      seriousWarnings: strings(m.seriousWarnings),
      whoShouldBeCareful: strings(m.whoShouldBeCareful),
      interactions: strings(m.interactions),
      storage: typeof m.storage === 'string' ? m.storage : '',
      prescriptionStatus: typeof m.prescriptionStatus === 'string' ? m.prescriptionStatus : 'unknown',
      lookAlikeNames: strings(m.lookAlikeNames),
      confidence: m.confidence === 'high' || m.confidence === 'medium' ? m.confidence : 'low',
      notMedicalAdvice: true,
    }
    return {
      ok: true,
      data: {
        medicine,
        disclaimer: typeof body.disclaimer === 'string' ? body.disclaimer : 'General information, not medical advice. Ask your doctor or pharmacist.',
        aiGenerated: true,
        nazarAlerts: typeof body.nazarAlerts === 'number' ? body.nazarAlerts : 0,
        // An older server blends brand and ingredient matches into nazarAlerts; without a
        // brandName that number cannot be attributed to this pack, so it is not shown.
        brandName: typeof body.brandName === 'string' && body.brandName ? body.brandName : null,
        brandAlerts: typeof body.brandAlerts === 'number' ? body.brandAlerts : 0,
        ingredientName: typeof body.ingredientName === 'string' && body.ingredientName ? body.ingredientName : null,
        ingredientAlerts: typeof body.ingredientAlerts === 'number' ? body.ingredientAlerts : 0,
        nazarQuery: typeof body.nazarQuery === 'string' ? body.nazarQuery : null,
        batchAlerts: typeof body.batchAlerts === 'number' ? body.batchAlerts : 0,
        cached: !!body.cached,
        model: typeof body.model === 'string' ? body.model : '',
        generatedAt: typeof body.generatedAt === 'string' ? body.generatedAt : new Date().toISOString(),
      },
    }
  } catch {
    if (signal?.aborted) return { ok: false, kind: 'error', message: 'Cancelled.' }
    return { ok: false, kind: 'error', message: 'Could not reach Nazar. Check your connection and try again.' }
  } finally {
    t.done()
  }
}
