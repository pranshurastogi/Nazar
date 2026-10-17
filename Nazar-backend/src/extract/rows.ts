import { BATCH_SHAPE, cleanBatch, isPlausibleBatch, splitBatches } from '../domain/batch.ts'
import { parseYm } from '../domain/dates.ts'
import type { ExtractedRow, ExtractionResult, ExtractMethod } from '../domain/types.ts'
import { stableId } from '../lib/hash.ts'
import { scoreRow } from './confidence.ts'
import { flat, isMissing, normaliseDate } from './grammar.ts'
import type { Candidate } from './templates/common.ts'

export type Rejected = ExtractionResult['rejected'][number]

export interface FinalizeContext {
  sourceSha: string
  parser: string
  expectPin: boolean
  /** Method per page (text layer or OCR). */
  methodOf: (page: number) => ExtractMethod
  nowYm?: number
}

/**
 * Candidates → rows. One row per batch (a cell can list several); anything without a
 * plausible batch is rejected with a reason, never guessed. Row ids are
 * stableId(sha, rowNo, parser), with a batch index appended for the 2nd+ batch of a row.
 */
export function finalize(candidates: Candidate[], ctx: FinalizeContext): { rows: ExtractedRow[]; rejected: Rejected[] } {
  const rows: ExtractedRow[] = []
  const rejected: Rejected[] = []
  const used = new Set<number>()
  const perRow = new Map<number, number>()
  let next = 1

  for (const c of candidates) {
    let rowNo = c.rowNo !== null && c.rowNo > 0 ? c.rowNo : null
    // Keep printed serials; tables without them (or a block repeating a serial) get positions.
    if (rowNo === null) {
      while (used.has(next)) next++
      rowNo = next
    }
    used.add(rowNo)
    next = Math.max(next, rowNo + 1)

    const reject = (reason: string) => rejected.push({ rowNo, page: c.page, rawText: c.rawText, reason })
    if (!c.batchCell || isMissing(c.batchCell)) {
      reject('no batch number on the notice')
      continue
    }
    const issues = [...(c.issues ?? [])]
    let batches = splitBatches(c.batchCell)
    const dateLike = dateShapedBatch(c.batchCell)
    if (!batches.length && dateLike) {
      batches = [dateLike]
      issues.push('batch is shaped like a date but is not a valid one')
    }
    if (!batches.length) {
      const one = cleanBatch(c.batchCell)
      reject(`implausible batch "${one ?? c.batchCell}"`)
      continue
    }
    if (!c.product) {
      reject('no product name')
      continue
    }
    const mfg = normaliseDate(c.mfgRaw)
    const exp = normaliseDate(c.expRaw, mfg.ym)
    if (exp.derived) issues.push('expiry derived from stated shelf life')
    if (batches.length > 1) issues.push(`cell lists ${batches.length} batches`)

    for (const batch of batches) {
      if (!isPlausibleBatch(batch) && batch !== dateLike) continue
      const k = perRow.get(rowNo) ?? 0
      perRow.set(rowNo, k + 1)
      const score = scoreRow(
        { product: c.product, batch, mfgYm: mfg.ym, expYm: exp.ym, manufacturer: c.manufacturer, reason: c.reason },
        { expectPin: ctx.expectPin, extraIssues: issues, nowYm: ctx.nowYm },
      )
      rows.push({
        rid: stableId(ctx.sourceSha, k === 0 ? rowNo : `${rowNo}.${k}`, ctx.parser),
        sourceSha: ctx.sourceSha,
        rowNo,
        page: c.page,
        product: flat(c.product),
        batch,
        mfgYm: mfg.ym,
        expYm: exp.ym,
        manufacturer: c.manufacturer,
        reason: c.reason,
        reportedBy: c.reportedBy,
        method: ctx.methodOf(c.page),
        parser: ctx.parser,
        confidence: score.confidence,
        issues: score.issues,
        rawText: c.rawText,
      })
    }
  }
  return { rows, rejected }
}

/**
 * isPlausibleBatch treats "1-3098" as a month-year and drops it, but no month-year has
 * year 3098. A cell that only looks like a date, yet is not a valid one, is kept as a
 * batch (with an issue noted) rather than lost.
 */
function dateShapedBatch(cell: string): string | null {
  const b = cleanBatch(cell)
  if (!b || !BATCH_SHAPE.test(b) || !/^\d{1,2}[/.-]\d{2,4}$/.test(b)) return null
  return parseYm(b) === null ? b : null
}
