import { describe, expect, it } from 'vitest'

import { caseIdFor, tierFor } from '../../src/resolve/case.ts'
import { splitDrug } from '../../src/resolve/drug.ts'
import { resolveRows } from '../../src/resolve/index.ts'
import { extractPin, parseManufacturer, stateFromPin } from '../../src/resolve/manufacturer.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'

describe('splitDrug', () => {
  it('reads a bracketed brand after the generic name', () => {
    expect(splitDrug('Calcium Carbonate … Tablets IP (CALXIA-500)')).toEqual({ brand: 'CALXIA-500', generic: 'Calcium Carbonate … Tablets IP', hasBrand: true })
    expect(splitDrug('Telmisartan 40 mg and Amlodipine 5mg tablets IP (TELMA AM)').brand).toBe('TELMA AM')
  })
  it('does not mistake a strength or pharmacopoeia mark for a brand', () => {
    expect(splitDrug('Paracetamol Tablets IP (500 mg)').hasBrand).toBe(false)
    expect(splitDrug('Ceftriaxone for Injection (I.P.)').hasBrand).toBe(false)
  })
  it('uses the Tamil Nadu "Brand Name" column when present', () => {
    expect(splitDrug('Paracetamol Tablets IP 500 mg', 'Brand Name: DOLO 650 | NSQ')).toMatchObject({ brand: 'DOLO 650', generic: 'Paracetamol Tablets IP 500 mg' })
  })
  it('treats a shouted brand-only line as a brand with no generic', () => {
    expect(splitDrug('COLDRIF Syrup')).toEqual({ brand: 'COLDRIF', generic: null, hasBrand: true })
  })
  it('never invents a brand for a generic description', () => {
    expect(splitDrug('Albendazole Tablets IP 400mg')).toMatchObject({ hasBrand: false, generic: 'Albendazole Tablets IP 400mg' })
    expect(splitDrug('Disodium Hydrogen Citrate').hasBrand).toBe(false)
  })
})

describe('parseManufacturer', () => {
  it('normalises the firm, PIN, state and plant id', () => {
    const m = parseManufacturer('M/s. Sresan Pharmaceuticals Pvt. Ltd., No. 787, Bangalore Highway, Sunguvarchathiram, Kancheepuram-602106, Tamil Nadu')
    expect(m).toMatchObject({ name: 'Sresan Pharmaceuticals Pvt Ltd', key: 'sresan-pharmaceuticals', pin: '602106', state: 'IN-TN', plantId: 'sresan-pharmaceuticals-602106' })
  })
  it('makes Pvt/Ltd variants meet at one key', () => {
    const a = parseManufacturer('Nikvin Healthcare (I) Pvt. Ltd., Baddi (H.P)-173205')
    const b = parseManufacturer('M/S NIKVIN HEALTHCARE PRIVATE LIMITED, Vill. Katha, Baddi 173205')
    expect(a?.key).toBe('nikvin-healthcare')
    expect(b?.key).toBe('nikvin-healthcare')
    expect(a?.plantId).toBe(b?.plantId)
  })
  it('splits firms without a legal suffix from the address', () => {
    expect(parseManufacturer('Hind Pharma.  11-G, Industrial Area, Govindpura, Bhopal-462022. M.P. India')).toMatchObject({ name: 'Hind Pharma', state: 'IN-MP', pin: '462022' })
    expect(parseManufacturer('SVR Healthcare Vill. Barotiwala, Paonta Sahib, Distt Sirmaur')).toMatchObject({ name: 'SVR Healthcare', pin: null, state: 'IN-HP', plantId: null })
  })
  it('returns null for placeholders', () => {
    expect(parseManufacturer('Under Investigation')).toBeNull()
    expect(parseManufacturer(null)).toBeNull()
  })
  it('maps PIN prefixes to ISO states', () => {
    expect(stateFromPin('602106')).toBe('IN-TN')
    expect(stateFromPin('382213')).toBe('IN-GJ')
    expect(stateFromPin('401404')).toBe('IN-MH')
    expect(stateFromPin('500001')).toBe('IN-TS')
    expect(stateFromPin('560001')).toBe('IN-KA')
    expect(stateFromPin('682001')).toBe('IN-KL')
    expect(stateFromPin('110001')).toBe('IN-DL')
    expect(stateFromPin('249403')).toBe('IN-UK')
    expect(stateFromPin('226008')).toBe('IN-UP')
    expect(stateFromPin('403722')).toBe('IN-GA')
    expect(stateFromPin('834001')).toBe('IN-JH')
    expect(stateFromPin('800001')).toBe('IN-BR')
    expect(stateFromPin('012345')).toBeNull()
    expect(extractPin('Jind-126102 (Haryana), Tel 01681-123456')).toBe('126102')
  })
})

describe('tiers', () => {
  it('follows the confidence bands', () => {
    expect(tierFor(0.95, false)).toBe('auto')
    expect(tierFor(0.9, false)).toBe('auto')
    expect(tierFor(0.75, true)).toBe('machine_read')
    expect(tierFor(0.4, true)).toBe('drug_level')
    expect(tierFor(0.4, false)).toBe('curator_only')
  })
})

describe('resolveRows', () => {
  const doc = rawDoc()
  it('builds notice + alerts with severity, state and plant', () => {
    const rows = [
      row(doc, 1),
      row(doc, 2, { product: 'COLDRIF Syrup (paediatric)', batch: 'SR-13', reason: 'Diethylene glycol 48.6% w/v', manufacturer: 'Sresan Pharmaceuticals, Kancheepuram-602106' }),
    ]
    const { notice, alerts, curator } = resolveRows(doc, rows)
    expect(notice).toMatchObject({ sha: doc.sha256, noticeYm: 202509, rows: 2, parser: 'test@1', sourceId: 'cdsco-pdf' })
    expect(curator).toHaveLength(0)
    const sr = alerts.find((a) => a.batch === 'SR-13')!
    expect(sr).toMatchObject({ batchKey: 'sr13', category: 'adulterated', severity: 5, peds: true, state: 'IN-TN', manufacturerRole: 'maker', tier: 'auto', alertYm: 202509 })
    expect(sr.failures).toContain('glycol')
    const pt = alerts.find((a) => a.batch === 'PT1001')!
    expect(pt).toMatchObject({ state: 'IN-HP', plantId: 'example-pharma-173205', generic: 'Paracetamol Tablets IP 500 mg', form: 'tablet', severity: 2 })
  })

  it('marks spurious makers as label claims', () => {
    const sp = rawDoc({ title: 'Spurious drugs August 2026', hints: { category: 'spurious' } })
    const { alerts } = resolveRows(sp, [
      row(sp, 1, { product: 'Telmisartan 40 mg tablets IP (TELMA AM)', reason: 'Identification of Amlodipine', manufacturer: 'Glenmark Pharmaceuticals Ltd., Baddi 173205' }),
    ])
    expect(alerts[0]).toMatchObject({ category: 'spurious', manufacturerRole: 'label_claim', severity: 5, brand: 'TELMA AM' })
    expect(alerts[0]!.failures[0]).toBe('spurious')
  })

  it('routes low-confidence rows to the curator, never as batch alerts', () => {
    const { alerts, curator } = resolveRows(doc, [
      row(doc, 1, { confidence: 0.5, issues: ['batch cell split over two lines'] }),
      row(doc, 2, { confidence: 0.5 }),
      row(doc, 3, { confidence: 0.7 }),
    ])
    expect(alerts.map((a) => a.tier)).toEqual(['machine_read'])
    expect(curator.map((a) => a.tier).sort()).toEqual(['curator_only', 'drug_level'])
  })

  it('joins the same batch across notices into one case, and keeps other firms apart', () => {
    const cdsco = rawDoc({ title: 'CDSCO NSQ October 2025', noticeYm: 202510 })
    const tn = rawDoc({ title: 'TN NSQ list October 2025', sourceId: 'tn-dc', jurisdiction: 'IN-TN' })
    const a = resolveRows(cdsco, [row(cdsco, 4, { product: 'COLDRIF Syrup', batch: 'SR-13' })]).alerts[0]!
    const b = resolveRows(tn, [row(tn, 9, { product: 'Coldrif syrup (COLDRIF)', batch: 'sr 13' })]).alerts[0]!
    expect(a.rid).not.toBe(b.rid)
    expect(a.caseId).toBe(b.caseId)
    expect(a.caseId).toBe(caseIdFor('sr13', 'b:coldrif'))
    const other = resolveRows(tn, [row(tn, 10, { product: 'Paracetamol Tablets IP', batch: 'SR-13', manufacturer: 'Other Labs Ltd, Hyderabad 500001' })]).alerts[0]!
    expect(other.caseId).not.toBe(a.caseId)
  })

  it('is deterministic', () => {
    const rows = [row(doc, 1), row(doc, 2)]
    expect(resolveRows(doc, rows)).toEqual(resolveRows(doc, rows))
  })
})

describe('splitDrug: brand before an ingredient bracket', () => {
  it('reads WHO annex products', async () => {
    const { splitDrug } = await import('../../src/resolve/drug.ts')
    const d = splitDrug('COLDRIF (paracetamol, chlorpheniramine maleate, phenylephrine, sodium citrate)')
    expect(d).toMatchObject({ brand: 'COLDRIF', hasBrand: true })
    expect(d.generic).toMatch(/paracetamol/)
  })
})
