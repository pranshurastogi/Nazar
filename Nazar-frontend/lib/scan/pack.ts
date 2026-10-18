// Whole-label grammar for Indian medicine packs: product name, composition, dosage form, pack size,
// manufacturer and address, manufacturing licence, MRP and Schedule H/H1 warnings, read from OCR text.
// Batch and dates come from labels.ts (merged in read.ts). Pure and import-free so it runs under
// `node --test` (see lib/scan/parsers.test.mjs); every field carries a confidence, 0-1.

import type { LabelDate } from './labels'

export type PackField<T = string> = { value: T; confidence: number }

export type PackLabel = {
  product?: PackField
  /** One entry per active ingredient, e.g. "Paracetamol IP 500 mg". */
  composition: PackField[]
  form?: PackField
  packSize?: PackField
  manufacturer?: PackField
  manufacturerAddress?: PackField
  /** Indian state or UT named in the manufacturer's address. */
  manufacturerState?: PackField
  marketedBy?: PackField
  licence?: PackField
  batch?: PackField
  mfg?: PackField<LabelDate>
  expiry?: PackField<LabelDate>
  /** Rupees, as printed. */
  mrp?: PackField
  /** "H", "H1", "X" or "G" when a Schedule line or the Rx retail warning is printed. */
  schedule?: PackField
  rawText: string
}

const FORMS: [RegExp, string][] = [
  [/\btab(?:let)?s?\b/i, 'tablet'],
  [/\bcap(?:sule)?s?\b/i, 'capsule'],
  [/\bsyrup\b/i, 'syrup'],
  [/\bsuspension\b/i, 'suspension'],
  [/\binjection\b|\binj\.?\b/i, 'injection'],
  [/\b(?:eye|ear|nasal)?\s?drops\b/i, 'drops'],
  [/\boral\s+solution\b|\bsolution\b/i, 'solution'],
  [/\bointment\b/i, 'ointment'],
  [/\bcream\b/i, 'cream'],
  [/\bgel\b/i, 'gel'],
  [/\blotion\b/i, 'lotion'],
  [/\binhaler\b|\brotacaps?\b/i, 'inhaler'],
  [/\bsachets?\b|\bgranules\b/i, 'sachet'],
  [/\bpowder\b/i, 'powder'],
  [/\bspray\b/i, 'spray'],
]

const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Jammu & Kashmir', 'Puducherry', 'Pondicherry', 'Chandigarh', 'Daman', 'Dadra', 'Sikkim',
]
const STATE_ABBR: Record<string, string> = { 'H.P.': 'Himachal Pradesh', 'U.P.': 'Uttar Pradesh', 'M.P.': 'Madhya Pradesh', 'A.P.': 'Andhra Pradesh', 'T.N.': 'Tamil Nadu', 'W.B.': 'West Bengal', 'J&K': 'Jammu and Kashmir' }

/** Words that start a different part of the label, so a captured value stops before them. */
const STOP =
  /\b(?:excipients?|colou?rs?\b|flavou?r|dosage|directions?|store|storage|keep|warning|caution|schedule|mfd\.?\s*by|manufactured|mfg\.?\s*by|marketed|mkt|mktd|distributed|b\.?\s?no|batch|lot\b|mfg\.?\s*(?:dt|date)|mfd\.?\s*(?:dt|date)|exp|m\.?\s?r\.?\s?p|price|lic(?:ence|ense)?\.?\s*no|regd|for\s+use|use\s+before|read\s+the|protect)/i

const UNIT = String.raw`(?:mg|mcg|µg|g|gm|ml|iu|i\.u\.|units?|%\s?w\/[vw]|%)`
const PHARMACOPOEIA = String.raw`(?:I\.?P\.?|B\.?P\.?|U\.?S\.?P\.?|Ph\.?\s?Eur\.?)`
const INGREDIENT = new RegExp(
  String.raw`([A-Za-z][A-Za-z\-]+(?:\s+(?!eq\b|equivalent\b|to\b)[A-Za-z][A-Za-z\-]+){0,4})\s*(${PHARMACOPOEIA})?\s*(?:\(?\s*(?:eq\.?|equivalent)\s+to\s+[A-Za-z\-\s]+?(?:${PHARMACOPOEIA})?\s*\)?)?\s*[:.\-]?\s*(\d+(?:[.,]\d+)?)\s*(${UNIT})(?![a-z])`,
  'gi',
)
const COMPOSITION_HEAD =
  /\b(?:composition\s*(?:[:\-]|\n)|each\s+(?:film[\s-]?coated\s+|uncoated\s+|enteric[\s-]?coated\s+|sugar[\s-]?coated\s+|chewable\s+|dispersible\s+|hard\s+gelatin\s+|soft\s+gelatin\s+)?(?:tablet|capsule|caplet|sachet|vial|ampoule|gram|g|ml|\d+(?:\.\d+)?\s?ml)\s+(?:contains|contain)|each\s+\d+(?:\.\d+)?\s?(?:ml|g)\s+contains)\s*[:.\-]?/i
const LEAD_NOISE = /^(?:each|contains?|and|with|of|the)\s+/i

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,.:;\-–]+|[\s,.;:\-–]+$/g, '').trim()
const titleish = (s: string) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.replace(/\B[A-Z]+/g, (m) => m.toLowerCase()) : s)

/** Active ingredients after a "Composition:" / "Each tablet contains:" heading. */
export function parseComposition(text: string): string[] {
  const head = COMPOSITION_HEAD.exec(text)
  if (!head) return []
  let body = text.slice(head.index + head[0].length)
  const stop = STOP.exec(body)
  if (stop) body = body.slice(0, stop.index)
  body = body.slice(0, 400)
  const out: string[] = []
  for (const m of body.matchAll(INGREDIENT)) {
    const name = clean(m[1]!.replace(LEAD_NOISE, ''))
    if (!name || name.length < 3 || /^(?:q\.?s|qs)$/i.test(name)) continue
    const unit = m[4]!.toLowerCase().replace(/\s/g, '').replace('gm', 'g')
    const item = `${titleish(name)}${m[2] ? ' ' + m[2].replace(/\.$/, '').toUpperCase().replace(/\.(?=.)/g, '.') : ''} ${m[3]!.replace(',', '.')} ${unit === 'iu' || unit === 'i.u.' ? 'IU' : unit}`
    if (!out.some((o) => o.toLowerCase() === item.toLowerCase())) out.push(item)
    if (out.length >= 8) break
  }
  return out
}

export function detectForm(text: string): string | undefined {
  for (const [re, form] of FORMS) if (re.test(text)) return form
  return undefined
}

/** "10 Tablets", "1 x 10 Tablets", "Strip of 15 capsules", "100 ml" (never the "Each 5 ml" dose volume). */
export function parsePackSize(text: string): string | undefined {
  let m = /\b(\d{1,3})\s?[x×]\s?(\d{1,3})\s*(tablets?|capsules?|tabs?|caps?)?\b/i.exec(text)
  if (m) return `${m[1]} x ${m[2]}${m[3] ? ' ' + normCount(m[3]) : ''}`
  m = /\bstrip\s+of\s+(\d{1,3})\s*(tablets?|capsules?)?/i.exec(text)
  if (m) return `${m[1]} ${normCount(m[2] ?? 'tablets')}`
  for (const x of text.matchAll(/(\b\w+\s+)?\b(\d{1,3})\s*(tablets|capsules|tabs|caps)\b/gi)) {
    if (!/^(each|per)\s/i.test(x[1] ?? '')) return `${x[2]} ${normCount(x[3]!)}`
  }
  for (const x of text.matchAll(/(\b\w+\s+)?\b(\d{1,4}(?:\.\d+)?)\s?(ml|g|gm)\b(?!\s*contains)/gi)) {
    if (!/^(each|per|in|to)\s/i.test(x[1] ?? '') && Number(x[2]) >= 5) return `${x[2]} ${x[3]!.toLowerCase().replace('gm', 'g')}`
  }
  return undefined
}
const normCount = (w: string) => (/^cap/i.test(w) ? 'capsules' : 'tablets')

const MAKER = /\b(?:mfd\.?|mfg\.?|manufactured)\s*(?:in\s+india\s+)?by\s*[:.\-]?\s*/i
const MARKETER = /\b(?:marketed|mkt\.?|mktd\.?|distributed)\s*by\s*[:.\-]?\s*/i

function party(text: string, label: RegExp): { name: string; address: string } | undefined {
  const m = label.exec(text)
  if (!m) return undefined
  const rest = text.slice(m.index + m[0].length).split('\n')
  const first = rest[0] ?? ''
  // The company name ends at the first comma (address follows) or at the end of the line.
  const comma = first.indexOf(',')
  const name = clean((comma > 2 ? first.slice(0, comma) : first).replace(/^m\/s\.?\s*/i, ''))
  if (!/[a-z]{3}/i.test(name)) return undefined
  const addressParts = [comma > 2 ? first.slice(comma + 1) : '']
  for (const line of rest.slice(1, 3)) {
    if (!line.trim() || STOP.test(line) || MARKETER.test(line) || MAKER.test(line)) break
    addressParts.push(line)
  }
  const address = clean(addressParts.join(', ').replace(/,\s*,/g, ','))
  const stop = STOP.exec(address)
  return { name: name.slice(0, 80), address: (stop ? clean(address.slice(0, stop.index)) : address).slice(0, 160) }
}

export function stateOf(address: string): string | undefined {
  const s = STATES.find((st) => new RegExp(`\\b${st.replace(/[&.]/g, (c) => '\\' + c)}\\b`, 'i').test(address))
  if (s) return s === 'Pondicherry' ? 'Puducherry' : s === 'Jammu & Kashmir' ? 'Jammu and Kashmir' : s
  for (const [abbr, full] of Object.entries(STATE_ABBR)) if (address.toUpperCase().includes(abbr)) return full
  return undefined
}

export function parseLicence(text: string): string | undefined {
  const m = /\b(?:(?:mfg|mfd|manufacturing|drug)\.?\s*)?(?:lic(?:ence|ense)?|l)\.?\s*no\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-/.()]{1,20}(?:[ \t][A-Z0-9][A-Z0-9\-/]{0,12})?)/i.exec(text) ?? /\bM\.?\s?L\.?\s*(?:No\.?)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-/]{2,20})/.exec(text)
  if (!m) return undefined
  const v = m[1]!.replace(/[.\-/]+$/, '').trim()
  return /\d/.test(v) ? v.toUpperCase() : undefined
}

export function parseMrp(text: string): string | undefined {
  const m = /\bM\.?\s?R\.?\s?P\.?\s*(?:\(?incl[^)]*\)?)?\s*(?:Rs\.?|₹|INR)?\s*[:.\-]?\s*(?:Rs\.?|₹|INR)?\s*(\d{1,5}(?:[.,]\d{1,2})?)/i.exec(text) ?? /(?:Rs\.?|₹)\s*(\d{1,5}(?:[.,]\d{1,2})?)/i.exec(text)
  return m ? m[1]!.replace(',', '.') : undefined
}

export function parseSchedule(text: string): string | undefined {
  const m = /\bschedule\s*[-‐]?\s*(H\s?1|H|X|G)\b/i.exec(text)
  if (m) return m[1]!.replace(/\s/g, '').toUpperCase()
  if (/prescription\s+of\s+a\s+registered\s+medical\s+practitioner/i.test(text)) return 'H'
  return undefined
}

const LABEL_WORDS = /\b(?:composition|contains|each|mfd|mfg|manufactured|marketed|mkt|batch|b\.?\s?no|exp|expiry|m\.?r\.?p|store|keep|schedule|warning|caution|lic|regd|dosage|directions|rx|use before|price|incl|taxes)\b/i

/** Product name: an early, mostly-letters line, preferring one that names a dosage form or a brand in capitals. */
export function parseProduct(text: string): { value: string; confidence: number } | undefined {
  const lines = text.split('\n').map((l) => clean(l.replace(/^\s*(?:Rx|℞)\s+/i, ''))).filter(Boolean)
  let best: { value: string; score: number } | undefined
  lines.slice(0, 12).forEach((line, i) => {
    if (LABEL_WORDS.test(line) || line.length < 3 || line.length > 60) return
    const letters = line.replace(/[^a-z]/gi, '').length
    if (letters < 3 || letters / line.length < 0.5) return
    let score = 4 - i * 0.4
    if (detectForm(line)) score += 2.5
    if (/\b[A-Z][A-Z0-9-]{2,}\b/.test(line)) score += 1
    if (new RegExp(`\\b${PHARMACOPOEIA}`).test(line)) score += 0.5
    if (/\d+\s?(?:mg|ml)\b/i.test(line)) score += 0.5
    if (!best || score > best.score) best = { value: line, score }
  })
  if (!best) return undefined
  return { value: best.value.slice(0, 80), confidence: best.score >= 5 ? 0.75 : best.score >= 3 ? 0.55 : 0.35 }
}

/**
 * Structured label from OCR text. `ocrConfidence(value)` (0-100) lowers a field's confidence when the
 * words it came from were read poorly; without it the grammar's own certainty is used.
 */
export function parsePackLabel(text: string, ocrConfidence?: (value: string) => number): PackLabel {
  const t = text.replace(/\r/g, '').replace(/[|]/g, ' ')
  const f = (value: string | undefined, grammar: number): PackField | undefined => {
    if (!value) return undefined
    const ocr = ocrConfidence ? Math.max(0, Math.min(100, ocrConfidence(value))) / 100 : 1
    return { value, confidence: Math.round(Math.min(grammar, ocr) * 100) / 100 }
  }
  const out: PackLabel = { composition: [], rawText: text }
  const product = parseProduct(t)
  if (product) out.product = f(product.value, product.confidence)
  out.composition = parseComposition(t).map((c) => f(c, 0.85)!)
  out.form = f(detectForm(product?.value ?? '') ?? detectForm(t), product && detectForm(product.value) ? 0.85 : 0.6)
  out.packSize = f(parsePackSize(t), 0.7)
  const maker = party(t, MAKER)
  const marketer = party(t, MARKETER)
  const who = maker ?? marketer
  if (who) {
    out.manufacturer = f(who.name, maker ? 0.85 : 0.6)
    if (who.address) out.manufacturerAddress = f(who.address, 0.7)
    const st = stateOf(who.address || who.name)
    if (st) out.manufacturerState = f(st, 0.8)
  }
  if (maker && marketer) out.marketedBy = f(marketer.name, 0.8)
  out.licence = f(parseLicence(t), 0.85)
  out.mrp = f(parseMrp(t), 0.8)
  out.schedule = f(parseSchedule(t), 0.9)
  for (const k of Object.keys(out) as (keyof PackLabel)[]) if (out[k] === undefined) delete out[k]
  return out
}

/** True when the label names the medicine well enough to ask about it. */
export const knowsMedicine = (p: Pick<PackLabel, 'product' | 'composition'> | null | undefined) => !!p && (!!p.product?.value || p.composition.length > 0)
