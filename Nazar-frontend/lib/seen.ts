import { matchKey, type Alert } from '@/lib/source'
import type { SnapshotIndex, SnapshotListFilter } from '@/lib/source/snapshot'

// "New since your last visit", kept only in this browser (localStorage). Nothing here is sent
// anywhere. An alert is known by its batch and its month ("sr13|202510"); for a row the regulator
// gave no date, that month is when Nazar first saw it, so undated rows count by first-seen too.
//
// The stored state is the newest month seen plus the keys seen in the last few months. Rows older
// than that window are never called new: a late-published old notice is not news, and it keeps
// the stored list small. The first time anything is recorded, everything present becomes the
// baseline, so a first visit marks nothing as new.
//
// A visit's baseline is frozen in sessionStorage the first time the Alerts page opens in a tab,
// so its "New" pills stay put while the person moves around (and reloads) until "Mark all seen",
// while the stored state already counts them as seen for the next visit and the nav badge.

export const SEEN_KEY = 'nazar:seen'
const VISIT_KEY = 'nazar:seen-visit'
export const SEEN_EVENT = 'nazar:seen-change'
/** Months before the newest one in which unseen rows still count as new. */
const WINDOW_MONTHS = 2

export type SeenState = {
  v: 1
  /** Newest alert month (YYYYMM) seen. */
  ym: number
  /** "batchkey|YYYYMM" of every alert seen in the window. */
  keys: string[]
  /** When this device started remembering; a visit baseline from another lifetime is ignored. */
  created: number
  at: number
}

/** [key, month] of one alert. */
export type SeenEntry = [string, number]

export const alertKey = (batch: string, ym: number | null | undefined) => `${matchKey(batch)}|${ym ?? 0}`

const keyYm = (key: string) => Number(key.slice(key.lastIndexOf('|') + 1)) || 0

/** 202601 minus 2 months is 202511. */
function addMonths(ym: number, n: number) {
  const m = Math.floor(ym / 100) * 12 + (ym % 100) - 1 + n
  return Math.floor(m / 12) * 100 + (m % 12) + 1
}

const floorOf = (s: SeenState) => (s.ym ? addMonths(s.ym, -WINDOW_MONTHS) : 0)

function valid(x: unknown): x is SeenState {
  const s = x as SeenState
  return !!s && s.v === 1 && typeof s.ym === 'number' && Array.isArray(s.keys) && typeof s.created === 'number'
}

function parse(raw: string | null): SeenState | null {
  if (!raw) return null
  try {
    const s: unknown = JSON.parse(raw)
    return valid(s) ? s : null
  } catch {
    return null
  }
}

export function readSeen(): SeenState | null {
  try {
    return parse(localStorage.getItem(SEEN_KEY))
  } catch {
    return null
  }
}

const sets = new WeakMap<SeenState, Set<string>>()
const setOf = (s: SeenState) => {
  let hit = sets.get(s)
  if (!hit) sets.set(s, (hit = new Set(s.keys)))
  return hit
}

/** True when this alert is newer than the baseline: unseen, and inside the recent window. */
export function isNew(base: SeenState | null | undefined, [key, ym]: SeenEntry): boolean {
  if (!base) return false
  if (ym < floorOf(base)) return false
  return !setOf(base).has(key)
}

/** Adds alerts to the stored state (creating it the first time) and tells the nav badge. */
export function markSeen(entries: SeenEntry[]): SeenState | null {
  if (typeof window === 'undefined') return null
  const prev = readSeen()
  let ym = prev?.ym ?? 0
  for (const [, m] of entries) if (m > ym) ym = m
  const next: SeenState = { v: 1, ym, keys: [], created: prev?.created ?? Date.now(), at: Date.now() }
  const floor = floorOf(next)
  const keys = new Set<string>()
  for (const k of prev?.keys ?? []) if (keyYm(k) >= floor) keys.add(k)
  let added = !prev
  for (const [k, m] of entries) {
    if (m < floor || keys.has(k)) continue
    keys.add(k)
    added = true
  }
  if (!added && prev && prev.ym === ym) return prev
  next.keys = [...keys]
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next))
  } catch {}
  window.dispatchEvent(new Event(SEEN_EVENT))
  return next
}

/** Every active alert in a snapshot as [key, month], optionally narrowed like the feed's filters. */
export function snapshotEntries(s: SnapshotIndex, f: SnapshotListFilter = {}): SeenEntry[] {
  const out: SeenEntry[] = []
  for (const [key, rows] of Object.entries(s.file.alerts)) {
    for (const r of rows) {
      if (r[19] === 1) continue
      if (f.minSeverity && r[9] < f.minSeverity) continue
      if (f.peds && r[10] !== 1) continue
      if (f.state && r[13] !== f.state) continue
      if (f.source && (s.file.notices[r[1]]?.[4] ?? '') !== f.source) continue
      out.push([alertKey(r[0] ?? key, r[16]), r[16]])
    }
  }
  return out
}

/** Live alerts as [key, month]; demo records are never remembered. */
export const alertEntries = (alerts: Alert[]): SeenEntry[] =>
  alerts.filter((a) => !a.demo && !a.retraction).map((a) => [alertKey(a.batch, a.alertYm), a.alertYm ?? 0])

/** Distinct unseen alerts in a snapshot, for the nav badge. Sets the baseline when there is none. */
export function unseenCount(s: SnapshotIndex): number {
  const entries = snapshotEntries(s)
  const seen = readSeen()
  if (!seen) {
    markSeen(entries)
    return 0
  }
  const fresh = new Set<string>()
  for (const e of entries) if (isNew(seen, e)) fresh.add(e[0])
  return fresh.size
}

/**
 * The baseline this tab's visit compares against: frozen the first time the Alerts page opens in
 * the tab, or null on the very first visit (nothing is new then).
 */
export function visitBaseline(): SeenState | null {
  const stored = readSeen()
  try {
    if (!stored) {
      sessionStorage.removeItem(VISIT_KEY)
      return null
    }
    const frozen = parse(sessionStorage.getItem(VISIT_KEY))
    if (frozen && frozen.created === stored.created) return frozen
    sessionStorage.setItem(VISIT_KEY, JSON.stringify(stored))
  } catch {}
  return stored
}

/** "Mark all seen": this visit's baseline becomes everything recorded so far. */
export function endVisit(entries: SeenEntry[] = []): SeenState | null {
  const s = markSeen(entries) ?? readSeen()
  try {
    if (s) sessionStorage.setItem(VISIT_KEY, JSON.stringify(s))
  } catch {}
  return s
}
