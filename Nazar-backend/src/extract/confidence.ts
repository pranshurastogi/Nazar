import { findPin } from './grammar.ts'

/**
 * Scores a parsed row. Each check that fails lowers confidence and records why, so
 * the curator queue shows what to look at. Rows without a plausible batch never
 * reach this point: they are rejected outright.
 */

export interface ScoreInput {
  product: string
  batch: string
  mfgYm: number | null
  expYm: number | null
  manufacturer: string | null
  reason: string | null
}

export interface ScoreOptions {
  /** The template prints full addresses, so a missing PIN suggests a truncated cell. */
  expectPin?: boolean
  /** Template-level issues (e.g. expiry derived from shelf life), each a small penalty. */
  extraIssues?: string[]
  /** YYYYMM "now", injectable for tests. */
  nowYm?: number
}

const months = (ym: number) => Math.floor(ym / 100) * 12 + (ym % 100)

export function scoreRow(row: ScoreInput, opts: ScoreOptions = {}): { confidence: number; issues: string[] } {
  const issues: string[] = []
  let score = 1
  const hit = (penalty: number, issue: string) => {
    score -= penalty
    issues.push(issue)
  }
  const now = opts.nowYm ?? new Date().getUTCFullYear() * 100 + new Date().getUTCMonth() + 1

  if (row.product.length < 3) hit(0.3, 'product name too short')
  else if (row.product.length > 260) hit(0.15, 'product text unusually long (rows may be merged)')

  if (/^\d{2,3}$/.test(row.batch)) hit(0.05, 'short numeric batch')
  if (/\s/.test(row.batch)) hit(0.05, 'batch contains a space')

  if (row.mfgYm === null) hit(0.1, 'manufacturing date missing or unreadable')
  if (row.expYm === null) hit(0.1, 'expiry date missing or unreadable')
  if (row.mfgYm !== null && row.expYm !== null) {
    const span = months(row.expYm) - months(row.mfgYm)
    if (span <= 0) hit(0.3, 'manufacturing date is not before expiry')
    else if (span > 72) hit(0.1, 'shelf life over 6 years')
  }
  if (row.mfgYm !== null && months(row.mfgYm) > months(now) + 1) hit(0.2, 'manufacturing date in the future')

  if (!row.reason) hit(0.15, 'no failure reason')
  if (!row.manufacturer) hit(0.1, 'no manufacturer')
  else if (opts.expectPin && !findPin(row.manufacturer)) hit(0.05, 'manufacturer address has no PIN code')

  for (const issue of opts.extraIssues ?? []) hit(0.05, issue)

  return { confidence: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), issues }
}
