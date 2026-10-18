import { apiLikelyDown } from './api'
import { API_URL } from './config'
import { fromDto, type AlertDTO } from './map'
import { confusionKey, matchKey, resolveResult } from './match'
import { idbGet, idbSet } from './store'
import type { Alert, CheckResult } from './types'

// The whole publishable alert set, kept on the device so a check answers instantly (and
// offline) before the live API confirms it. Format and field order are defined by
// Nazar-backend/src/api/snapshot.ts; the matching rules are the same ones the API uses:
// exact matchKey → flagged / retracted, a confusionKey look-alike → "did you mean", never a flag.

type Row = [
  string | null, number, string, string | null, string | null,
  string, string, string, string, number, 0 | 1, string | null,
  0 | 1, string | null, number | null, number | null, number, 0 | 1,
  0 | 1, 0 | 1,
]

export type SnapshotFile = {
  v: 1
  version: string
  generatedAt: string
  count: number
  notices: [string, string, string, string | null, string][]
  alerts: Record<string, Row[]>
}

export type SnapshotIndex = {
  version: string
  generatedAt: Date
  count: number
  file: SnapshotFile
  /** confusionKey → [matchKey, newest alert month] of every batch that folds to it. */
  lookAlikes: Map<string, [string, number][]>
}

const IDB_KEY = 'snapshot:v1'
/** A snapshot older than this still answers offline, but no longer leads a live check. */
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

let index: SnapshotIndex | null = null
let loading: Promise<SnapshotIndex | null> | null = null
const listeners = new Set<(s: SnapshotIndex) => void>()

function valid(f: unknown): f is SnapshotFile {
  const s = f as SnapshotFile
  return !!s && s.v === 1 && typeof s.version === 'string' && Array.isArray(s.notices) && !!s.alerts && typeof s.alerts === 'object'
}

function build(file: SnapshotFile): SnapshotIndex {
  const lookAlikes = new Map<string, [string, number][]>()
  for (const [key, rows] of Object.entries(file.alerts)) {
    const ck = confusionKey(key)
    const newest = Math.max(...rows.map((r) => r[16]))
    const list = lookAlikes.get(ck)
    if (list) list.push([key, newest])
    else lookAlikes.set(ck, [[key, newest]])
  }
  const at = Date.parse(file.generatedAt)
  return { version: file.version, generatedAt: new Date(Number.isNaN(at) ? 0 : at), count: file.count, file, lookAlikes }
}

function adopt(file: SnapshotFile) {
  if (index?.version === file.version) return index
  index = build(file)
  for (const l of listeners) l(index)
  return index
}

function toDto(key: string, r: Row, i: number, notices: SnapshotFile['notices']): AlertDTO {
  const n = notices[r[1]] ?? ['', '', '', null, 'unknown']
  const product = r[3] ?? r[2]
  return {
    rid: `snap-${key}-${i}`,
    batch: r[0] ?? key.toUpperCase(),
    batchKey: key,
    brand: r[2],
    product,
    generic: r[4] ?? product,
    form: r[5],
    category: r[6],
    failures: [r[7]],
    reason: r[8],
    severity: r[9],
    peds: r[10] === 1,
    manufacturer: r[11],
    manufacturerRole: r[12] ? 'label_claim' : 'maker',
    state: r[13],
    mfgYm: r[14],
    expYm: r[15],
    alertYm: r[16],
    tier: r[17] ? 'machine_read' : 'auto',
    authority: n[0],
    noticeTitle: n[1],
    noticeUrl: n[2],
    noticeDate: n[3],
    sourceId: n[4],
    entityKey: null,
    retracted: r[19] === 1,
  }
}

/** The loaded snapshot, if any (synchronous, so a check can answer before any await). */
export const currentSnapshot = () => index

export function onSnapshot(fn: (s: SnapshotIndex) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/**
 * Answers a validated batch from the snapshot alone, or null when there is none. The
 * result's asOf is when the snapshot was built, not now.
 */
export function snapshotCheck(batch: string, s = index): CheckResult | null {
  if (!s) return null
  const key = matchKey(batch)
  const rows = s.file.alerts[key]
  const exact: Alert[] = rows ? rows.map((r, i) => fromDto(toDto(key, r, i, s.file.notices))) : []
  let lookAlike: string | undefined
  if (!exact.length) {
    const best = (s.lookAlikes.get(confusionKey(batch)) ?? []).filter(([k]) => k !== key).sort((a, b) => b[1] - a[1])[0]
    const row = best && s.file.alerts[best[0]]?.[0]
    if (best && row) lookAlike = row[0] ?? best[0].toUpperCase()
  }
  return { ...resolveResult(batch, exact, lookAlike, 'snapshot'), asOf: s.generatedAt }
}

/**
 * Loads the snapshot: the saved copy from IndexedDB first (instant, offline), then the
 * network copy when it is newer. The HTTP cache and ETag make the refresh a 304 most of the time.
 */
export function loadSnapshot(): Promise<SnapshotIndex | null> {
  if (loading) return loading
  loading = (async () => {
    const saved = await idbGet<SnapshotFile>(IDB_KEY)
    if (valid(saved)) adopt(saved)
    // Offline, or the API just failed to connect (shared cool-off): the saved copy answers.
    if (!API_URL || apiLikelyDown() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return index
    try {
      const res = await fetch(`${API_URL}/v1/snapshot`, { headers: { Accept: 'application/json' } })
      if (res.ok) {
        const file: unknown = await res.json()
        if (valid(file) && file.version !== index?.version) {
          adopt(file)
          void idbSet(IDB_KEY, file)
        }
      }
    } catch {
      // Offline or the API is down: the saved copy (if any) keeps answering.
    }
    return index
  })().finally(() => {
    // Allow a later refresh (e.g. when the tab regains focus) to fetch again.
    setTimeout(() => (loading = null), 60_000)
  })
  return loading
}

/** Starts loading once the page is idle, so the first paint never waits for it. */
export function scheduleSnapshot() {
  if (typeof window === 'undefined') return
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(() => void loadSnapshot(), { timeout: 2500 })
  else setTimeout(() => void loadSnapshot(), 1200)
}
