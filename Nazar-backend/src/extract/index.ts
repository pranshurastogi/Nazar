import { env } from '../config/env.ts'
import type { ExtractionResult, ExtractMethod, RawDoc } from '../domain/types.ts'
import { ExtractionError, errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { classify } from './classify.ts'
import { llmEnabled, recoverRejected } from './llm.ts'
import { ocrImageBytes, ocrPages, rereadBatches } from './ocr.ts'
import { loadPdf, pageText, type PdfPage } from './pdf.ts'
import { finalize } from './rows.ts'
import { TEMPLATES } from './templates/index.ts'

const log = child('extract')

export interface ExtractOptions {
  /** Run OCR on pages without a text layer. Defaults to NAZAR_OCR_ENABLED. */
  ocr?: boolean
  /** Send rejected rows to the grounded LLM fallback. Defaults to NAZAR_LLM_ENABLED (and needs ANTHROPIC_API_KEY). */
  llm?: boolean
}

/**
 * Document → rows. Text layer first; pages that are only an image go through OCR;
 * rows that still fail (no plausible batch) may be retried by the LLM, whose answers
 * are kept only where every value appears in the row's own source text.
 */
export async function extractDocument(doc: RawDoc, bytes: Uint8Array, opts: ExtractOptions = {}): Promise<ExtractionResult> {
  const e = env()
  const warnings: string[] = []
  const ocrOn = opts.ocr ?? e.NAZAR_OCR_ENABLED

  let pages: PdfPage[]
  let destroy = async () => {}
  let pdf: Awaited<ReturnType<typeof loadPdf>>['doc'] | null = null
  if (doc.kind === 'image' || /^image\//.test(doc.contentType)) {
    if (!ocrOn) throw new ExtractionError('Image document needs OCR, which is disabled', { sha: doc.sha256 })
    pages = [await ocrImageBytes(bytes)]
  } else if (doc.kind === 'pdf' || /pdf/.test(doc.contentType)) {
    const loaded = await loadPdf(bytes)
    pages = loaded.pages
    pdf = loaded.doc
    destroy = () => loaded.doc.loadingTask.destroy()
  } else {
    throw new ExtractionError('Only PDF and image documents are extracted here; HTML is parsed by its source adapter', { kind: doc.kind })
  }

  try {
    const scanned = pages.filter((p) => !p.ocr && (p.imageOnly || p.items.length === 0))
    if (scanned.length && pdf) {
      if (ocrOn) {
        const limit = e.NAZAR_OCR_MAX_PAGES
        if (scanned.length > limit) warnings.push(`OCR limited to ${limit} of ${scanned.length} scanned pages`)
        try {
          await ocrPages(pdf, scanned.slice(0, limit))
        } catch (err) {
          warnings.push(`OCR failed: ${errorMessage(err)}`)
          log.warn({ err: errorMessage(err), sha: doc.sha256 }, 'ocr failed')
        }
      } else warnings.push(`${scanned.length} page(s) have no text layer and OCR is disabled`)
    }

    const head = pages.slice(0, 2).map(pageText).join('\n')
    const template = TEMPLATES[classify(doc, head)]
    const parsed = template.parse(pages)
    warnings.push(...parsed.warnings)

    const ocrPagesSet = new Set(pages.filter((p) => p.ocr).map((p) => p.num))
    const methodOf = (n: number): ExtractMethod => (ocrPagesSet.has(n) ? 'ocr' : 'text')
    const ctx = { sourceSha: doc.sha256, parser: template.parser, expectPin: template.expectPin, methodOf }

    // On OCR'd pages, re-read rejected batch cells with a batch-only character set.
    let candidates = parsed.candidates
    if (pdf && ocrPagesSet.size) candidates = await rereadBatches(pdf, candidates, ocrPagesSet, warnings)

    const { rows, rejected } = finalize(candidates, ctx)

    let remaining = rejected
    const llmOn = (opts.llm ?? e.NAZAR_LLM_ENABLED) && llmEnabled(e)
    if (remaining.length && llmOn) {
      try {
        const rec = await recoverRejected(remaining, { ...ctx, startRow: rows.length })
        rows.push(...rec.rows)
        remaining = rec.remaining
        warnings.push(...rec.warnings)
      } catch (err) {
        warnings.push(`LLM fallback failed: ${errorMessage(err)}`)
      }
    }

    const method: ExtractMethod = ocrPagesSet.size ? 'ocr' : 'text'
    log.info({ sha: doc.sha256, parser: template.parser, pages: pages.length, rows: rows.length, rejected: remaining.length }, 'extracted')
    return { sourceSha: doc.sha256, parser: template.parser, method, pages: pages.length, rows, rejected: remaining, warnings }
  } finally {
    await destroy()
  }
}

export { classify } from './classify.ts'
export { loadPdf } from './pdf.ts'
