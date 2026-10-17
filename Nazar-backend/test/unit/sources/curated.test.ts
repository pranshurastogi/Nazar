import { describe, expect, it } from 'vitest'

import { classifyCategory } from '../../../src/domain/vocab.ts'
import { curated, curatedRows, loadSeedBytes, parseSeed } from '../../../src/sources/curated.ts'

describe('curated COLDRIF seed', () => {
  it('is discovered as one WHO / CDSCO notice', async () => {
    const docs = await curated.discover({ http: undefined as never, limit: 10 })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      sourceId: 'curated',
      authority: 'WHO / CDSCO',
      jurisdiction: 'IN',
      url: 'https://www.who.int/news/item/13-10-2025-medical-product-alert-n5-2025',
      noticeYm: 202510,
      publishedAt: '2025-10-13',
      hints: { format: 'curated-json', seed: 'coldrif-2025.json', refresh: 'always' },
    })
  })

  it('yields the three batches from WHO alert N°5/2025 with exact values', async () => {
    const seed = parseSeed(await loadSeedBytes('coldrif-2025.json'))
    const rows = curatedRows(seed, 'e'.repeat(64))
    expect(rows.map((r) => [r.batch, r.mfgYm, r.expYm])).toEqual([
      ['SR-13', 202505, 202704],
      ['R01GL2523', 202501, 202612],
      ['LSL25160', 202501, 202612],
    ])
    expect(rows[0]!.manufacturer).toMatch(/^Sresan Pharmaceutical.*Kancheepuram/)
    expect(rows[1]!.manufacturer).toMatch(/^Rednex Pharmaceutical Pvt Ltd.*Ahmedabad.*Gujarat/)
    expect(rows[2]!.manufacturer).toMatch(/^Shape Pharma Pvt\. Ltd\..*Surendranagar Rajkot.*Gujarat/)
    expect(rows.map((r) => /(\d+(?:\.\d+)?)% w\/v/.exec(r.reason!)?.[1])).toEqual(['48.6', '1.34', '0.61'])
    expect(rows.every((r) => r.method === 'curated' && r.confidence === 1 && classifyCategory(r.reason!) === 'adulterated')).toBe(true)
    expect(rows[0]!.rawText).toMatch(/Tamil Nadu .* 2 October 2025/)
    expect(seed.notes).toMatch(/2 October 2025/)
  })

  it('rejects seed names that could leave the seed folder', async () => {
    await expect(loadSeedBytes('../../.env')).rejects.toThrow(/invalid curated seed/)
  })
})
