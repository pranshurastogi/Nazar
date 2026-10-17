import { describe, expect, it } from 'vitest'

import { batchText, findPin, firmName, flat, isMissing, normaliseDate, parseCombined } from '../../../src/extract/grammar.ts'

describe('flat / batchText', () => {
  it('joins wrapped lines, keeping hyphenated words whole', () => {
    expect(flat('Pantoprazole Gastro-\nResistant Tablets')).toBe('Pantoprazole Gastro-Resistant Tablets')
    expect(flat('Injection 30 ml (WA-PLEX\n)')).toBe('Injection 30 ml (WA-PLEX)')
  })
  it('rejoins batch cells split by layout', () => {
    expect(batchText('RUM241100\n2')).toBe('RUM2411002')
    expect(batchText('1 - 3098')).toBe('1-3098')
    expect(batchText('SC27/048M/\n24')).toBe('SC27/048M/24')
  })
  it('recognises missing values', () => {
    expect(isMissing('Not\nmentioned')).toBe(true)
    expect(isMissing('NM')).toBe(true)
    expect(isMissing('GTL1317')).toBe(false)
  })
})

describe('normaliseDate', () => {
  it('parses the forms seen on notices', () => {
    expect(normaliseDate('12/2024').ym).toBe(202412)
    expect(normaliseDate('08/25').ym).toBe(202508)
    expect(normaliseDate('Apr--2026').ym).toBe(202604)
    expect(normaliseDate('Jul-2024').ym).toBe(202407)
    expect(normaliseDate('12-2024').ym).toBe(202412)
    expect(normaliseDate('11/2016,').ym).toBe(201611)
    expect(normaliseDate('Mfg dt: 11/2016').ym).toBe(201611)
    expect(normaliseDate('NM').ym).toBeNull()
  })
  it('derives expiry from a stated shelf life', () => {
    expect(normaliseDate('3 years from Manufacturing', 202602)).toEqual({ ym: 202901, derived: true })
    expect(normaliseDate('After 3 years of Mfg', 202510)).toEqual({ ym: 202809, derived: true })
    expect(normaliseDate('3 years from Manufacturing').ym).toBeNull()
  })
})

describe('findPin / firmName', () => {
  it('finds 6-digit PINs, also when printed with a space', () => {
    expect(findPin('Amritsar 143 001')).toBe('143001')
    expect(findPin('Haridwar249403 (U.K)')).toBe('249403')
    expect(findPin('Plot No. 611, 612, Dahod - 389151, Gujarat.')).toBe('389151')
    expect(findPin('Tiruchirapalli - 102.')).toBeNull()
  })
  it('takes the firm after M/s up to the first comma', () => {
    expect(firmName('M/s. Gidsha Pharmaceuticals, Plot No. 611')).toBe('Gidsha Pharmaceuticals')
    expect(firmName('Mfg. by- M/s Syndicate Pharma, 185/B-1')).toBe('Syndicate Pharma')
    expect(firmName('Danish Health care (P) Ltd., 76/27-29')).toBe('Danish Health care (P) Ltd')
  })
})

describe('parseCombined', () => {
  it('splits the legacy four-in-one cell', () => {
    const [b] = parseCombined('B. No.: T-12701,\nMfg dt: 11/2016,\nExp dt: 10/2018,\nMfd by: M/s. Jackson\nLaboratories Pvt. Ltd., 22-24,\nMajitha Road, Bye Pass,\nAmritsar 143 001')
    expect(b).toEqual({
      batch: 'T-12701',
      mfg: '11/2016',
      exp: '10/2018',
      manufacturer: 'M/s. Jackson Laboratories Pvt. Ltd., 22-24, Majitha Road, Bye Pass, Amritsar 143 001',
    })
  })
  it('returns one block per "B. No." in a kit row', () => {
    const blocks = parseCombined('B. No.: A016002A, Mfg dt: 01/2016, Exp dt: 12/2017, Mfd by: M/s. ANG, Solan B. No.: SIB-004, Mfg dt: 01/2016, Exp dt: 12/2018, Mfd by: M/s. Omar Healthcare')
    expect(blocks.map((b) => b.batch)).toEqual(['A016002A', 'SIB-004'])
    expect(blocks[1]!.exp).toBe('12/2018')
  })
})
