// Turns a photo read (codes + Pack Reader) into pre-filled cabinet fields, each with where it came
// from, and merges an AI guess into them without overwriting anything the label read well or the
// person typed. Pure: no React, no network.

import { NAME_MAX } from '@/lib/cabinet'
import type { IdentifyHints, IdentifyResult } from '@/lib/source/api'
import { genericOf } from '@/lib/scan/pack'
import type { PhotoRead } from '@/lib/scan/photo'
import type { ReadSource } from '@/lib/scan/read'

export type FieldKey = 'name' | 'batch' | 'expiry' | 'composition' | 'maker'
export type Values = Record<FieldKey, string>

/** Where a pre-filled value came from. Confidence for the label is 0-1. */
export type Source =
  | { kind: 'label'; confidence: number }
  | { kind: 'code'; from: ReadSource }
  | { kind: 'ai'; quote?: string; confidence: IdentifyResult['confidence'] }

export type Sources = Partial<Record<FieldKey, Source>>

export type PhotoPrefill = {
  values: Partial<Values>
  sources: Sources
  /** The generic line printed under the brand ("Paracetamol Tablets IP 650 mg"), shown beneath the name. */
  generic?: string
  /** OCR text, the only thing an AI guess may send. */
  text: string
  hints: IdentifyHints
  mismatch?: { code: string; printed: string }
  /** The name is missing or poorly read, or the batch is missing or poorly read. */
  weak: boolean
  /** Nothing at all could be read. */
  empty: boolean
}

export type Suggestion = { field: FieldKey; value: string; quote?: string }

/** Below this a label read is shown as "check this" and an AI guess may replace it. */
export const LOW = 0.6

const ym = (d: { year: number; month: number } | undefined) => (d ? `${d.year}-${String(d.month).padStart(2, '0')}` : undefined)
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export const isLow = (s: Source | undefined) => s?.kind === 'label' && s.confidence < LOW

export function isWeak(values: Partial<Values>, sources: Sources) {
  return !values.name?.trim() || isLow(sources.name) || !values.batch?.trim() || isLow(sources.batch)
}

export function fromPhoto(read: PhotoRead): PhotoPrefill {
  const { pack, code } = read
  const values: Partial<Values> = {}
  const sources: Sources = {}
  const put = (k: FieldKey, v: string | undefined, s: Source) => {
    const t = v?.trim()
    if (!t) return
    values[k] = t
    sources[k] = s
  }
  const label = (confidence: number): Source => ({ kind: 'label', confidence: Math.max(0, Math.min(1, confidence)) })

  // People know a medicine by its brand ("DOLO-650"), so the brand is the name; the generic line shows beneath it.
  const nameField = pack?.brand ?? pack?.product
  if (nameField) put('name', nameField.value.slice(0, NAME_MAX), label(nameField.confidence))
  const generic = pack?.brand ? genericOf(pack) : undefined
  // A code is error-corrected: its batch and expiry win over the printed text.
  if (code?.batch) put('batch', code.batch, { kind: 'code', from: code.source })
  else if (pack?.batch) put('batch', pack.batch.value, label(pack.batch.confidence))
  if (code?.expiry) put('expiry', ym(code.expiry), { kind: 'code', from: code.source })
  else if (pack?.expiry) put('expiry', ym(pack.expiry.value), label(pack.expiry.confidence))
  if (pack?.composition.length) put('composition', pack.composition.map((c) => c.value).join(', '), label(Math.min(...pack.composition.map((c) => c.confidence))))
  if (pack?.manufacturer) put('maker', pack.manufacturer.value, label(pack.manufacturer.confidence))

  const hints: IdentifyHints = {}
  const productHint = [pack?.brand?.value, generic ?? (pack?.brand ? undefined : pack?.product?.value)].filter(Boolean).join(' ')
  if (productHint) hints.product = productHint
  if (values.batch) hints.batch = values.batch
  if (values.expiry) hints.expiry = values.expiry
  if (pack?.manufacturer) hints.manufacturer = pack.manufacturer.value
  if (pack?.composition.length) hints.composition = pack.composition.map((c) => c.value)

  return {
    values,
    sources,
    ...(generic ? { generic } : {}),
    text: read.text,
    hints,
    ...(read.mismatch ? { mismatch: read.mismatch } : {}),
    weak: isWeak(values, sources),
    empty: !Object.keys(values).length,
  }
}

const EVIDENCE: Record<FieldKey, string[]> = {
  name: ['brand', 'product', 'name'],
  batch: ['batch'],
  expiry: ['expiry', 'exp'],
  composition: ['composition', 'ingredients'],
  maker: ['manufacturer', 'maker'],
}

/** The label text the model quoted for a field, if any. */
export function quoteFor(result: IdentifyResult, field: FieldKey): string | undefined {
  for (const k of EVIDENCE[field]) {
    const e = result.evidence.find((x) => x.field.toLowerCase() === k)
    if (e) return e.quote
  }
  return undefined
}

/** The AI's value for each cabinet field (name prefers the brand, as people say "Dolo", not the generic line). */
export function guessValues(result: IdentifyResult): Partial<Values> {
  const g = result.guess
  const out: Partial<Values> = {}
  const name = g.brand ?? g.product
  if (name) out.name = name.slice(0, NAME_MAX)
  if (g.batch) out.batch = g.batch.toUpperCase()
  if (g.expiry) out.expiry = g.expiry
  if (g.composition.length) out.composition = g.composition.join(', ')
  if (g.manufacturer) out.maker = g.manufacturer
  return out
}

/**
 * Merges an AI guess. A field is filled only when it is empty, or was read from the label with low
 * confidence and the person has not touched it. Anything else that differs becomes a suggestion the
 * person can accept one by one.
 */
export function applyGuess(values: Values, sources: Sources, edited: ReadonlySet<FieldKey>, result: IdentifyResult, only?: readonly FieldKey[]) {
  const next = { ...values }
  const nextSources: Sources = { ...sources }
  const suggestions: Suggestion[] = []
  const filled: FieldKey[] = []
  for (const [field, value] of Object.entries(guessValues(result)) as [FieldKey, string][]) {
    if (only && !only.includes(field)) continue
    const cur = values[field]?.trim() ?? ''
    if (cur && norm(cur) === norm(value)) continue
    const quote = quoteFor(result, field)
    const canFill = !cur || (isLow(sources[field]) && !edited.has(field))
    if (canFill) {
      next[field] = value
      nextSources[field] = { kind: 'ai', confidence: result.confidence, ...(quote ? { quote } : {}) }
      filled.push(field)
    } else suggestions.push({ field, value, ...(quote ? { quote } : {}) })
  }
  return { values: next, sources: nextSources, suggestions, filled }
}

/** The AI's generic line, when it names more than the brand ("DOLO-650" + "Paracetamol Tablets IP 650 mg"). */
export function aiGeneric(result: IdentifyResult): string | undefined {
  const { brand, product } = result.guess
  if (!product) return undefined
  return genericOf({ brand: brand ? { value: brand, confidence: 1 } : undefined, product: { value: product, confidence: 1 } })
}

/** "Get salts and details" fills these, and only when they are empty. */
export const DETAIL_FIELDS: readonly FieldKey[] = ['composition', 'maker']

/** A name is known but the salts are not: worth offering "Get salts and details" from the label text. */
export const wantsDetails = (values: Partial<Values>, text: string) => !!values.name?.trim() && !values.composition?.trim() && text.trim().length >= 3
