import { TransientError } from './errors.ts'

export interface RetryOptions {
  retries: number
  baseMs?: number
  maxMs?: number
  /** Return false to stop retrying this error. Defaults to retrying TransientError only. */
  shouldRetry?: (err: unknown, attempt: number) => boolean
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void
  sleep?: (ms: number) => Promise<void>
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Exponential backoff with full jitter. */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 30_000, rand = Math.random) {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.round(cap / 2 + (rand() * cap) / 2)
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const shouldRetry = opts.shouldRetry ?? ((err) => err instanceof TransientError)
  const wait = opts.sleep ?? sleep
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      if (attempt >= opts.retries || !shouldRetry(err, attempt)) throw err
      const delay = backoffDelay(attempt, opts.baseMs, opts.maxMs)
      opts.onRetry?.(err, attempt + 1, delay)
      await wait(delay)
    }
  }
}
