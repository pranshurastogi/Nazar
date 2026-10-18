import { describe, expect, it } from 'vitest'

import { classifyCategory } from '../../../src/domain/vocab.ts'
import { curated, curatedRows, loadSeedBytes, parseSeed } from '../../../src/sources/curated.ts'

describe('curated COLDRIF seed', () => {
  it('is discovered as one WHO / CDSCO notice', async () => {
    const docs = await curated.discover({ http: undefined as never, limit: 10 })
    expect(docs.filter((d) => d.hints.seed === 'coldrif-2025.json')).toHaveLength(1)
    expect(docs.find((d) => d.hints.seed === 'coldrif-2025.json')).toMatchObject({
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

  it('yields the earlier WHO alerts on Indian-made medicines with exact values', async () => {
    const rowsOf = async (file: string) => curatedRows(parseSeed(await loadSeedBytes(file)), 'f'.repeat(64))
    const gambia = await rowsOf('who-n6-2022-gambia.json')
    expect(gambia.map((r) => [r.batch, r.mfgYm, r.expYm])).toEqual([
      ['ML21-202', 202112, 202411],
      ['ML21-199', 202112, 202411],
      ['ML21-203', 202112, 202411],
      ['ML21-198', 202112, 202411],
    ])
    expect(gambia.every((r) => /Maiden/.test(r.manufacturer!) && classifyCategory(r.reason!) === 'adulterated')).toBe(true)
    const uzbekistan = await rowsOf('who-n1-2023-uzbekistan.json')
    expect(uzbekistan).toHaveLength(21)
    expect(uzbekistan.at(-1)).toMatchObject({ batch: 'DXSH2202', expYm: null })
    expect((await rowsOf('who-n4-2023-guaifenesin.json')).map((r) => [r.batch, r.expYm])).toEqual([['SL-429', 202310]])
    expect((await rowsOf('who-n8-2022-methotrex.json')).map((r) => [r.batch, r.mfgYm, r.expYm])).toEqual([['MTI2101BAQ', 202101, 202212]])
  })

  it('rejects seed names that could leave the seed folder', async () => {
    await expect(loadSeedBytes('../../.env')).rejects.toThrow(/invalid curated seed/)
  })
})
