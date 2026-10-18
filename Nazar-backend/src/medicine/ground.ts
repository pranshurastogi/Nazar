import { distance } from 'fastest-levenshtein'

import { cleanBatch, isPlausibleBatch } from '../domain/batch.ts'
import { parseYm } from '../domain/dates.ts'
import { guardText } from './guard.ts'
import type { IdentifyAnswer, IdentifyEvidence, IdentifyField, IdentifyGuess } from './schema.ts'

/**
 * Grounding for pack identification: every value the model returns must be backed by the label text
 * the device sent. Matching runs on an "OCR-folded" copy of both sides (lowercase, letters and digits
 * only, 0/O, 1/I/L, 5/S and 8/B folded together, as in confusionKey), so "D0L0 65O" and "Dolo 650"
 * meet, while a batch number that is not on the label never survives.
 *
 *   batch      the value itself must be on the label (folded, no edit distance). Returned as printed.
 *   expiry     must be a month-year on the label, not the one labelled MFD/MFG.
 *   composition each ingredient name must be on the label (one edit allowed), and so must its strength digits.
 *   product, brand, manufacturer, form
 *              need an evidence quote that is on the label and contains the value's key word.
 *
 * Evidence quotes that are not on the label are discarded; the quotes returned are the matching spans
 * of the submitted text, exactly as submitted, so the app can highlight them.
 */

const CONFUSE: Record<string, string> = { o: '0', i: '1', l: '1', s: '5', b: '8' }
const ALNUM = /[\p{L}\p{N}]/u

export interface Folded {
  /** Folded characters. */
  f: string
  /** at[k] = index in the original string of folded character k. */
  at: number[]
}

export function foldOcr(s: string): Folded {
  let f = ''
  const at: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (!ALNUM.test(c)) continue
    const lc = c.toLowerCase()[0]!
    f += CONFUSE[lc] ?? lc
    at.push(i)
  }
  return { f, at }
}

export const foldKey = (s: string) => foldOcr(s).f

/** Edits allowed for a fuzzy match: none below 5 folded chars, one up to 11, two up to 40; longer quotes must match exactly. */
const maxEdits = (n: number) => (n < 5 || n > 40 ? 0 : n < 12 ? 1 : 2)

/** Where `needle` occurs in `hay` (folded indices, end exclusive), exactly or within maxEdits when fuzzy. */
export function findFolded(hay: Folded, needle: string, o: { min?: number; fuzzy?: boolean } = {}): [number, number] | null {
  const n = foldKey(needle)
  if (n.length < (o.min ?? 3)) return null
  const i = hay.f.indexOf(n)
  if (i >= 0) return [i, i + n.length]
  const d = o.fuzzy ? maxEdits(n.length) : 0
  if (d === 0) return null
  let best: { s: number; e: number; d: number } | null = null
  for (let len = n.length - d; len <= n.length + d; len++) {
    for (let s = 0; s + len <= hay.f.length; s++) {
      const dist = distance(hay.f.slice(s, s + len), n)
      if (dist <= d && (!best || dist < best.d)) best = { s, e: s + len, d: dist }
    }
  }
  return best ? [best.s, best.e] : null
}

/** The original characters behind a folded span; `words` widens it to whole words (for quotes matched with edits). */
function spanOf(text: string, hay: Folded, [s, e]: [number, number], words = false): string {
  let a = hay.at[s]!
  let b = hay.at[e - 1]! + 1
  if (words) {
    while (a > 0 && ALNUM.test(text[a - 1]!)) a--
    while (b < text.length && ALNUM.test(text[b]!)) b++
  }
  return text.slice(a, b)
}

/** Words that say nothing about which medicine this is; skipped when picking a value's key word. */
const STOP = new Set(
  'tablet tablets tab tabs capsule capsules cap caps syrup suspension injection drops cream ointment gel solution oral each contains film coated ip bp usp mg mcg ml gm the and of ltd limited pvt private m s'.split(' '),
)

/** The first distinctive word of a value ("Dolo 650 Tablets" → "Dolo"; "Micro Labs Limited" → "Micro"). */
export function keyWord(value: string, o: { stop?: boolean; min?: number } = {}): string | null {
  const min = o.min ?? 3
  const words = value.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return words.find((w) => foldKey(w).length >= min && !(o.stop !== false && STOP.has(w.toLowerCase()))) ?? null
}

// ---- dates

const MONTH3: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** Date-like tokens with OCR letters in them ("O5/2O28") get those letters read as digits. Length is kept, so indices still line up. */
const DATE_TOKEN = /[0-9OoIl|SB]{1,4}(?:\s?[/.\-]\s?[0-9OoIl|SB]{1,4}){1,2}/g
const digitFold = (t: string) => t.replace(DATE_TOKEN, (tok) => (/\d/.test(tok) ? tok.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8') : tok))

const NUM_DATE = /(?<![\p{L}\p{N}])(\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{4}|\d{2})|\d{4}[/.\-]\d{1,2}|\d{1,2}\s?[/.\-]\s?(?:\d{4}|\d{2}))(?![\p{L}\p{N}])/gu
const MON_DATE = /(?<!\p{L})(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s/.\-,']*(\d{4}|\d{2})(?!\p{N})/giu
const EXP_LABEL = /exp|use\s*(?:before|by)|best\s*before/gi
const MFG_LABEL = /mfd|mfg|mf\.\s*d|manufactured|mfr|pkd|packed|\bdom\b/gi

export interface LabelDate {
  ym: number
  /** The date as written on the label. */
  quote: string
  label: 'exp' | 'mfg' | null
}

function lastIndex(re: RegExp, s: string): number {
  let at = -1
  for (const m of s.matchAll(re)) at = m.index
  return at
}

/** Every month-year printed on the label, with the label (EXP or MFD) that precedes it. */
export function labelDates(text: string): LabelDate[] {
  const dt = digitFold(text)
  const out: LabelDate[] = []
  const add = (start: number, end: number, ym: number | null) => {
    if (ym === null || ym < 200001 || ym > 209912) return
    const before = text.slice(Math.max(0, start - 20), start)
    const e = lastIndex(EXP_LABEL, before)
    const m = lastIndex(MFG_LABEL, before)
    out.push({ ym, quote: text.slice(start, end), label: e < 0 && m < 0 ? null : e > m ? 'exp' : 'mfg' })
  }
  for (const m of dt.matchAll(NUM_DATE)) add(m.index, m.index + m[0].length, parseYm(m[1]!.replace(/\s/g, '')))
  for (const m of dt.matchAll(MON_DATE)) {
    const y = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2])
    const mon = MONTH3[m[1]!.toLowerCase()]!
    add(m.index, m.index + m[0].length, y * 100 + mon)
  }
  return out
}

/** "2028-04", "04/2028", "Apr 2028" → 202804. */
function expiryYm(v: string): number | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(v.trim())
  if (m) {
    const mo = Number(m[2])
    return mo >= 1 && mo <= 12 ? Number(m[1]) * 100 + mo : null
  }
  return parseYm(v)
}

// ---- grounding

export interface Grounded {
  guess: IdentifyGuess
  evidence: IdentifyEvidence[]
  /** Fields the model filled that did not survive grounding or the guard. */
  dropped: IdentifyField[]
  confidence: 'high' | 'medium' | 'low'
}

/** product and brand often share one printed line, so either may stand on the other's quote. */
const QUOTE_POOL: Partial<Record<IdentifyField, IdentifyField[]>> = { product: ['product', 'brand'], brand: ['brand', 'product'] }

export function groundAnswer(answer: IdentifyAnswer, text: string): Grounded {
  const hay = foldOcr(text)
  const evidence: IdentifyEvidence[] = []
  const cite = (field: IdentifyField, quote: string) => {
    const q = guardText(quote, 200)
    if (q && !evidence.some((e) => e.field === field && e.quote === q)) evidence.push({ field, quote: q })
  }

  // Quotes the model gave that really are on the label, replaced by the label's own characters.
  const quotes: { field: IdentifyField; quote: string; folded: Folded }[] = []
  for (const e of answer.evidence.slice(0, 24)) {
    const sp = findFolded(hay, e.quote.slice(0, 300), { fuzzy: true })
    if (sp) {
      const exact = hay.f.slice(sp[0], sp[1]) === foldKey(e.quote)
      const quote = spanOf(text, hay, sp, !exact)
      quotes.push({ field: e.field, quote, folded: foldOcr(quote) })
    }
  }

  const textField = (field: 'product' | 'brand' | 'manufacturer' | 'form', max: number): string | null => {
    const v = guardText(answer[field], max)
    if (!v) return null
    const key = keyWord(v, { stop: field !== 'form' })
    if (!key) return null
    const pool = QUOTE_POOL[field] ?? [field]
    const q = quotes.find((x) => pool.includes(x.field) && findFolded(x.folded, key, { fuzzy: true }))
    if (!q) return null
    cite(field, q.quote)
    return v
  }

  const product = textField('product', 120)
  const brand = textField('brand', 120)
  const manufacturer = textField('manufacturer', 200)
  const form = textField('form', 40)

  // Composition: the ingredient name and its strength digits must both be on the label.
  const composition: string[] = []
  let compositionDropped = false
  for (const item of answer.composition.slice(0, 8)) {
    const v = guardText(item, 160)
    const name = v ? keyWord(v, { min: 4 }) : null
    const sp = name ? findFolded(hay, name, { min: 4, fuzzy: true }) : null
    const digitsOk = v ? (v.match(/\d+(?:\.\d+)?/g) ?? []).every((n) => hay.f.includes(foldKey(n))) : false
    if (!v || !name || !sp || !digitsOk) {
      compositionDropped = true
      continue
    }
    if (composition.some((c) => c.toLowerCase() === v.toLowerCase())) continue
    composition.push(v)
    const q = quotes.find((x) => x.field === 'composition' && findFolded(x.folded, name, { min: 4, fuzzy: true }))
    cite('composition', q ? q.quote : spanOf(text, hay, sp))
  }

  // Batch: on the label after OCR folding, never corrected or completed. Returned as the label prints it.
  let batch: string | null = null
  const rawBatch = answer.batch.trim() ? cleanBatch(answer.batch) : null
  if (rawBatch && isPlausibleBatch(rawBatch)) {
    const sp = findFolded(hay, rawBatch, { min: 3 })
    if (sp) {
      const printed = spanOf(text, hay, sp)
      const asPrinted = cleanBatch(printed)
      batch = asPrinted && isPlausibleBatch(asPrinted) ? asPrinted : rawBatch
      cite('batch', printed)
    }
  }

  // Expiry: a month-year on the label; when one is labelled EXP it must be that one, and never the MFD date.
  let expiry: string | null = null
  const ym = answer.expiry.trim() ? expiryYm(answer.expiry) : null
  if (ym !== null) {
    const dates = labelDates(text)
    const anyExp = dates.some((d) => d.label === 'exp')
    const hit = dates.find((d) => d.ym === ym && (anyExp ? d.label === 'exp' : d.label !== 'mfg'))
    if (hit) {
      expiry = `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, '0')}`
      cite('expiry', hit.quote)
    }
  }

  const guess: IdentifyGuess = { product, brand, composition, form, manufacturer, batch, expiry }
  const dropped: IdentifyField[] = []
  for (const f of ['product', 'brand', 'form', 'manufacturer', 'batch', 'expiry'] as const) if (answer[f].trim() && guess[f] === null) dropped.push(f)
  if (compositionDropped) dropped.push('composition')

  let confidence = answer.confidence
  if (dropped.length > 0 && confidence === 'high') confidence = 'medium'
  if (!product && !brand && composition.length === 0) confidence = 'low'
  return { guess, evidence: evidence.slice(0, 16), dropped, confidence }
}
