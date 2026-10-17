import { describe, expect, it } from 'vitest'

import { endOfYm, findYmInText, formatYm, parseYm } from '../../src/domain/dates.ts'

describe('parseYm', () => {
  it.each([
    ['05/2025', 202505],
    ['5-25', 202505],
    ['12/2027', 202712],
    ['May-2025', 202505],
    ['MAY.25', 202505],
    ['Sept 2024', 202409],
    ['2025-05', 202505],
    ['15.05.2025', 202505],
    ['15/05/25', 202505],
    ['Aug-2017', 201708],
    ['JAN-2019', 201901],
    ['01 Jan 2026', 202601],
  ])('%s -> %i', (raw, want) => expect(parseYm(raw)).toBe(want))

  it.each(['N.A.', '--', '', '3 years', '13/2025', 'Foo-2025', null, undefined])('returns null for %s', (raw) =>
    expect(parseYm(raw as string)).toBeNull(),
  )
})

describe('findYmInText', () => {
  it('reads notice titles', () => {
    expect(findYmInText('CDSCO NSQ ALERT FOR THE MONTH OF June 2025')).toBe(202506)
    expect(findYmInText('STATE NSQ ALERT FOR THE MONTH OF MAY-2025')).toBe(202505)
    expect(findYmInText('List of Drugs Reported to be NSQ for the Month of August 2026')).toBe(202608)
    expect(findYmInText('no date here')).toBeNull()
  })
})

describe('formatYm / endOfYm', () => {
  it('formats', () => expect(formatYm(202704)).toBe('Apr 2027'))
  it('end of month', () => expect(endOfYm(202602).toISOString()).toBe('2026-02-28T23:59:59.000Z'))
})
