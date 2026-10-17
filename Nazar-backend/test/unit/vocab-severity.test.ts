import { describe, expect, it } from 'vitest'

import { scoreSeverity } from '../../src/domain/severity.ts'
import { classifyCategory, classifyFailures, detectForm, isPaediatric } from '../../src/domain/vocab.ts'

describe('classifyFailures', () => {
  it.each([
    ['Dissolution (Levocetirizine Hydrochloride)', 'dissolution'],
    ['Sterility, BET, Acidity/Alkalinity', 'sterility'],
    ['Assay of Dextrose (Anhydrous)', 'assay'],
    ['Contains Diethylene Glycol 48.6% w/v', 'glycol'],
    ['The actual manufacturer has informed that the impugned batch is not manufactured by them', 'spurious'],
    ['Related Substances', 'related_substances'],
    ['Description', 'description'],
  ])('%s -> %s', (reason, want) => expect(classifyFailures(reason)).toContain(want))

  it('falls back to other', () => expect(classifyFailures('Total viable cell count')).toEqual(['other']))
})

describe('classifyCategory', () => {
  it('spurious wins', () => expect(classifyCategory('not manufactured by them; assay')).toBe('spurious'))
  it('glycol is adulterated', () => expect(classifyCategory('DEG 1.34% w/v')).toBe('adulterated'))
  it('misbranded', () => expect(classifyCategory('Misbranded drug')).toBe('misbranded'))
  it('default nsq', () => expect(classifyCategory('Dissolution')).toBe('nsq'))
})

describe('detectForm / isPaediatric', () => {
  it.each([
    ['Dextrose Injection I.P. 5%w/v', 'infusion'],
    ['Ceftriaxone for Injection IP 1g', 'injection'],
    ['Coldrif Syrup', 'syrup'],
    ['Cefixime Oral Suspension I.P.', 'suspension'],
    ['Calcium Carbonate 500 mg Tablets IP', 'tablet'],
    ['Ecoflora Probiotic Capsules', 'capsule'],
    ['Sterile Disposable Syringe With Hypodermic Needle', 'device'],
  ])('%s -> %s', (p, want) => expect(detectForm(p)).toBe(want))

  it('needs an explicit marker for paediatric', () => {
    expect(isPaediatric('Paracetamol Paediatric Oral Suspension')).toBe(true)
    expect(isPaediatric('Cefixime Dry Syrup')).toBe(true)
    expect(isPaediatric('Paracetamol Tablets IP 500mg')).toBe(false)
  })
})

describe('scoreSeverity', () => {
  it('glycol in a paediatric syrup is capped at 5', () => {
    const r = scoreSeverity({ failures: ['glycol'], category: 'adulterated', form: 'syrup', peds: true, product: 'Coldrif' })
    expect(r.severity).toBe(5)
    expect(r.rules[0]).toMatch(/toxic glycol: base 5/)
    expect(r.rules.at(-1)).toMatch(/capped at 5/)
  })
  it('dissolution in a tablet is 2', () => {
    expect(scoreSeverity({ failures: ['dissolution'], category: 'nsq', form: 'tablet', peds: false, product: 'x' }).severity).toBe(2)
  })
  it('injectables get +1', () => {
    const r = scoreSeverity({ failures: ['assay'], category: 'nsq', form: 'infusion', peds: false, product: 'Dextrose' })
    expect(r.severity).toBe(4)
    expect(r.rules).toContain('Injectable: +1')
  })
  it('NTI drug with assay failure gets +1', () => {
    expect(scoreSeverity({ failures: ['assay'], category: 'nsq', form: 'tablet', peds: false, product: 'Digoxin Tablets' }).severity).toBe(4)
  })
  it('spurious category forces base 5 even without the word', () => {
    expect(scoreSeverity({ failures: ['other'], category: 'spurious', form: 'tablet', peds: false, product: 'x' }).severity).toBe(5)
  })
  it('uses the most severe failure listed', () => {
    expect(scoreSeverity({ failures: ['description', 'sterility'], category: 'nsq', form: 'other', peds: false, product: 'x' }).severity).toBe(4)
  })
})
