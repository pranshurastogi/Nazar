import { apiAlerts, apiCheck, apiLikelyDown, apiNoticeKeys, apiPipelineStatus, apiSources, type PipelineStatusResponse, type SourceInfo } from './api'
import { API_URL } from './config'
import type { ArkivFeedPage } from './arkiv'
import { checkDemo, demoActiveAlerts } from './demo'
import { STATIC_SOURCES } from './sources'
import { validateBatch } from './match'
import { currentSnapshot, loadSnapshot, snapshotAlerts, snapshotCheck, SNAPSHOT_MAX_AGE_MS, type SnapshotIndex } from './snapshot'
import { newestFirst, productClassOf } from './map'
import type { Alert, CheckResult, PipelineStatus, ProductClass, SourceKind } from './types'

export * from './types'
export { matchKey, confusionKey, BATCH_SHAPE, validateBatch } from './match'
export { formatYm, isMedicine, newestFirst, productClassOf } from './map'
export { API_URL } from './config'
export { STATE_NAME, SOURCE_NAME, stateName } from './labels'
export { PROJECT, PUBLISHER, EXPLORER_URL, explorerAddress } from './config'
export type { SourceInfo } from './api'
export { currentSnapshot, loadSnapshot, onSnapshot, scheduleSnapshot } from './snapshot'

// One entry point per question. Each tries the Nazar API, then Arkiv directly, then the
// built-in demo data, and reports which one answered. Arkiv code is loaded on demand so
// the first paint does not pay for the chain client.

const loadArkiv = () => import('./arkiv')

const isAbort = (err: unknown, signal?: AbortSignal) =>
  signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')

export type Stage = Exclude<SourceKind, 'demo'>

/**
 * One shared reachability probe (the status endpoint), so a page load against a dead API
 * makes a single failed request instead of one per widget.
 */
let probe: { at: number; p: Promise<PipelineStatusResponse | null> } | null = null
function probeApi() {
  if (!API_URL) return Promise.resolve(null)
  if (!probe || Date.now() - probe.at > 15_000) {
    probe = { at: Date.now(), p: apiPipelineStatus().catch(() => null) }
  }
  return probe.p
}

/** A snapshot "no alert" leads a live check only while this fresh; an alert found in it always does. */
const INSTANT_NO_ALERT_MS = 24 * 60 * 60 * 1000

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/**
 * Checks a batch. When the on-device snapshot is loaded it answers first through `onInstant`
 * (synchronously, before any network call), then the live API / Arkiv answer is returned so the
 * caller can confirm or correct the card. Offline, or when every live source fails, the snapshot
 * answer is returned instead of demo data.
 */
export async function checkBatch(
  input: string,
  opts: { signal?: AbortSignal; onStage?: (stage: Stage) => void; onInstant?: (result: CheckResult) => void } = {},
): Promise<CheckResult> {
  const { signal, onStage, onInstant } = opts
  const v = validateBatch(input)
  // Shape is checked here, before any network call: a garbled batch never leaves the device.
  if (!v.ok) return { state: 'unreadable', batch: v.batch, asOf: new Date(), source: 'local' }

  const snap = currentSnapshot()
  const instant = snapshotCheck(v.batch, snap)
  if (instant && snap) {
    const age = Date.now() - snap.generatedAt.getTime()
    if (isOffline()) return asFinal(instant)
    const leads = age < SNAPSHOT_MAX_AGE_MS && (instant.state !== 'no_alert' || age < INSTANT_NO_ALERT_MS)
    if (leads) onInstant?.(instant)
  }

  if (!apiLikelyDown()) {
    onStage?.('api')
    try {
      return await apiCheck(v.batch, { signal })
    } catch (err) {
      if (isAbort(err, signal)) throw err
    }
  }

  onStage?.('arkiv')
  try {
    const r = await (await loadArkiv()).arkivCheck(v.batch, signal)
    if (r) return r
  } catch (err) {
    if (isAbort(err, signal)) throw err
  }

  if (instant) return asFinal(instant)
  // Both live sources failed and no saved copy is loaded yet: read Nazar's static copy (served by
  // this site) before falling back to demo data.
  onStage?.('snapshot')
  const late = snapshotCheck(v.batch, await snapshotSoon(signal))
  return late ? asFinal(late) : checkDemo(v.batch)
}

/** Marks a saved-copy answer as final, so the proof stops saying it is confirming on Arkiv. */
function asFinal(r: CheckResult): CheckResult {
  if (r.state !== 'flagged' && r.state !== 'retracted') return r
  return { ...r, alert: { ...r.alert, savedCopyFinal: true }, alerts: r.alerts.map((a) => ({ ...a, savedCopyFinal: true })) }
}

/** The loaded snapshot, else one load attempt (API copy, then the site's static copy), bounded in time. */
async function snapshotSoon(signal?: AbortSignal, ms = 6000): Promise<SnapshotIndex | null> {
  const have = currentSnapshot()
  if (have) return have
  const s = await Promise.race([loadSnapshot(), new Promise<null>((r) => setTimeout(() => r(null), ms))])
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  return s
}

export type AlertFeed = { items: Alert[]; total: number; source: SourceKind }

/** Home-page list filters. `productClass: 'medicine'` leaves out cosmetics and hygiene products. */
export type AlertListQuery = { minSeverity?: number; peds?: boolean; limit?: number; productClass?: ProductClass }

/**
 * Active alerts for the home page, newest first in the API's order (newestFirst) whichever source
 * answered: the Nazar API, else Arkiv, else Nazar's saved copy, else demo data.
 */
export async function loadAlerts(q: AlertListQuery = {}, signal?: AbortSignal): Promise<AlertFeed> {
  const limit = q.limit ?? 20
  const keep = (a: Alert) =>
    !a.retraction && (!q.peds || a.peds) && (!q.minSeverity || a.severity >= q.minSeverity) && (!q.productClass || productClassOf(a) === q.productClass)
  try {
    if (!(await probeApi())) throw new Error('API unreachable')
    const r = await apiAlerts({ ...q, limit }, { signal })
    // Filter again on our side in case the server ignores a parameter (older servers have no productClass).
    const items = r.items.filter(keep)
    const total = r.total !== null && items.length === r.items.length ? r.total : items.length
    return { items: items.sort(newestFirst), total, source: 'api' }
  } catch (err) {
    if (isAbort(err, signal)) throw err
  }
  try {
    const items = await (await loadArkiv()).arkivAlerts({ minSeverity: q.minSeverity, peds: q.peds, limit }, signal)
    if (items) {
      const kept = items.filter(keep).sort(newestFirst)
      return { items: kept, total: kept.length, source: 'arkiv' }
    }
  } catch (err) {
    if (isAbort(err, signal)) throw err
  }
  const snap = await snapshotSoon(signal)
  if (snap) {
    const all = snapshotAlerts({ minSeverity: q.minSeverity, peds: q.peds }, snap).filter(keep)
    return { items: all.slice(0, limit), total: all.length, source: 'snapshot' }
  }
  const items = demoActiveAlerts().filter(keep).sort(newestFirst)
  return { items, total: items.length, source: 'demo' }
}

export type FeedFilters = { minSeverity?: number; peds?: boolean; state?: string; source?: string }

/** One page of the alert feed. `more` fetches the next page from the same source, or is null at the end. */
export type FeedPage = {
  items: Alert[]
  /** Matching alerts in total, when the source can tell. */
  total: number | null
  source: SourceKind
  more: ((signal?: AbortSignal) => Promise<FeedPage>) | null
}

export const FEED_PAGE_SIZE = 20
/** Arkiv has no ordering, so the feed reads a bounded recent window instead of all history. */
const ARKIV_FEED_MONTHS = 24

const feedMatch = (a: Alert, f: FeedFilters) =>
  !a.retraction &&
  (!f.peds || a.peds) &&
  (!f.minSeverity || a.severity >= f.minSeverity) &&
  (!f.state || a.state === f.state) &&
  (!f.source || a.sourceId === f.source)

/**
 * Reads API pages from `offset`. Filters are applied again here in case the server ignores
 * one (older servers have no source filter); a filtered page can come back sparse, so up to
 * five pages are read per call, and the total is no longer known.
 */
async function apiFeedPage(f: FeedFilters, offset: number, exact: boolean, signal?: AbortSignal): Promise<FeedPage> {
  const items: Alert[] = []
  let off = offset
  let total: number | null = null
  let more = true
  // One read when the server applied every filter; otherwise keep reading until a page's worth matched.
  for (let i = 0; i < 5 && more && (i === 0 || (!exact && items.length < FEED_PAGE_SIZE)); i++) {
    const r = await apiAlerts({ ...f, limit: FEED_PAGE_SIZE, offset: off }, { signal })
    const kept = r.items.filter((a) => feedMatch(a, f))
    if (kept.length !== r.items.length) exact = false
    items.push(...kept)
    off += r.items.length
    total = r.total
    more = r.items.length === FEED_PAGE_SIZE && (total === null || off < total)
  }
  return {
    items,
    total: exact ? total : null,
    source: 'api',
    more: more ? (sig) => apiFeedPage(f, off, exact, sig) : null,
  }
}

const ymMonthsAgo = (months: number, d = new Date()) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1))
  return t.getUTCFullYear() * 100 + t.getUTCMonth() + 1
}

const fromArkivPage = (p: ArkivFeedPage): FeedPage => {
  const next = p.next
  return { items: p.items, total: null, source: 'arkiv', more: next ? async (sig) => fromArkivPage(await next(sig)) : null }
}

/** Pages through a snapshot list locally, a feed page at a time. */
const snapshotFeedPage = (all: Alert[], from: number): FeedPage => {
  const end = from + FEED_PAGE_SIZE
  return { items: all.slice(from, end), total: all.length, source: 'snapshot', more: end < all.length ? async () => snapshotFeedPage(all, end) : null }
}

/** The alert feed, newest first: Nazar API, else Arkiv (Q3), else Nazar's saved copy, else demo data. */
export async function loadFeed(f: FeedFilters = {}, signal?: AbortSignal): Promise<FeedPage> {
  try {
    if (!(await probeApi())) throw new Error('API unreachable')
    return await apiFeedPage(f, 0, true, signal)
  } catch (err) {
    if (isAbort(err, signal)) throw err
  }
  try {
    const page = await (await loadArkiv()).arkivFeed({ ...f, sinceYm: ymMonthsAgo(ARKIV_FEED_MONTHS), limit: FEED_PAGE_SIZE }, signal)
    if (page) return fromArkivPage(page)
  } catch (err) {
    if (isAbort(err, signal)) throw err
  }
  const snap = await snapshotSoon(signal)
  if (snap) return snapshotFeedPage(snapshotAlerts(f, snap), 0)
  const items = demoActiveAlerts()
    .filter((a) => feedMatch(a, f))
    .sort((a, b) => b.noticeOrder - a.noticeOrder)
  return { items, total: items.length, source: 'demo', more: null }
}

/** Pipeline liveness: the API's view of the heartbeat, else the heartbeat entity on Arkiv. */
export async function loadPipelineStatus(signal?: AbortSignal): Promise<PipelineStatus> {
  const r = await probeApi()
  if (signal?.aborted) throw signal.reason
  if (r) {
    // Prefer the on-chain heartbeat; before the first publish, fall back to the ledger's latest good source check.
    const ledgerMs = Math.max(0, ...Object.values(r.sources ?? {}).filter((s) => s.ok && s.lastCheckedMs).map((s) => s.lastCheckedMs as number))
    return { kind: 'api', lastOkMs: r.heartbeat?.lastOkMs ?? (ledgerMs || null) }
  }
  try {
    const arkiv = await loadArkiv()
    const lastOkMs = await arkiv.arkivHeartbeat(signal)
    if (lastOkMs) return { kind: 'arkiv', lastOkMs }
    // No heartbeat (pipeline paused), but checks can still be answered from published alerts.
    if (await arkiv.arkivHasData(signal)) return { kind: 'arkiv', lastOkMs: null }
  } catch (err) {
    // While Arkiv reads are paused after a 429, the caller keeps showing what it last knew.
    if (isAbort(err, signal) || (err instanceof Error && err.name === 'ArkivBackoffError')) throw err
  }
  return { kind: 'offline' }
}

export type SourceList = { items: SourceInfo[]; source: 'api' | 'static' }

/** The regulator sources the pipeline reads: live from the API (with last runs), else the built-in list. */
export async function loadSources(signal?: AbortSignal): Promise<SourceList> {
  try {
    if (!(await probeApi())) throw new Error('API unreachable')
    const items = await apiSources({ signal })
    if (items.length) return { items, source: 'api' }
  } catch (err) {
    if (isAbort(err, signal)) throw err
  }
  return { items: STATIC_SOURCES, source: 'static' }
}

/**
 * Estimated date an Arkiv entity expires, from its expiry block. Null when Arkiv cannot
 * say (paused after a 429, offline); the proof then shows the block number alone.
 */
export async function estimateExpiry(expiresAtBlock: string, signal?: AbortSignal): Promise<Date | null> {
  try {
    const t = await (await loadArkiv()).arkivBlockTiming(signal)
    const blocks = Number(BigInt(expiresAtBlock) - t.currentBlock)
    const ms = (t.currentBlockTime + blocks * (t.blockDuration || 2)) * 1000
    return Number.isFinite(ms) ? new Date(ms) : null
  } catch {
    return null
  }
}

/**
 * Notice keys from the API, fetched once per session and shared by every check. The list is
 * re-read only when a SHA is missing and the copy is older than NOTICE_KEYS_TTL_MS; a failed read
 * is remembered for NOTICE_KEYS_RETRY_MS, so a run of checks never repeats GET /v1/notices.
 */
let noticeKeys: { at: number; p: Promise<Map<string, string>> } | null = null
const NOTICE_KEYS_TTL_MS = 10 * 60 * 1000
const NOTICE_KEYS_RETRY_MS = 60 * 1000

function loadNoticeKeys() {
  const entry = {
    at: Date.now(),
    p: apiNoticeKeys().catch(() => {
      // Try again a minute from now, not on the very next check.
      entry.at = Date.now() - NOTICE_KEYS_TTL_MS + NOTICE_KEYS_RETRY_MS
      return new Map<string, string>()
    }),
  }
  noticeKeys = entry
  return entry
}

/**
 * The Arkiv entity key of the notice with this SHA-256, when the Nazar API knows it. Used by
 * the on-chain proof when an alert names its notice by SHA only. Null when unknown or offline.
 */
export async function noticeKeyFor(sha: string): Promise<string | null> {
  if (!API_URL || apiLikelyDown() || !sha) return null
  const key = sha.toLowerCase()
  const entry = noticeKeys ?? loadNoticeKeys()
  let map = await entry.p
  if (!map.has(key)) {
    // Another check may have started a newer read meanwhile; share it rather than start a third.
    if (noticeKeys && noticeKeys !== entry) map = await noticeKeys.p
    else if (Date.now() - entry.at > NOTICE_KEYS_TTL_MS) map = await loadNoticeKeys().p
  }
  return map.get(key) ?? null
}
