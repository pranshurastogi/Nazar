import { describe, expect, it } from 'vitest'

import { classify } from '../../../src/extract/classify.ts'
import { extractTable, groupLines, joinLine } from '../../../src/extract/layout.ts'
import { mergeSegments, type PdfPage, type TextItem } from '../../../src/extract/pdf.ts'
import { assignBlocks } from '../../../src/extract/templates/who-annex.ts'

const item = (str: string, x: number, y: number, w = str.length * 4.5, h = 9): TextItem => ({ str, x, y, w, h })

describe('classify', () => {
  it('prefers a valid hint', () => {
    expect(classify({ hints: { template: 'tn-recall' } }, 'anything')).toBe('tn-recall')
    expect(classify({ hints: { template: 'nope' } }, 'Medical Product Alert N°5/2025')).toBe('who-annex')
  })
  it('fingerprints first-page text', () => {
    expect(classify({ hints: {} }, 'DETAILS OF NSQ RECALL- JUNE 2026')).toBe('tn-recall')
    expect(classify({ hints: {} }, 'Tamil Nadu NSQ List - August 2026')).toBe('tn-nsq')
    expect(classify({ hints: {} }, 'Sl. No. Drawn By ... B. No.: T-12701,')).toBe('cdsco-legacy')
    expect(classify({ hints: {} }, 'NOT OF STANDARD QUALITY (NSQ) ALERT ... S.No Batch No.')).toBe('cdsco-modern')
    expect(classify({ hints: {} }, 'Some other table with Batch')).toBe('generic')
  })
})

describe('line helpers', () => {
  it('groups items by baseline and joins with spaces only at gaps', () => {
    const lines = groupLines([item('B', 20, 100.5), item('A', 10, 100), item('C', 10, 120)])
    expect(lines.map((l) => l.text)).toEqual(['A B', 'C'])
    expect(joinLine([item('GTL', 10, 10, 13.5), item('1317', 23.6, 10)])).toBe('GTL1317')
  })
  it('merges touching collinear rule segments', () => {
    expect(mergeSegments([{ at: 10, from: 0, to: 50 }, { at: 10.5, from: 51, to: 90 }, { at: 40, from: 0, to: 90 }])).toEqual([
      { at: 10.25, from: 0, to: 90 },
      { at: 40, from: 0, to: 90 },
    ])
  })
})

describe('extractTable without borders', () => {
  // Header labels centred over left-aligned data, two rows, the second wrapping.
  const page: PdfPage = {
    num: 1,
    width: 600,
    height: 800,
    imageOnly: false,
    rules: { h: [], v: [] },
    items: [
      item('S.No', 20, 100),
      item('Product Name', 90, 100),
      item('Batch No.', 230, 100),
      item('Reason', 330, 100),
      item('1.', 22, 130),
      item('Paracetamol Tablets', 70, 130),
      item('AB101', 220, 130),
      item('Assay', 320, 130),
      item('2.', 22, 160),
      item('Cefixime Tablets', 70, 160),
      item('CF22', 220, 160),
      item('Dissolution', 320, 160),
      item('IP 200 mg', 70, 171),
    ],
  }
  it('derives columns from labels and rows from serial numbers', () => {
    const t = extractTable([page], { isHeader: (s) => /batch/i.test(s) && /s\.no/i.test(s) })
    expect(t.columns.map((c) => c.key)).toEqual(['s.no', 'productname', 'batchno.', 'reason'])
    expect(t.rows.map((r) => [r.sno, ...r.cells])).toEqual([
      [1, '1.', 'Paracetamol Tablets', 'AB101', 'Assay'],
      [2, '2.', 'Cefixime Tablets\nIP 200 mg', 'CF22', 'Dissolution'],
    ])
  })
})

describe('assignBlocks (WHO transposed annex)', () => {
  it('keeps a centred multi-line block together even when its last line is nearer the next label', () => {
    // Labels: API 405, Manufacturer 355, Batch 317 (y grows upward here; only order matters).
    const lines = [417, 405, 392, 380, 368, 355, 343, 331, 317].map((y) => -y)
    const labels = [405, 355, 317].map((y) => -y)
    expect(assignBlocks(lines, labels)).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 2])
  })
})
