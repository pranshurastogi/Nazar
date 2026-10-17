import { parseYm } from '../domain/dates.ts'

/**
 * Cell-level rules: how a wrapped table cell becomes a field value. Kept separate
 * from layout so the same rules serve the text layer, OCR and the LLM verifier.
 */

/** Joins wrapped lines with spaces, but keeps "Gastro-\nResistant" as one word. */
export function flat(cell: string | null | undefined): string {
  if (!cell) return ''
  return cell
    .replace(/[‐‑‒–]/g, '-')
    .replace(/(\w)-\n(?=\S)/g, '$1-')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+([),.;:])/g, '$1')
    .trim()
}

/**
 * A batch cell wraps mid-token ("RUM241100" + "2"), so lines join without a space.
 * Spaces around hyphens and slashes are layout artefacts: "1 - 3098" is batch "1-3098".
 */
export function batchText(cell: string | null | undefined): string {
  if (!cell) return ''
  return cell
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s*\n\s*/g, '')
    .replace(/\s*([-/])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const MISSING = /^(not\s*mentioned|not\s*available|not\s*given|n\.?\s*a\.?|nm|nil|none|-+|—)$/i

/** True when a cell says the value is absent ("Not mentioned", "NM", "N.A."). */
export const isMissing = (s: string | null | undefined) => !s || MISSING.test(flat(s))

export interface YmValue {
  ym: number | null
  /** Set when the expiry was computed from a stated shelf life rather than printed. */
  derived?: boolean
}

const addMonths = (ym: number, n: number) => {
  const total = Math.floor(ym / 100) * 12 + (ym % 100) - 1 + n
  return Math.floor(total / 12) * 100 + (total % 12) + 1
}

/**
 * Normalises a date cell to YYYYMM. Handles "Apr--2026", "12/ 2024,", "Mfg dt: 11/2016"
 * and, for expiry cells, a shelf life such as "3 years from Manufacturing" (needs mfgYm).
 */
export function normaliseDate(raw: string | null | undefined, mfgYm: number | null = null): YmValue {
  const text = flat(raw)
  if (!text || isMissing(text)) return { ym: null }
  const s = text
    .replace(/^(?:m(?:fg|fd)|exp(?:iry)?|date\s+of\s+\w+)\.?\s*(?:dt|date)?\.?\s*[:.-]?\s*/i, '')
    .replace(/[,;.]+$/, '')
    .replace(/\s*([/.-])\s*/g, '$1')
    .replace(/([/.-])\1+/g, '$1')
  const ym = parseYm(s)
  if (ym) return { ym }
  const life = /(\d{1,2})\s*(years?|yrs?|months?)\b.*\b(?:mfg|manufactur)/i.exec(text) ?? /^after\s+(\d{1,2})\s*(years?|yrs?|months?)/i.exec(text)
  if (life && mfgYm) {
    const n = Number(life[1]) * (/^m/i.test(life[2]!) ? 1 : 12)
    // A product made in Feb 2026 with a 3-year life is labelled "Exp Jan 2029".
    return { ym: addMonths(mfgYm, n - 1), derived: true }
  }
  return { ym: null }
}

/** Indian PIN code (6 digits, first 1-8), often printed "143 001". Returns the last one in the text. */
export function findPin(text: string | null | undefined): string | null {
  if (!text) return null
  const all = [...text.matchAll(/(?<![\d])([1-8]\d{2})\s?(\d{3})(?![\d])/g)]
  const last = all[all.length - 1]
  return last ? `${last[1]}${last[2]}` : null
}

/** Firm name: the text after "M/s" up to the first comma ("M/s. Gidsha Pharmaceuticals, Plot..." → "Gidsha Pharmaceuticals"). */
export function firmName(manufacturer: string | null | undefined): string | null {
  const s = flat(manufacturer)
  if (!s) return null
  const m = /M\s*\/\s*s\.?\s*/i.exec(s)
  const rest = m ? s.slice(m.index + m[0].length) : s
  const name = rest.split(',')[0]!.trim().replace(/[.\s]+$/, '')
  return name || null
}

export interface CombinedBlock {
  batch: string
  mfg: string | null
  exp: string | null
  manufacturer: string | null
}

/**
 * Legacy CDSCO cells pack four fields into one: "B. No.: T-12701, Mfg dt: 11/2016,
 * Exp dt: 10/2018, Mfd by: M/s. Jackson Laboratories...". A kit can list several
 * "B. No." blocks in one cell; each becomes its own block.
 */
export function parseCombined(cell: string): CombinedBlock[] {
  const s = flat(cell)
  const starts = [...s.matchAll(/\bB\s*\.?\s*No\s*\.?\s*[:.-]?/gi)].map((m) => ({ at: m.index, len: m[0].length }))
  if (!starts.length) return []
  return starts.map((st, i) => {
    const seg = s.slice(st.at + st.len, i + 1 < starts.length ? starts[i + 1]!.at : undefined)
    const batchEnd = seg.search(/,?\s*\b(?:M(?:fg|fd)\.?\s*(?:dt|date|by)|Exp(?:iry)?\.?\s*(?:dt|date)|D\.?\s*O\.?\s*[ME]\b)/i)
    const batch = (batchEnd >= 0 ? seg.slice(0, batchEnd) : seg).replace(/[,;\s]+$/, '').trim()
    const mfg = /\bM(?:fg|fd)\.?\s*(?:dt|date)\.?\s*[:.-]?\s*([^,]+)/i.exec(seg)?.[1]?.trim() ?? null
    const exp = /\bExp(?:iry)?\.?\s*(?:dt|date)\.?\s*[:.-]?\s*([^,]+)/i.exec(seg)?.[1]?.trim() ?? null
    const mfr = /\bM(?:fd|fg|anufactured)\.?\s*by\s*[:.-]?\s*(.+)$/i.exec(seg)?.[1]?.trim() ?? null
    return { batch, mfg, exp, manufacturer: mfr ? mfr.replace(/[,;\s]+$/, '') : null }
  })
}
