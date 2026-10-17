import { apiAlerts, apiCheck, apiLikelyDown, apiPipelineStatus, type PipelineStatusResponse } from './api'
import { checkDemo, demoActiveAlerts } from './demo'
import { validateBatch } from './match'
import type { Alert, CheckResult, PipelineStatus, SourceKind } from './types'

export * from './types'
export { matchKey, confusionKey, BATCH_SHAPE } from './match'

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
  if (!probe || Date.now() - probe.at > 15_000) {
    probe = { at: Date.now(), p: apiPipelineStatus().catch(() => null) }
  }
  return probe.p
}

export async function checkBatch(
  input: string,
  opts: { signal?: AbortSignal; onStage?: (stage: Stage) => void } = {},
): Promise<CheckResult> {
  const { signal, onStage } = opts
  const v = validateBatch(input)
  // Shape is checked here, before any network call: a garbled batch never leaves the device.
  if (!v.ok) return { state: 'unreadable', batch: v.batch, asOf: new Date(), source: 'local' }

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

  return checkDemo(v.batch)
}

export type AlertFeed = { items: Alert[]; total: number; source: SourceKind }

/** Active alerts for the home page. */
export async function loadAlerts(q: { minSeverity?: number; peds?: boolean; limit?: number } = {}, signal?: AbortSignal): Promise<AlertFeed> {
  const limit = q.limit ?? 20
  try {
    if (!(await probeApi())) throw new Error('API unreachable')
    const r = await apiAlerts({ ...q, limit }, { signal })
    // Filter again on our side in case the server ignores a parameter.
    const items = r.items.filter((a) => !a.retraction && (!q.peds || a.peds) && (!q.minSeverity || a.severity >= q.minSeverity))
    const total = r.total !== null && items.length === r.items.length ? r.total : items.length
    return { items, total, source: 'api' }
  } catch (err) {
    if (isAbort(err, signal)) throw err
  }
  try {
    const items = await (await loadArkiv()).arkivAlerts({ ...q, limit }, signal)
    if (items) return { items, total: items.length, source: 'arkiv' }
  } catch (err) {
    if (isAbort(err, signal)) throw err
  }
  const items = demoActiveAlerts().filter((a) => (!q.peds || a.peds) && (!q.minSeverity || a.severity >= q.minSeverity))
  return { items, total: items.length, source: 'demo' }
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
    if (isAbort(err, signal)) throw err
  }
  return { kind: 'offline' }
}
