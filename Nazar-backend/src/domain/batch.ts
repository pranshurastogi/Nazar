import { parseYm } from './dates.ts'

/**
 * Batch-number normalisation. Must stay identical to Nazar-frontend/lib so a
 * batch typed in the app and a batch read from a PDF meet at the same key.
 */

/** Shape a person might type: letters, digits and - / . space, 2 to 20 chars. */
export const BATCH_SHAPE = /^[A-Za-z0-9\-/. ]{2,20}$/

/** Lowercase, separators removed: "SR-13" becomes "sr13". */
export function matchKey(batch: string): string {
  return batch.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Folds characters OCR and people commonly confuse: 0/O, 1/I/L, 5/S, 8/B. Only ever used for "Did you mean". */
export function confusionKey(batch: string): string {
  return matchKey(batch).replace(/o/g, '0').replace(/[il]/g, '1').replace(/s/g, '5').replace(/b/g, '8')
}

const NOT_A_BATCH = /^(n\.?\s*a\.?|nil|none|not\s+(mentioned|available|given)|--?|—|batch|b\.?\s*no\.?)$/i

/** Cleans a raw cell into a display batch number, or null if it is not one. */
export function cleanBatch(raw: string): string | null {
  const s = raw
    .replace(/^(b\.?\s*no\.?|batch\s*(no\.?|number)?|lot\s*(no\.?)?)\s*[:.\-]?\s*/i, '')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,;:.]+$/, '')
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
