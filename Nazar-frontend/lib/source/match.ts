import type { Alert, CheckResult, SourceKind } from './types'

// Matching rules. Must stay identical to Nazar-backend/src/domain/batch.ts so a batch
// typed here and a batch read from a PDF meet at the same key.

/** Shape a person might type: letters, digits and - / . space, 2 to 20 chars. */
export const BATCH_SHAPE = /^[A-Za-z0-9\-/. ]{2,20}$/

/** Lowercase, separators removed: "SR-13" becomes "sr13". */
export function matchKey(batch: string) {
  return batch.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Folds characters OCR and people commonly confuse: 0/O, 1/I/L, 5/S, 8/B. Only ever used for "Did you mean". */
export function confusionKey(batch: string) {
  return matchKey(batch).replace(/o/g, '0').replace(/[il]/g, '1').replace(/s/g, '5').replace(/b/g, '8')
}

const GROUPS: Record<string, string[]> = { '0': ['0', 'o'], '1': ['1', 'i', 'l'], '5': ['5', 's'], '8': ['8', 'b'] }

/**
 * Every match key that folds to the same confusion key, so look-alikes can be found
 * on stores that only index the exact key (Arkiv). Returns just the exact key when
 * the expansion would be too large to query.
 */
export function confusionVariants(batch: string, cap = 48): string[] {
  const exact = matchKey(batch)
  let out = ['']
  for (const ch of confusionKey(batch)) {
    const options = GROUPS[ch] ?? [ch]
    out = out.flatMap((p) => options.map((o) => p + o))
    if (out.length > cap) return [exact]
  }
  return [exact, ...out.filter((k) => k !== exact)]
}

export type Validated = { ok: true; batch: string } | { ok: false; batch: string }

export function validateBatch(input: string): Validated {
  const batch = input.trim().toUpperCase()
  return BATCH_SHAPE.test(batch) && matchKey(batch).length >= 2 ? { ok: true, batch } : { ok: false, batch }
}

/** Active alerts first (most severe, then newest); retracted ones after. */
export function orderAlerts(alerts: Alert[]) {
  return [...alerts].sort(
    (a, b) => Number(!!a.retraction) - Number(!!b.retraction) || b.severity - a.severity || b.noticeOrder - a.noticeOrder,
  )
}

/**
 * Turns the alerts found for one batch into a result. A look-alike is never shown as a
 * flag; we ask the person to re-read the pack instead.
 */
export function resolveResult(batch: string, exact: Alert[], lookAlike: string | undefined, source: SourceKind): CheckResult {
  const asOf = new Date()
  if (exact.length) {
    const alerts = orderAlerts(exact)
    const alert = alerts[0]!
    return { state: alert.retraction ? 'retracted' : 'flagged', batch: alert.batch, alert, alerts, asOf, source }
  }
  if (lookAlike) return { state: 'unreadable', batch, suggestion: lookAlike, asOf, source }
  return { state: 'no_alert', batch, asOf, source }
}
