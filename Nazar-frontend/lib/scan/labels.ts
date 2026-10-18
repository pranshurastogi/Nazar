// Batch, Mfg and Exp from the text on Indian medicine packs: key-value QR payloads ("B.No.: LSL25160 Mfg: 01/2025"),
// verification URLs with a batch query parameter, and OCR of the printed label. Pure and dependency-free so it can
// be unit-tested with `node --test` (see lib/scan/parsers.test.mjs).

export type LabelDate = { year: number; month: number; day: number | null }
export type LabelData = { batch?: string; mfg?: LabelDate; expiry?: LabelDate }

/** Kept identical to BATCH_SHAPE in lib/source/match.ts (this file stays import-free for the node tests). */
const BATCH_SHAPE = /^[A-Za-z0-9\-/. ()]{2,24}$/

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// Labels printed before a batch number. OCR often reads "No" as "N0" and "B" as "8", so both are allowed.
const BATCH_LABEL =
  /(?:\bbatch(?:\s*(?:no|n0|number|num))?|\b[b8]\s?\.\s?n[o0]|\bb\s?n[o0]|\bb\.\s?n|\blot(?:\s*(?:no|n0|number))?)\.?(?![a-z])[\s.,:;#=\-–]*/gi
const BATCH_VALUE = /^[(A-Z0-9][A-Z0-9\-/.()]{1,23}/i
const MFG_LABEL = /\b(?:mfg|mfd|mfgd|manufactured(?:\s+on)?|m\.\s?d|mf)\.?(?:\s*(?:date|dt)\.?)?(?![a-z])[\s.,:;=\-–]*/gi
const EXP_LABEL = /\b(?:exp(?:iry)?|expires?|e\.\s?d|use\s+before|best\s+before)\.?(?:\s*(?:date|dt)\.?)?(?![a-z])[\s.,:;=\-–]*/gi
const DATE_VALUE = /^(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}[/.\-\s]\d{4}|\d{1,2}[/.\-]\d{2}(?!\d)|[a-z]{3,9}[\s.\-'/,]*\d{2,4})/i
const STOP_WORDS = new Set(['mfg', 'mfd', 'exp', 'date', 'no', 'number', 'lot', 'batch', 'dt', 'md', 'ed', 'mrp', 'rs'])

/** A plausible printed batch: the shared shape rule, at least one digit, and not just a date. */
export function isPlausibleBatch(s: string): boolean {
  const v = s.trim()
  if (!BATCH_SHAPE.test(v) || !/\d/.test(v) || v.replace(/[^a-z0-9]/gi, '').length < 2) return false
  if (/^\d{1,2}[/.\-]\d{2,4}$/.test(v) || /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(v)) return false
  return !STOP_WORDS.has(v.toLowerCase())
}

function yearOf(y: string): number {
  const n = Number(y)
  return y.length === 2 ? 2000 + n : n
}

/** "12/2026", "12-26", "DEC 2026", "Dec.26", "31/12/2026" → month and year (day kept when given). */
export function parseLabelDate(token: string): LabelDate | undefined {
  const t = token.trim()
  let m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(t)
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2])
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { year: yearOf(m[3]!), month, day } : undefined
  }
  m = /^(\d{1,2})[/.\-\s](\d{4}|\d{2})$/.exec(t)
  if (m) {
    const month = Number(m[1])
    return month >= 1 && month <= 12 ? { year: yearOf(m[2]!), month, day: null } : undefined
  }
  m = /^([a-z]{3,9})[\s.\-'/,]*(\d{4}|\d{2})$/i.exec(t)
  if (m) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1
    return month ? { year: yearOf(m[2]!), month, day: null } : undefined
  }
  return undefined
}

function cleanBatch(v: string): string {
  let s = v.replace(/[.\-/]+$/, '')
  // An unmatched closing bracket is punctuation around the label, not part of the batch.
  if (s.endsWith(')') && !s.includes('(')) s = s.slice(0, -1)
  return s.toUpperCase()
}

/** Batch numbers that follow a batch label, in reading order. */
export function batchCandidates(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(BATCH_LABEL)) {
    const rest = text.slice(m.index! + m[0].length)
    const v = BATCH_VALUE.exec(rest)?.[0]
    if (!v) continue
    const b = cleanBatch(v)
    if (isPlausibleBatch(b) && !out.includes(b)) out.push(b)
  }
  return out
}

function firstDate(text: string, label: RegExp): LabelDate | undefined {
  for (const m of text.matchAll(label)) {
    const v = DATE_VALUE.exec(text.slice(m.index! + m[0].length))?.[0]
    const d = v ? parseLabelDate(v) : undefined
    if (d) return d
  }
  return undefined
}

/** Key-value text: "B.No.: LSL25160 Mfg: 01/2025 Exp: 12/2026", one field per line or all on one line. */
export function parseLabelText(text: string): LabelData {
  const out: LabelData = {}
  const batch = batchCandidates(text)[0]
  if (batch) out.batch = batch
  const mfg = firstDate(text, MFG_LABEL)
  if (mfg) out.mfg = mfg
  const expiry = firstDate(text, EXP_LABEL)
  if (expiry) out.expiry = expiry
  return out
}

const URL_BATCH = new Set(['batch', 'batchno', 'batchnumber', 'bno', 'bn', 'lot', 'lotno', 'lotnumber'])
const URL_EXP = new Set(['exp', 'expiry', 'expdate', 'expirydate', 'ed'])
const URL_MFG = new Set(['mfg', 'mfd', 'mfgdate', 'mfddate', 'md'])

/** Verification links such as https://verify.example.in/p?gtin=...&batch=SR-13&exp=04/2027 (query or #hash). */
export function parseBatchUrl(text: string): LabelData | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol)) return null
  const params = new URLSearchParams(url.search)
  if (url.hash.includes('=')) new URLSearchParams(url.hash.slice(1)).forEach((v, k) => params.append(k, v))
  const out: LabelData = {}
  params.forEach((v, k) => {
    const key = k.toLowerCase().replace(/[^a-z]/g, '')
    if (URL_BATCH.has(key) && !out.batch && isPlausibleBatch(v)) out.batch = cleanBatch(v.trim())
    else if (URL_EXP.has(key) && !out.expiry) out.expiry = parseLabelDate(v) ?? parseCompactDate(v)
    else if (URL_MFG.has(key) && !out.mfg) out.mfg = parseLabelDate(v) ?? parseCompactDate(v)
  })
  if (!out.expiry) delete out.expiry
  if (!out.mfg) delete out.mfg
  return out.batch || out.expiry || out.mfg ? out : null
}

/** "2026-12", "202612", "261231" (GS1 style) as used in some URL parameters. */
function parseCompactDate(v: string): LabelDate | undefined {
  const t = v.trim()
  let m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(t)
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? { year: Number(m[1]), month: Number(m[2]), day: m[3] ? Number(m[3]) : null } : undefined
  m = /^(20\d{2})(\d{2})$/.exec(t)
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? { year: Number(m[1]), month: Number(m[2]), day: null } : undefined
  m = /^(\d{2})(\d{2})(\d{2})$/.exec(t)
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? { year: 2000 + Number(m[1]), month: Number(m[2]), day: Number(m[3]) || null } : undefined
  return undefined
}

/** Characters printed text is often misread as (0/O, 1/I/L, 5/S, 8/B, 2/Z). Used only to warn, never to change a read. */
export function hasConfusableChars(batch: string): boolean {
  return /[0O1IL5S8B2Z]/i.test(batch) && /[A-Z]/i.test(batch) && /\d/.test(batch)
}
