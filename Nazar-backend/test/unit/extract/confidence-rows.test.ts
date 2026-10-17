import { describe, expect, it } from 'vitest'

import { scoreRow } from '../../../src/extract/confidence.ts'
import { finalize } from '../../../src/extract/rows.ts'
import type { Candidate } from '../../../src/extract/templates/common.ts'

const good = { product: 'Paracetamol Tablets IP 500 mg', batch: 'AB1234', mfgYm: 202401, expYm: 202512, manufacturer: 'M/s. X Ltd., Baddi 173205', reason: 'Dissolution' }

describe('scoreRow', () => {
  it('gives a complete row full confidence', () => {
    expect(scoreRow(good, { expectPin: true, nowYm: 202610 })).toEqual({ confidence: 1, issues: [] })
  })
  it('penalises and explains each problem', () => {
    const s = scoreRow({ ...good, mfgYm: 202601, expYm: 202512, reason: null, manufacturer: 'M/s. X Ltd.' }, { expectPin: true, nowYm: 202610 })
    expect(s.confidence).toBe(0.5)
    expect(s.issues).toEqual(['manufacturing date is not before expiry', 'no failure reason', 'manufacturer address has no PIN code'])
  })
  it('flags dates in the future', () => {
    expect(scoreRow({ ...good, mfgYm: 202801, expYm: 203001 }, { nowYm: 202610 }).issues).toContain('manufacturing date in the future')
  })
})

const cand = (over: Partial<Candidate>): Candidate => ({
  rowNo: 1,
  page: 1,
  product: 'Paracetamol Tablets IP',
  batchCell: 'AB1234',
  mfgRaw: '01/2024',
  expRaw: '12/2025',
  manufacturer: 'M/s. X Ltd., Baddi 173205',
  reason: 'Assay',
  reportedBy: 'CDL, Kolkata',
  rawText: 'raw',
  ...over,
})
const ctx = { sourceSha: 'a'.repeat(64), parser: 'test@1', expectPin: true, methodOf: () => 'text' as const, nowYm: 202610 }

describe('finalize', () => {
  it('splits a multi-batch cell into rows with distinct ids', () => {
    const { rows } = finalize([cand({ batchCell: 'AB101, AB102 & AB103' })], ctx)
    expect(rows.map((r) => r.batch)).toEqual(['AB101', 'AB102', 'AB103'])
    expect(new Set(rows.map((r) => r.rid)).size).toBe(3)
    expect(rows.every((r) => r.rowNo === 1 && r.issues.includes('cell lists 3 batches'))).toBe(true)
  })
  it('rejects missing and implausible batches with a reason', () => {
    const { rows, rejected } = finalize([cand({ batchCell: 'Not mentioned' }), cand({ rowNo: 2, batchCell: 'NIL' }), cand({ rowNo: 3, batchCell: 'ABCDEF' }), cand({ rowNo: 4, batchCell: '05/2025' })], ctx)
    expect(rows).toHaveLength(0)
    expect(rejected.map((r) => r.reason)).toEqual(['no batch number on the notice', 'no batch number on the notice', 'implausible batch "ABCDEF"', 'implausible batch "05/2025"'])
  })
  it('keeps a batch that only looks like a date ("1-3098")', () => {
    const { rows } = finalize([cand({ batchCell: '1-3098' })], ctx)
    expect(rows[0]?.batch).toBe('1-3098')
    expect(rows[0]?.confidence).toBeGreaterThan(0)
  })
  it('numbers rows without a printed serial by position', () => {
    const { rows } = finalize([cand({ rowNo: null }), cand({ rowNo: null, batchCell: 'XY99' })], ctx)
    expect(rows.map((r) => r.rowNo)).toEqual([1, 2])
  })
})
