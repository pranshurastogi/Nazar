import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ExtractedRow } from '../../../src/domain/types.ts'
import { extractDocument } from '../../../src/extract/index.ts'
import { fixture } from './helpers.ts'

interface Expected {
  rowNo: number
  batch: string
  product?: string
  productContains?: string
  mfgYm?: number | null
  expYm?: number | null
  manufacturer?: string
  manufacturerContains?: string
  reason?: string
  reasonContains?: string
  reportedBy?: string
}

interface Golden {
  fixture: string
  parser: string
  rows: number
  rejected: number[]
  minHighShare: number
  expect: Expected[]
}

const GOLDEN = path.resolve(import.meta.dirname, '../../golden')
const goldens = readdirSync(GOLDEN)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(path.join(GOLDEN, f), 'utf8')) as Golden)

describe.each(goldens)('golden: $fixture', (g) => {
  it('extracts every row with the expected fields', async () => {
    const { doc, bytes } = fixture(g.fixture)
    const res = await extractDocument(doc, bytes, { ocr: false, llm: false })

    expect(res.parser).toBe(g.parser)
    expect(res.method).toBe('text')
    expect(res.rows).toHaveLength(g.rows)
    expect(res.rejected.map((r) => r.rowNo).sort((a, b) => a - b)).toEqual(g.rejected)
    for (const row of res.rows) expect(() => ExtractedRow.parse(row)).not.toThrow()
    expect(new Set(res.rows.map((r) => r.rid)).size).toBe(res.rows.length)

    const high = res.rows.filter((r) => r.confidence >= 0.9).length / res.rows.length
    expect(high).toBeGreaterThanOrEqual(g.minHighShare)

    for (const e of g.expect) {
      const row = res.rows.find((r) => r.batch === e.batch)
      expect(row, `row with batch ${e.batch}`).toBeDefined()
      expect(row!.rowNo).toBe(e.rowNo)
      if (e.product !== undefined) expect(row!.product).toBe(e.product)
      if (e.productContains !== undefined) expect(row!.product).toContain(e.productContains)
      if (e.mfgYm !== undefined) expect(row!.mfgYm).toBe(e.mfgYm)
      if (e.expYm !== undefined) expect(row!.expYm).toBe(e.expYm)
      if (e.manufacturer !== undefined) expect(row!.manufacturer).toBe(e.manufacturer)
      if (e.manufacturerContains !== undefined) expect(row!.manufacturer).toContain(e.manufacturerContains)
      if (e.reason !== undefined) expect(row!.reason).toBe(e.reason)
      if (e.reasonContains !== undefined) expect(row!.reason).toContain(e.reasonContains)
      if (e.reportedBy !== undefined) expect(row!.reportedBy).toBe(e.reportedBy)
    }
  })
})

describe('golden: stability', () => {
  it('produces identical row ids on a re-run', async () => {
    const { doc, bytes } = fixture('cdsco-2025-05-nsq.pdf')
    const a = await extractDocument(doc, bytes, { ocr: false, llm: false })
    const b = await extractDocument(doc, bytes, { ocr: false, llm: false })
    expect(b.rows.map((r) => r.rid)).toEqual(a.rows.map((r) => r.rid))
  })

  it('rejects rows whose batch is "Not mentioned" instead of guessing', async () => {
    const { doc, bytes } = fixture('cdsco-2025-05-nsq.pdf')
    const res = await extractDocument(doc, bytes, { ocr: false, llm: false })
    const r42 = res.rejected.find((r) => r.rowNo === 42)
    expect(r42?.reason).toBe('no batch number on the notice')
    expect(r42?.rawText).toContain('Azithromycin')
  })

  it('honours hints.template', async () => {
    const { doc, bytes } = fixture('cdsco-2025-06-nsq.pdf')
    const res = await extractDocument({ ...doc, hints: { template: 'generic' } }, bytes, { ocr: false, llm: false })
    expect(res.parser).toBe('generic@1')
    expect(res.rows.length).toBeGreaterThan(50)
  })
})
