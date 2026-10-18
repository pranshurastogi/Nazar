// A tiny stale-while-revalidate cache shared by the tabs. A page shows the last answer it
// had at once (memory, then sessionStorage, so back/forward and reloads paint instantly),
// then refreshes in the background. Concurrent loads of one key share a single request.

export type Cached<T> = { value: T; at: number }

const PREFIX = 'nazar:swr:'
const mem = new Map<string, Cached<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

/** The last value for a key, from memory or this tab's sessionStorage. */
export function peek<T>(key: string): Cached<T> | undefined {
  const hit = mem.get(key) as Cached<T> | undefined
  if (hit) return hit
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (!raw) return undefined
    const saved = JSON.parse(raw) as Cached<T>
    if (saved && typeof saved.at === 'number') {
      mem.set(key, saved)
      return saved
    }
  } catch {}
  return undefined
}

/** Only what JSON can carry is persisted; functions (e.g. a feed page's `more`) stay in memory. */
export function put<T>(key: string, value: T, persist = true) {
  const entry = { value, at: Date.now() }
  mem.set(key, entry)
  if (!persist) return
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(entry))
  } catch {}
}

/**
 * Loads a key, sharing one in-flight request between callers. The loader gets no caller
 * signal on purpose: one caller navigating away must not cancel the request for the others.
 */
export function revalidate<T>(key: string, load: () => Promise<T>, o: { persist?: boolean; keep?: (v: T) => boolean } = {}): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running
  const p = load()
    .then((v) => {
      if (!o.keep || o.keep(v)) put(key, v, o.persist ?? true)
      return v
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** Starts a background refresh unless the cached value is younger than `freshMs`. */
export function prefetch<T>(key: string, load: () => Promise<T>, o: { freshMs?: number; persist?: boolean; keep?: (v: T) => boolean } = {}) {
  const hit = peek<T>(key)
  if (hit && Date.now() - hit.at < (o.freshMs ?? 15_000)) return
  void revalidate(key, load, o).catch(() => {})
}
