import { describe, expect, it } from 'vitest'

import { cleanBatch, confusionKey, isPlausibleBatch, matchKey, splitBatches, stripBatchLabel } from '../../src/domain/batch.ts'

describe('matchKey', () => {
  it('lowercases and strips separators', () => {
    expect(matchKey('SR-13')).toBe('sr13')
    expect(matchKey(' t/2301. ')).toBe('t2301')
    expect(matchKey('R01GL2523')).toBe('r01gl2523')
  })
  it('agrees for the same batch written differently', () => {
    expect(matchKey('SR 13')).toBe(matchKey('sr-13'))
  })
})

describe('confusionKey', () => {
  it('folds look-alike characters', () => {
    expect(confusionKey('5R-13')).toBe(confusionKey('SR-13'))
    expect(confusionKey('B0L1')).toBe(confusionKey('8OI1'))
  })
  it('does not change the exact key', () => {
    expect(matchKey('5R-13')).not.toBe(matchKey('SR-13'))
  })
})

describe('cleanBatch', () => {
  it.each([
    ['B. No.: T-12701,', 'T-12701'],
    ['Batch No. GTL1317', 'GTL1317'],
    ['Lot: ab12', 'AB12'],
    ['  sr–13 ', 'SR-13'],
  ])('%s -> %s', (raw, want) => expect(cleanBatch(raw)).toBe(want))

  it.each(['N.A.', 'NA', 'nil', '--', 'Not mentioned', ''])('rejects %s', (raw) => expect(cleanBatch(raw)).toBeNull())
})

describe('isPlausibleBatch', () => {
  it.each(['SR-13', 'GTL1317', '585', 'LC26A044H', 'T/2301', '1-3098'])('accepts %s', (b) => expect(isPlausibleBatch(b)).toBe(true))
  it.each(['AB', '05/2025', 'CAPSULES', 'X'.repeat(30), '12/26'])('rejects %s', (b) => expect(isPlausibleBatch(b)).toBe(false))
})

describe('splitBatches', () => {
  it('splits comma and ampersand lists', () => {
    expect(splitBatches('AB101, AB102 & AB103')).toEqual(['AB101', 'AB102', 'AB103'])
  })
  it('keeps a slash that is part of one batch', () => {
    expect(splitBatches('T/2301')).toEqual(['T/2301'])
  })
  it('splits slash lists only when each part is a batch', () => {
    expect(splitBatches('KT2301/KT2302')).toEqual(['KT2301', 'KT2302'])
  })
  it('dedupes by match key', () => {
    expect(splitBatches('SR-13, SR13')).toEqual(['SR-13'])
  })
})

describe('stripBatchLabel', () => {
  it('drops the label people copy from the pack', () => {
    for (const [typed, batch] of <[string, string][]>[['B.No. SR-13', 'SR-13'], ['B.No.SR-13', 'SR-13'], ['b.no sr-13', 'sr-13'], ['Batch No: SR-13', 'SR-13'], ['Batch Number: X-1', 'X-1'], ['BNo SR-13', 'SR-13'], ['LOT SR-13', 'SR-13'], ['Lot No. AB1234', 'AB1234'], ['B. No.: TG25-2281A', 'TG25-2281A']]) {
      expect(stripBatchLabel(typed), typed).toBe(batch)
    }
  })
  it('leaves real batches that start with the same letters alone', () => {
    for (const b of ['BNO123', 'LOT7A', 'BATCH12', 'SR-13', 'B12']) expect(stripBatchLabel(b)).toBe(b)
  })
})

