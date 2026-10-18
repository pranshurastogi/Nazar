import { createHash, randomBytes } from 'node:crypto'

/**
 * Abuse protection for the LLM endpoint. Clients are identified only by a salted hash of their IP,
 * held in memory (never written to disk), so the server cannot later say who asked about what.
 * Every limiter takes the clock as an argument so tests can drive time.
 */

export const hashIp = (ip: string, salt: string) => createHash('sha256').update(`${salt}␟${ip}`).digest('hex').slice(0, 16)

export const randomSalt = () => randomBytes(16).toString('hex')

/** First hop of X-Forwarded-For (what Railway's proxy sets), then X-Real-IP, then the socket address. */
export function clientIp(headers: Record<string, string | undefined>, socketAddress?: string): string {
  const xff = headers['x-forwarded-for']?.split(',')[0]?.trim()
  return xff || headers['x-real-ip']?.trim() || socketAddress || 'unknown'
}

interface Bucket {
  tokens: number
  at: number
}

/** Classic token bucket: `capacity` requests, refilled continuously over `windowMs`. */
export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>()
  constructor(
    readonly capacity: number,
    readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  private current(key: string, now: number): Bucket {
    const b = this.buckets.get(key)
    if (!b) return { tokens: this.capacity, at: now }
    const refill = ((now - b.at) / this.windowMs) * this.capacity
    return { tokens: Math.min(this.capacity, b.tokens + refill), at: now }
  }

  /** Seconds until one token is available (0 when one is available now). */
  wait(key: string, now: number): number {
    const b = this.current(key, now)
    return b.tokens >= 1 ? 0 : Math.ceil(((1 - b.tokens) * this.windowMs) / this.capacity / 1000)
  }

  take(key: string, now: number) {
    const b = this.current(key, now)
    b.tokens -= 1
    this.buckets.set(key, b)
    if (this.buckets.size > this.maxKeys) this.prune(now)
  }

  /** Drops buckets that have refilled completely; they carry no information. */
  private prune(now: number) {
    for (const [k] of this.buckets) if (this.current(k, now).tokens >= this.capacity) this.buckets.delete(k)
  }
}

export interface ClientLimits {
  perMinute: number
  perDay: number
}

export const DEFAULT_CLIENT_LIMITS: ClientLimits = { perMinute: 5, perDay: 30 }
/** Pack identification (POST /v1/medicine/identify) has its own, separate budget per client. */
export const DEFAULT_IDENTIFY_LIMITS: ClientLimits = { perMinute: 10, perDay: 50 }

/** Per-client limit: both the minute and the day bucket must have a token. */
export class ClientLimiter {
  private readonly minute: TokenBuckets
  private readonly day: TokenBuckets
  constructor(limits: ClientLimits = DEFAULT_CLIENT_LIMITS) {
    this.minute = new TokenBuckets(limits.perMinute, 60_000)
    this.day = new TokenBuckets(limits.perDay, 86_400_000)
  }

  /** Takes a token, or returns how long to wait without taking anything. */
  take(key: string, now: number): { ok: true } | { ok: false; retryAfterSec: number; window: 'minute' | 'day' } {
    const m = this.minute.wait(key, now)
    const d = this.day.wait(key, now)
    if (d > 0) return { ok: false, retryAfterSec: d, window: 'day' }
    if (m > 0) return { ok: false, retryAfterSec: m, window: 'minute' }
    this.minute.take(key, now)
    this.day.take(key, now)
    return { ok: true }
  }
}

const DAY_MS = 86_400_000

/** Global ceiling on upstream LLM calls per UTC day, so a distributed flood cannot run up a bill. */
export class DailyCap {
  private day = -1
  private used = 0
  constructor(readonly cap: number) {}

  private roll(now: number) {
    const d = Math.floor(now / DAY_MS)
    if (d !== this.day) {
      this.day = d
      this.used = 0
    }
  }

  /** Seconds until the next UTC midnight when the cap is spent, else 0. */
  wait(now: number): number {
    this.roll(now)
    return this.used < this.cap ? 0 : Math.max(1, Math.ceil(((this.day + 1) * DAY_MS - now) / 1000))
  }

  take(now: number) {
    this.roll(now)
    this.used++
  }

  get count() {
    return this.used
  }
}
