import { matchKey, confusionKey } from '@/lib/source/match'
import { parseGs1, type CodeDate } from './gs1'
import { batchCandidates, isPlausibleBatch, parseBatchUrl, parseLabelText } from './labels'
import { confidenceOf, type OcrResult } from './ocr'
import { parsePackLabel, type PackLabel } from './pack'

/** Where a read came from. Codes carry error correction; printed text does not. */
export type ReadSource = 'qr' | 'datamatrix' | 'barcode' | 'text'

export type ScanRead = {
  batch?: string
  expiry?: CodeDate
  mfg?: CodeDate
  gtin?: string
  source: ReadSource
  /** What kind of payload the code held, for the "how we read it" line. */
  kind: 'gs1' | 'url' | 'label' | 'bare' | 'ocr'
}

const LINEAR = /code_?128|code_?39|code_?93|codabar|itf|ean|upc|databar/i

export function sourceOfFormat(format: string): ReadSource {
  if (/qr/i.test(format)) return 'qr'
  if (/data_?matrix/i.test(format)) return 'datamatrix'
  return 'barcode'
}

/** Turns one decoded code into a read. Returns null when the code holds nothing about the batch or dates. */
export function interpretCode(text: string, format: string): ScanRead | null {
  const source = sourceOfFormat(format)
  const gs1 = parseGs1(text)
  if (gs1 && (gs1.batch || gs1.expiry || gs1.gtin)) {
    const batch = gs1.batch && isPlausibleBatch(gs1.batch) ? gs1.batch.toUpperCase() : undefined
    return { batch, expiry: gs1.expiry, mfg: gs1.mfg, gtin: gs1.gtin, source, kind: 'gs1' }
  }
  const url = parseBatchUrl(text)
  if (url) return { ...url, source, kind: 'url' }
  const label = parseLabelText(text)
  if (label.batch || label.expiry) return { ...label, source, kind: 'label' }
  // A 1D code that holds only the batch, as some Indian packs print. Long all-digit values are product codes (EAN/GTIN).
  const bare = text.trim()
  if (LINEAR.test(format) && !/^\d{8,}$/.test(bare) && isPlausibleBatch(bare)) return { batch: bare.toUpperCase(), source, kind: 'bare' }
  return null
}

/** Batch from OCR text: only a value printed after a batch label counts; loose words never do. */
export function interpretOcr(text: string): ScanRead | null {
  const label = parseLabelText(text)
  const batch = batchCandidates(text)[0]
  if (!batch && !label.expiry) return null
  return { batch, expiry: label.expiry, mfg: label.mfg, source: 'text', kind: 'ocr' }
}

/** The whole label from one OCR pass: product, composition, maker, licence, MRP, plus batch and dates. */
export function readPack(r: OcrResult): PackLabel {
  const conf = (v: string) => confidenceOf(r, v)
  const pack = parsePackLabel(r.text, conf)
  const label = parseLabelText(r.text)
  const batch = batchCandidates(r.text)[0]
  if (batch) pack.batch = { value: batch, confidence: Math.min(0.9, conf(batch) / 100) }
  if (label.mfg) pack.mfg = { value: label.mfg, confidence: 0.8 }
  if (label.expiry) pack.expiry = { value: label.expiry, confidence: 0.8 }
  return pack
}

/**
 * Two reads disagree when they are different batches, not just an OCR look-alike of the same one
 * (5R-13 vs SR-13 is a misread; SR-13 vs SR-14 is a different pack label).
 */
export function readsDisagree(a: string, b: string): boolean {
  return matchKey(a) !== matchKey(b) && confusionKey(a) !== confusionKey(b)
}

/** Majority vote over the last few frames, so one blurred frame cannot decide a live read. */
export class Vote {
  private reads: { key: string; batch: string }[] = []
  private size: number
  constructor(size = 5) {
    this.size = size
  }
  push(batch: string) {
    this.reads.push({ key: matchKey(batch), batch })
    if (this.reads.length > this.size) this.reads.shift()
  }
  reset() {
    this.reads = []
  }
  get count() {
    return this.reads.length
  }
  /** The most frequent batch and how many of the recent frames agree on it. */
  leader(): { batch: string; votes: number; of: number } | null {
    const tally = new Map<string, { n: number; batch: string }>()
    for (const r of this.reads) tally.set(r.key, { n: (tally.get(r.key)?.n ?? 0) + 1, batch: r.batch })
    let best: { n: number; batch: string } | null = null
    for (const t of tally.values()) if (!best || t.n > best.n) best = t
    return best ? { batch: best.batch, votes: best.n, of: this.size } : null
  }
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatCodeDate(d: CodeDate): string {
  return `${d.day ? d.day + ' ' : ''}${MONTH[d.month - 1]} ${d.year}`
}

/** A month-only expiry runs to the end of that month. */
export function isExpired(d: CodeDate, now = new Date()): boolean {
  const end = d.day ? new Date(d.year, d.month - 1, d.day, 23, 59, 59) : new Date(d.year, d.month, 0, 23, 59, 59)
  return end.getTime() < now.getTime()
}
