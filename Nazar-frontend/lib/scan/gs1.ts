// GS1 element strings and GS1 Digital Link URLs, as printed in the 2D codes on medicine packs.
// Pure and dependency-free so it can be unit-tested with `node --test` (see lib/scan/parsers.test.mjs).

/** A calendar date read from a code. `day` is null when the code only gives a month (GS1 "00" day). */
export type CodeDate = { year: number; month: number; day: number | null }

export type Gs1Data = {
  form: 'element' | 'digital-link'
  gtin?: string
  /** False when the GTIN's check digit does not add up: a misread or a non-standard code. */
  gtinValid?: boolean
  batch?: string
  expiry?: CodeDate
  mfg?: CodeDate
  serial?: string
  /**
   * Free text from AI 240 (additional product identification) or 241 (customer part number), when it holds
   * words: a few makers put the product name there. Indian GS1 codes mostly carry only GTIN, batch and dates.
   */
  productText?: string
}

const GS = '\x1d'

// Data lengths (excluding the AI) for the fixed-length AIs, per the GS1 General Specifications.
const FIXED: Record<string, number> = {
  '00': 18, '01': 14, '02': 14, '03': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2,
}
// Variable-length AIs (data ends at a GS separator or the end of the string), with their maximum length.
const VARIABLE: Record<string, number> = {
  '10': 20, '21': 20, '22': 20, '30': 8, '37': 8, '90': 30, '91': 90, '92': 90, '93': 90, '94': 90, '95': 90, '96': 90, '97': 90, '98': 90, '99': 90,
  '235': 28, '240': 30, '241': 30, '242': 6, '243': 20, '250': 30, '251': 30, '253': 30, '254': 20, '400': 30, '401': 30, '403': 30, '710': 20, '711': 20, '712': 20, '713': 20, '714': 20, '715': 20,
}

/** True when the 14-digit (or shorter, left-padded) GTIN carries a valid mod-10 check digit. */
export function gtinCheckDigitOk(gtin: string): boolean {
  if (!/^\d{8,14}$/.test(gtin)) return false
  const digits = gtin.padStart(14, '0').split('').map(Number)
  const check = digits.pop()!
  const sum = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

/** YYMMDD as used by AIs 11/13/15/17. Day "00" means the month only. Years are taken as 20YY. */
export function parseYymmdd(v: string): CodeDate | undefined {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(v)
  if (!m) return undefined
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day > 31) return undefined
  return { year: 2000 + Number(m[1]), month, day: day === 0 ? null : day }
}

function fromPairs(pairs: [string, string][], form: Gs1Data['form']): Gs1Data | null {
  const out: Gs1Data = { form }
  for (const [ai, raw] of pairs) {
    const v = raw.trim()
    if (!v) continue
    if (ai === '01' || ai === '02') {
      if (!/^\d{8,14}$/.test(v)) continue
      out.gtin = v.padStart(14, '0')
      out.gtinValid = gtinCheckDigitOk(out.gtin)
    } else if (ai === '10') out.batch = v
    else if (ai === '21') out.serial = v
    else if (ai === '17' || ai === '15') out.expiry ??= parseYymmdd(v)
    else if (ai === '11') out.mfg = parseYymmdd(v)
    else if ((ai === '240' || ai === '241') && /[A-Za-z]{3}/.test(v)) out.productText ??= v.replace(/\s+/g, ' ').slice(0, 40)
  }
  if (out.expiry === undefined) delete out.expiry
  if (out.mfg === undefined) delete out.mfg
  return out.gtin || out.batch || out.expiry || out.serial ? out : null
}

/** "(01)08901234567890(10)SR-13(17)270430". Values may hold parentheses, e.g. "(10)(N)25567". */
function parseParenthesised(s: string): [string, string][] | null {
  if (!/^\(\d{2,4}\)/.test(s)) return null
  const pairs: [string, string][] = []
  const re = /\((\d{2,4})\)/g
  const marks: { ai: string; at: number; end: number }[] = []
  for (let m; (m = re.exec(s)); ) marks.push({ ai: m[1]!, at: m.index, end: re.lastIndex })
  marks.forEach((mk, i) => pairs.push([mk.ai, s.slice(mk.end, marks[i + 1]?.at ?? s.length).replaceAll(GS, '')]))
  return pairs
}

function aiAt(s: string, i: number): { ai: string; fixed?: number; max?: number } | null {
  const two = s.slice(i, i + 2)
  if (FIXED[two]) return { ai: two, fixed: FIXED[two] }
  if (VARIABLE[two]) return { ai: two, max: VARIABLE[two] }
  const three = s.slice(i, i + 3)
  if (VARIABLE[three]) return { ai: three, max: VARIABLE[three] }
  const four = s.slice(i, i + 4)
  if (/^3[1-6]\d\d$/.test(four)) return { ai: four, fixed: 6 } // measures: net weight, length, ...
  if (four === '7003') return { ai: four, fixed: 10 }
  if (/^(70|80)\d\d$/.test(four)) return { ai: four, max: 90 }
  return null
}

/** Raw element string: AIs run together, variable-length fields end with FNC1 (sent as ASCII 29). */
function parseRaw(s: string): [string, string][] | null {
  const pairs: [string, string][] = []
  let i = 0
  while (i < s.length) {
    if (s[i] === GS) {
      i++
      continue
    }
    const ai = aiAt(s, i)
    if (!ai) break
    i += ai.ai.length
    if (ai.fixed) {
      pairs.push([ai.ai, s.slice(i, i + ai.fixed)])
      i += ai.fixed
    } else {
      const gs = s.indexOf(GS, i)
      const end = gs === -1 ? s.length : gs
      pairs.push([ai.ai, s.slice(i, Math.min(end, i + (ai.max ?? 90)))])
      i = end
    }
  }
  return pairs.length ? pairs : null
}

/** Normalises the ways scanners and apps spell FNC1/GS, and strips GS1 symbology identifiers (]C1, ]d2, ]Q3, ]e0, ]J1). */
function normaliseElement(text: string): { s: string; gs1Marked: boolean } {
  let s = text.trim().replace(/<GS>|\{GS\}|\[GS\]|␝|\\x1d|\\u001d/gi, GS)
  let gs1Marked = false
  const sym = /^\](C1|e0|e1|e2|d2|Q3|J1)/.exec(s)
  if (sym) {
    s = s.slice(sym[0].length)
    gs1Marked = true
  }
  while (s.startsWith(GS)) {
    s = s.slice(1)
    gs1Marked = true
  }
  return { s, gs1Marked: gs1Marked || s.includes(GS) }
}

/** GS1 element string in parenthesised or raw form. Returns null for anything that is not clearly GS1. */
export function parseGs1Element(text: string): Gs1Data | null {
  const { s, gs1Marked } = normaliseElement(text)
  const paren = parseParenthesised(s)
  if (paren) return fromPairs(paren, 'element')
  // Without a symbology identifier or a separator, only accept a string that starts with a valid GTIN,
  // so a plain number (an EAN-13 or a phone number) is not mistaken for GS1 data.
  if (!gs1Marked && !(/^01\d{14}/.test(s) && gtinCheckDigitOk(s.slice(2, 16)))) return null
  if (!/^\d{2}/.test(s)) return null
  const raw = parseRaw(s)
  return raw ? fromPairs(raw, 'element') : null
}

const DL_KEYS: Record<string, string> = { gtin: '01', lot: '10', ser: '21', exp: '17', '01': '01', '10': '10', '21': '21', '17': '17', '11': '11', '15': '15', '22': '22', '235': '235', '240': '240', '241': '241' }

/** GS1 Digital Link: https://any.host/[prefix/]01/{gtin}/10/{batch}/21/{serial}?17=YYMMDD */
export function parseDigitalLink(text: string): Gs1Data | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol)) return null
  const seg = url.pathname.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p)
    } catch {
      return p
    }
  })
  const start = seg.findIndex((p, i) => (p === '01' || p === 'gtin' || p === '02') && /^\d{8,14}$/.test(seg[i + 1] ?? ''))
  if (start === -1) return null
  const pairs: [string, string][] = []
  for (let i = start; i + 1 < seg.length; i += 2) {
    const ai = DL_KEYS[seg[i]!]
    if (!ai) break
    pairs.push([ai, seg[i + 1]!])
  }
  for (const [k, v] of url.searchParams) {
    const ai = DL_KEYS[k.toLowerCase()]
    if (ai && !pairs.some(([a]) => a === ai)) pairs.push([ai, v])
  }
  return fromPairs(pairs, 'digital-link')
}

/** Any GS1 payload: Digital Link URL first, then element strings. */
export function parseGs1(text: string): Gs1Data | null {
  return parseDigitalLink(text) ?? parseGs1Element(text)
}
