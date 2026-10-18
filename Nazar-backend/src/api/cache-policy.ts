import type { MiddlewareHandler } from 'hono'

import { Lru } from '../lib/lru.ts'
import type { Ledger } from '../storage/ledger.ts'
import { ledgerFingerprint } from './snapshot.ts'

/**
 * HTTP cache policy, one place. `max-age` is the browser, `s-maxage` the CDN in front (Vercel's
 * edge, reached through the web app's same-origin /api/nazar rewrite), and
 * `stale-while-revalidate` lets either answer at once while it refreshes in the background.
 * Ledger-backed lists change a few times a day, so a minute at the edge is invisible to people.
 */
export const CACHE = {
  list: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
  check: 'public, max-age=15, s-maxage=15, stale-while-revalidate=60',
  arkivSummary: 'public, max-age=60, s-maxage=120, stale-while-revalidate=600',
  arkivSummaryStale: 'public, max-age=15, s-maxage=15',
  arkivPinnedPage: 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
  arkivFirstPage: 'public, max-age=30, s-maxage=30, stale-while-revalidate=120',
} as const

/**
 * Mirrors the shared-cache part of Cache-Control into CDN-Cache-Control, which CDNs (Vercel
 * included) read for proxied responses while browsers ignore it. Errors and no-store pass through.
 */
export const cdnCacheHeaders = (): MiddlewareHandler => async (c, next) => {
  await next()
  if (c.req.method !== 'GET' || !c.res.ok || c.res.headers.has('CDN-Cache-Control')) return
  const cc = c.res.headers.get('Cache-Control') ?? ''
  const s = /s-maxage=(\d+)/.exec(cc)?.[1]
  if (!s || /no-store|private/.test(cc)) return
  const swr = /stale-while-revalidate=(\d+)/.exec(cc)?.[1]
  c.res.headers.set('CDN-Cache-Control', `public, s-maxage=${s}${swr ? `, stale-while-revalidate=${swr}` : ''}`)
}

/**
 * Remembers /v1/check answers per normalised batch for the current ledger version. Any write to
 * the alerts table moves the fingerprint and empties the cache, so a new or retracted alert is
 * never hidden behind a stale answer. The fingerprint is re-read at most every `checkMs`.
 */
export class CheckCache<T> {
  private readonly lru: Lru<string, T>
  private version = ''
  private checkedAt = 0
  hits = 0
  misses = 0

  constructor(
    private readonly ledger: Ledger,
    private readonly o: { max?: number; ttlMs?: number; checkMs?: number; now?: () => number } = {},
  ) {
    this.lru = new Lru(o.max ?? 5000, o.ttlMs ?? 10 * 60_000, o.now)
  }

  private now = () => (this.o.now ?? Date.now)()

  private sync() {
    const t = this.now()
    if (t - this.checkedAt < (this.o.checkMs ?? 2000)) return
    this.checkedAt = t
    const v = ledgerFingerprint(this.ledger)
    if (v !== this.version) {
      this.version = v
      this.lru.clear()
    }
  }

  async get(key: string, compute: () => Promise<T>): Promise<T> {
    this.sync()
    const hit = this.lru.get(key)
    if (hit !== undefined) {
      this.hits++
      return hit
    }
    this.misses++
    const value = await compute()
    this.lru.set(key, value)
    return value
  }

  get size() {
    return this.lru.size
  }
}
