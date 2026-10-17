import { stableId } from '../lib/hash.ts'
import { parseYm } from './dates.ts'

/**
 * Batch-number normalisation. Must stay identical to Nazar-frontend/lib so a
 * batch typed in the app and a batch read from a PDF meet at the same key.
 */

/**
 * Shape a person might type: letters, digits, - / . space and parentheses, 2 to 24 chars.
 * Parentheses are real: CDSCO lists Sodium chloride injection batch "(N)25567".
 */
export const BATCH_SHAPE = /^[A-Za-z0-9\-/. ()]{2,24}$/

/** Lowercase, separators removed: "SR-13" becomes "sr13". */
export function matchKey(batch: string): string {
  return batch.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Folds characters OCR and people commonly confuse: 0/O, 1/I/L, 5/S, 8/B. Only ever used for "Did you mean". */
export function confusionKey(batch: string): string {
  return matchKey(batch).replace(/o/g, '0').replace(/[il]/g, '1').replace(/s/g, '5').replace(/b/g, '8')
}

const NOT_A_BATCH = /^(n\.?\s*a\.?|nil|none|not\s+(mentioned|mention|available|given|stated|known)|unknown|--?|—|batch|b\.?\s*no\.?)$/i

/** Cleans a raw cell into a display batch number, or null if it is not one. */
export function cleanBatch(raw: string): string | null {
  const s = raw
    .replace(/^(b\.?\s*no\.?|batch\s*(no\.?|number)?|lot\s*(no\.?)?)\s*[:.\-]?\s*/i, '')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,;:.]+$/, '')
    // A trailing note such as "SR-13 (Syrup)" is not part of the batch; "(N)25567" keeps its prefix.
    .replace(/\s+\([^()\d]*\)$/, '')
  if (!s || NOT_A_BATCH.test(s)) return null
  return s.toUpperCase()
}

/** A batch read from a document must look like one: has a digit, fits the shape, not a date or a lone number. */
export function isPlausibleBatch(batch: string): boolean {
  if (!BATCH_SHAPE.test(batch)) return false
  const key = matchKey(batch)
  if (key.length < 2 || key.length > 18) return false
  if (!/\d/.test(key)) return false
  // A month-year like 05/2025 is a date, not a batch; "1-3098" only looks like one.
  if (/^\d{1,2}[/.-]\d{2,4}$/.test(batch.trim()) && parseYm(batch) !== null) return false
  return true
}

/**
 * One cell sometimes lists several batches: "AB101, AB102 & AB103" or "AB101/AB102".
 * Slashes are only treated as separators when every part is itself a plausible batch,
 * because many real batch numbers contain a slash (e.g. "T/2301").
 */
export function splitBatches(cell: string): string[] {
  const parts = cell.split(/\s*(?:,|;|&|\band\b)\s*/i).flatMap((p) => {
    const bySlash = p.split('/').map((x) => x.trim())
    return bySlash.length > 1 && bySlash.every((x) => x.length >= 4 && /\d/.test(x) && /[a-z]/i.test(x)) ? bySlash : [p]
  })
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const c = cleanBatch(p)
    if (c && isPlausibleBatch(c) && !seen.has(matchKey(c))) {
      seen.add(matchKey(c))
      out.push(c)
    }
  }
  return out
}

/**
 * Rows that name a product but no batch ("Not Mentioned", blank) are kept as drug-level records
 * under a placeholder batch. Their batch key carries a ':' that matchKey() can never produce,
 * so no typed batch can ever match one.
 */
export const UNSPECIFIED_PREFIX = 'UNSPECIFIED-'

export const unspecifiedBatch = (...seed: (string | number)[]) => `${UNSPECIFIED_PREFIX}${stableId('unspecified', ...seed).slice(0, 8).toUpperCase()}`

export const isUnspecifiedBatch = (batch: string) => batch.trim().toUpperCase().startsWith(UNSPECIFIED_PREFIX)

export const unspecifiedBatchKey = (batch: string) => `unspecified:${matchKey(batch.trim().slice(UNSPECIFIED_PREFIX.length))}`

/** "Not mentioned on sample", "NOT STATED", "Not Mentioned//": the notice says there is no batch. */
const NO_BATCH_STATED = /^(not\s+(mentioned|mention|stated|known|available|given|declared)|n\.?\s*a\.?|nil|none|unknown)\b[^0-9]*$/i

/** True when a cell states no batch at all (as opposed to one we cannot read). */
export function isMissingBatch(cell: string | null | undefined): boolean {
  const c = cleanBatch(cell ?? '')
  return c === null || NO_BATCH_STATED.test(c)
}
