import { apiLikelyDown, apiSearch, SEARCH_LIMIT } from './api'
import { demoActiveAlerts } from './demo'
import { newestFirst } from './map'
import { matchKey, stripBatchLabel, validateBatch } from './match'
import { currentSnapshot, loadSnapshot, snapshotAlerts, type SnapshotIndex } from './snapshot'
import type { Alert, SourceKind } from './types'

// Search by name for the Alerts page: people often know the brand ("Coldrif", "Dolo") or the
// maker ("Sresan"), not the batch. The Nazar API answers first (GET /v1/search, a full-text index
// of brand, product, maker and batch); when it cannot, Nazar's saved copy on the device answers
// with the same rule (every word must start a word in the brand, product, generic name, maker or
// batch), and only without one the built-in demo records. Whichever answered is reported.

export type SearchAnswer = {
  items: Alert[]
  source: SourceKind
  /** True when the source returned as many rows as asked for, so more may exist. */
  capped: boolean
}

/** Lowercase, accents folded: "Résumé" and "resume" meet. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Words of a text, as the search compares them. */
const words = (s: string | null | undefined) => (s ? fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean) : [])

/** The words a person typed, for matching and for highlighting. */
export function queryTerms(q: string): string[] {
  const out: string[] = []
  for (const w of words(q)) if (!out.includes(w)) out.push(w)
  return out.slice(0, 8)
}

/**
 * The batch number a query looks like, or null. A batch has a digit and no spaces once a typed
 * label ("B.No.") is removed: "SR-13" and "TG25-2281A" do, "Dolo 650" and "Coldrif" do not.
 */
export function batchLike(q: string): string | null {
  const raw = stripBatchLabel(q.trim())
  if (!raw || /\s/.test(raw) || !/\d/.test(raw) || matchKey(raw).length < 3) return null
  const v = validateBatch(raw)
  return v.ok ? v.batch : null
}

type Indexed = { alert: Alert; words: string[]; batchKey: string }

const indexes = new WeakMap<SnapshotIndex, Indexed[]>()

/** Every saved-copy alert with its searchable words, built once per snapshot. */
function indexOf(s: SnapshotIndex): Indexed[] {
  const hit = indexes.get(s)
  if (hit) return hit
  const byId = new Map(snapshotAlerts({}, s).map((a) => [a.id, a]))
  const out: Indexed[] = []
  for (const [key, rows] of Object.entries(s.file.alerts)) {
    rows.forEach((r, i) => {
      const alert = byId.get(`snap-${key}-${i}`)
      if (!alert) return
      // brand, product, generic, maker, batch (field order: Nazar-backend/src/api/snapshot.ts)
      out.push({ alert, words: [r[2], r[3], r[4], r[11], r[0] ?? key].flatMap(words), batchKey: key })
    })
  }
  out.sort((a, b) => newestFirst(a.alert, b.alert))
  indexes.set(s, out)
  return out
}

const demoIndex = (): Indexed[] =>
  demoActiveAlerts().map((a) => ({ alert: a, words: [a.brand, a.drug, a.manufacturer, a.batch].flatMap(words), batchKey: matchKey(a.batch) }))

/** Every typed word starts a word of the record, or the whole query is the start of its batch. */
function matches(x: Indexed, terms: string[], key: string) {
  if (key.length >= 2 && x.batchKey.startsWith(key)) return true
  return terms.every((t) => x.words.some((w) => w.startsWith(t)))
}

function searchLocal(list: Indexed[], q: string, limit: number) {
  const terms = queryTerms(q)
  const key = matchKey(q)
  if (!terms.length) return { items: [], capped: false }
  const hits: Alert[] = []
  for (const x of list) {
    if (!matches(x, terms, key)) continue
    hits.push(x.alert)
    if (hits.length > limit) break
  }
  return { items: hits.slice(0, limit), capped: hits.length > limit }
}

/** The saved copy if loaded, else one bounded attempt to load it. */
async function snapshotSoon(signal?: AbortSignal, ms = 6000): Promise<SnapshotIndex | null> {
  const have = currentSnapshot()
  if (have) return have
  const s = await Promise.race([loadSnapshot(), new Promise<null>((r) => setTimeout(() => r(null), ms))])
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  return s
}

const isAbort = (err: unknown, signal?: AbortSignal) => signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')

/**
 * Alerts that name `q`, newest first, without retractions (as in the feed). The API answers when
 * it can; otherwise the saved copy, otherwise demo data.
 */
export async function searchAlerts(q: string, signal?: AbortSignal, limit = SEARCH_LIMIT): Promise<SearchAnswer> {
  const text = q.replace(/\s+/g, ' ').trim().slice(0, 100)
  if (!text) return { items: [], source: 'snapshot', capped: false }
  if (!apiLikelyDown()) {
    try {
      const rows = await apiSearch(text, limit, { signal })
      return { items: rows.filter((a) => !a.retraction).sort(newestFirst), source: 'api', capped: rows.length >= limit }
    } catch (err) {
      if (isAbort(err, signal)) throw err
    }
  }
  const snap = await snapshotSoon(signal)
  if (snap) return { ...searchLocal(indexOf(snap), text, limit), source: 'snapshot' }
  return { ...searchLocal(demoIndex(), text, limit), source: 'demo' }
}
