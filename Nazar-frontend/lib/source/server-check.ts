import { cache } from 'react'

import { parseCheck, type CheckResponse } from './api'
import { validateBatch } from './match'
import type { CheckResult } from './types'

// Server-side batch check for the public share page (/b/[batch]) and its Open Graph image.
// It only ever asks the Nazar API about one batch: nothing from a visitor's device is involved.

/** How long a rendered share page and its card are reused before the API is asked again. */
export const SHARE_REVALIDATE_S = 300

const trimSlash = (s: string) => s.replace(/\/+$/, '')

/**
 * The API origin the server can reach directly. NAZAR_API_ORIGIN (runtime, server-only) wins;
 * set it to anything that is not an http(s) URL, e.g. "off", to disable server checks.
 * Otherwise an absolute NEXT_PUBLIC_NAZAR_API_URL is used.
 */
function serverApiOrigin(): string | null {
  const origin = process.env.NAZAR_API_ORIGIN?.trim()
  if (origin) return /^https?:\/\//.test(origin) ? trimSlash(origin) : null
  const pub = process.env.NEXT_PUBLIC_NAZAR_API_URL?.trim()
  return pub && /^https?:\/\//.test(pub) ? trimSlash(pub) : null
}

/** The batch from a route segment, decoded once if the platform left it encoded. */
export function batchFromParam(raw: string): string {
  let v = raw
  if (v.includes('%')) {
    try {
      v = decodeURIComponent(v)
    } catch {}
  }
  return v.trim().toUpperCase().slice(0, 40)
}

export type ShareCheck =
  | { kind: 'result'; batch: string; result: CheckResult }
  /** The API could not be reached or answered badly: the page offers to check in the app instead. */
  | { kind: 'unavailable'; batch: string }

/** Checks one batch for the share page. Never throws. Deduplicated within a render. */
export const shareCheck = cache(async (rawBatch: string): Promise<ShareCheck> => {
  const v = validateBatch(rawBatch)
  // The same rule the app applies on the device: a garbled number is never looked up.
  if (!v.ok) return { kind: 'result', batch: v.batch, result: { state: 'unreadable', batch: v.batch, asOf: new Date(), source: 'local' } }
  const origin = serverApiOrigin()
  if (!origin) return { kind: 'unavailable', batch: v.batch }
  try {
    const res = await fetch(`${origin}/v1/check?batch=${encodeURIComponent(v.batch)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: SHARE_REVALIDATE_S },
    })
    if (!res.ok) return { kind: 'unavailable', batch: v.batch }
    const result = parseCheck((await res.json()) as CheckResponse, v.batch)
    return { kind: 'result', batch: result.batch, result }
  } catch {
    return { kind: 'unavailable', batch: v.batch }
  }
})
