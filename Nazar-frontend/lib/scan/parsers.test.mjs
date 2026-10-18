// Unit tests for the on-device pack parsers. Run: pnpm test:scan  (node --test; Node 24 strips the TypeScript types).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gtinCheckDigitOk, parseDigitalLink, parseGs1, parseGs1Element, parseYymmdd } from './gs1.ts'
import { batchCandidates, hasConfusableChars, isPlausibleBatch, parseBatchUrl, parseLabelDate, parseLabelText } from './labels.ts'

const GS = '\x1d'

test('GS1 parenthesised element string', () => {
  const r = parseGs1('(01)08901234567890(10)SR-13(17)270430')
  assert.equal(r?.form, 'element')
  assert.equal(r?.gtin, '08901234567890')
  assert.equal(r?.batch, 'SR-13')
  assert.deepEqual(r?.expiry, { year: 2027, month: 4, day: 30 })
})

test('GS1 parenthesised batch that itself holds brackets', () => {
  assert.equal(parseGs1('(01)08901234567890(10)(N)25567(17)280100')?.batch, '(N)25567')
  assert.deepEqual(parseGs1('(01)08901234567890(10)(N)25567(17)280100')?.expiry, { year: 2028, month: 1, day: null })
})

test('GS1 raw element string with FNC1 (GS) separators', () => {
  const r = parseGs1Element(`01089012345678901727043010SR-13${GS}21ABC123`)
  assert.equal(r?.gtin, '08901234567890')
  assert.deepEqual(r?.expiry, { year: 2027, month: 4, day: 30 })
  assert.equal(r?.batch, 'SR-13')
  assert.equal(r?.serial, 'ABC123')
})

test('GS1 raw with symbology identifier and leading FNC1, batch before serial', () => {
  const r = parseGs1(`]d2${GS}0108901234567890${GS}10R01GL2523${GS}17261231${GS}21X9`)
  assert.equal(r?.batch, 'R01GL2523')
  assert.deepEqual(r?.expiry, { year: 2026, month: 12, day: 31 })
  assert.equal(r?.serial, 'X9')
})

test('GS1 separators spelled as <GS> by some scanner apps', () => {
  assert.equal(parseGs1('010890123456789010LSL25160<GS>17261231')?.batch, 'LSL25160')
})

test('GS1 Digital Link with expiry in the query', () => {
  const r = parseDigitalLink('https://id.example/01/08901234567890/10/R01GL2523?17=261231')
  assert.equal(r?.form, 'digital-link')
  assert.equal(r?.gtin, '08901234567890')
  assert.equal(r?.batch, 'R01GL2523')
  assert.deepEqual(r?.expiry, { year: 2026, month: 12, day: 31 })
})

test('GS1 Digital Link with a path prefix, encoded batch and serial', () => {
  const r = parseGs1('https://brand.example.in/qr/01/8901234567890/10/SR%2013/21/77?exp=270430')
  assert.equal(r?.gtin, '08901234567890')
  assert.equal(r?.batch, 'SR 13')
  assert.equal(r?.serial, '77')
  assert.deepEqual(r?.expiry, { year: 2027, month: 4, day: 30 })
})

test('GTIN check digit and YYMMDD helpers', () => {
  assert.equal(gtinCheckDigitOk('08901234567890'), true)
  assert.equal(gtinCheckDigitOk('08901234567891'), false)
  assert.equal(parseGs1('(01)08901234567891(10)A1')?.gtinValid, false)
  assert.equal(parseYymmdd('271340'), undefined)
  assert.deepEqual(parseYymmdd('270400'), { year: 2027, month: 4, day: null })
})

test('GS1 rejects plain numbers, words and other URLs', () => {
  assert.equal(parseGs1('8901234567890'), null) // a bare EAN-13 is not an element string
  assert.equal(parseGs1('0123456789'), null)
  assert.equal(parseGs1('hello world'), null)
  assert.equal(parseGs1('https://example.com/about/01/'), null)
  assert.equal(parseGs1(''), null)
})

test('Key-value pack text: B.No., Mfg, Exp', () => {
  assert.deepEqual(parseLabelText('B.No.: LSL25160 Mfg: 01/2025 Exp: 12/2026'), {
    batch: 'LSL25160',
    mfg: { year: 2025, month: 1, day: null },
    expiry: { year: 2026, month: 12, day: null },
  })
})

test('Label variants: Batch No, B. No, Lot, multi-line, month names', () => {
  assert.equal(parseLabelText('BATCH NO. SR-13\nMFG. DATE: MAY 2025\nEXP. DATE: APR 2027').batch, 'SR-13')
  assert.deepEqual(parseLabelText('BATCH NO. SR-13\nMFG. DATE: MAY 2025\nEXP. DATE: APR 2027').expiry, { year: 2027, month: 4, day: null })
  assert.equal(parseLabelText('B. No. R01GL2523 M.D. 01/25 E.D. 12/26').batch, 'R01GL2523')
  assert.deepEqual(parseLabelText('B. No. R01GL2523 M.D. 01/25 E.D. 12/26').expiry, { year: 2026, month: 12, day: null })
  assert.equal(parseLabelText('Lot: (N)25567').batch, '(N)25567')
  assert.equal(parseLabelText('Batch Number - AB1234; Use before Dec.2026').batch, 'AB1234')
  assert.deepEqual(parseLabelText('Batch Number - AB1234; Use before Dec.2026').expiry, { year: 2026, month: 12, day: null })
})

test('OCR misreads in labels still find the batch (B.N0., 8.No)', () => {
  assert.deepEqual(batchCandidates('8.No. SR-13'), ['SR-13'])
  assert.deepEqual(batchCandidates('B.N0: KX2201'), ['KX2201'])
})

test('Mfg. Lic. No. is not taken as a date or a batch', () => {
  const r = parseLabelText('Mfg. Lic. No.: KD-123 B.No.: TX9 Exp: 03/2027')
  assert.equal(r.batch, 'TX9')
  assert.equal(r.mfg, undefined)
  assert.deepEqual(r.expiry, { year: 2027, month: 3, day: null })
})

test('Noise: no label, no batch', () => {
  assert.deepEqual(parseLabelText('Paracetamol Tablets IP 500 mg. Store below 30°C.'), {})
  assert.deepEqual(batchCandidates('Batch size: large'), [])
  assert.deepEqual(batchCandidates('Lotion 100 ml'), [])
  assert.deepEqual(parseLabelText(''), {})
  assert.equal(isPlausibleBatch('12/2026'), false)
  assert.equal(isPlausibleBatch('MFG'), false)
  assert.equal(isPlausibleBatch('SR-13'), true)
})

test('Verification URLs with a batch query parameter', () => {
  assert.deepEqual(parseBatchUrl('https://verify.example.in/p?gtin=08901234567890&Batch_No=SR-13&exp=04%2F2027'), {
    batch: 'SR-13',
    expiry: { year: 2027, month: 4, day: null },
  })
  assert.equal(parseBatchUrl('https://x.example/#lot=ab12')?.batch, 'AB12')
  assert.equal(parseBatchUrl('https://example.com/?q=hello'), null)
  assert.equal(parseBatchUrl('not a url'), null)
})

test('Label dates', () => {
  assert.deepEqual(parseLabelDate('31/12/2026'), { year: 2026, month: 12, day: 31 })
  assert.deepEqual(parseLabelDate('12-26'), { year: 2026, month: 12, day: null })
  assert.deepEqual(parseLabelDate('Sept 2026'), { year: 2026, month: 9, day: null })
  assert.equal(parseLabelDate('13/2026'), undefined)
})

test('Confusable characters are flagged, not changed', () => {
  assert.equal(hasConfusableChars('SR-13'), true)
  assert.equal(hasConfusableChars('AX-77'), false)
})

// ---- Whole-label grammar (pack.ts)
import { detectForm, parseComposition, parseLicence, parseMrp, parsePackLabel, parsePackSize, parseSchedule, stateOf } from './pack.ts'

const DOLO = `Rx
DOLO-650
Paracetamol Tablets IP 650 mg
Each uncoated tablet contains:
Paracetamol IP 650 mg
Excipients q.s.
15 Tablets
Store below 30°C. Keep out of reach of children.
Mfd. by: Micro Labs Limited, 92 Sipcot Industrial Complex,
Hosur 635126, Tamil Nadu
Mfg. Lic. No.: 28/MD/AP/2010/F/R
B.No.: DOBS3975 Mfg. Dt.: 06/2025 Exp. Dt.: 05/2028
M.R.P. Rs. 33.60 (Incl. of all taxes)`

test('Pack label: Dolo 650 strip', () => {
  const p = parsePackLabel(DOLO)
  assert.equal(p.product?.value, 'Paracetamol Tablets IP 650 mg')
  assert.deepEqual(p.composition.map((c) => c.value), ['Paracetamol IP 650 mg'])
  assert.equal(p.form?.value, 'tablet')
  assert.equal(p.packSize?.value, '15 tablets')
  assert.equal(p.manufacturer?.value, 'Micro Labs Limited')
  assert.equal(p.manufacturerState?.value, 'Tamil Nadu')
  assert.match(p.manufacturerAddress?.value ?? '', /Hosur 635126/)
  assert.equal(p.licence?.value, '28/MD/AP/2010/F/R')
  assert.equal(p.mrp?.value, '33.60')
  assert.equal(p.rawText, DOLO)
  assert.ok(p.composition[0].confidence > 0.5 && p.product.confidence > 0 && p.product.confidence <= 1)
})

test('Pack label: syrup with "Each 5 ml contains", combination, Schedule H, marketer + maker', () => {
  const t = `COLDRIF Syrup
Each 5 ml contains:
Paracetamol IP 125 mg
Phenylephrine Hydrochloride IP 5 mg
Chlorpheniramine Maleate IP 2 mg
Flavoured syrup base q.s.
SCHEDULE H PRESCRIPTION DRUG - CAUTION
60 ml
Manufactured by: Sresan Pharmaceutical, No. 787, Bangalore Highway,
Sunguvarchatram, Kancheepuram Dt., Tamil Nadu
Marketed by: Example Health Pvt Ltd, Mumbai, Maharashtra
Mfg Lic No. 1747
Batch No. SR-13 MFD 05/2025 EXP 04/2027 MRP Rs. 72.50`
  const p = parsePackLabel(t)
  assert.equal(p.product?.value, 'COLDRIF Syrup')
  assert.deepEqual(p.composition.map((c) => c.value), ['Paracetamol IP 125 mg', 'Phenylephrine Hydrochloride IP 5 mg', 'Chlorpheniramine Maleate IP 2 mg'])
  assert.equal(p.form?.value, 'syrup')
  assert.equal(p.packSize?.value, '60 ml')
  assert.equal(p.schedule?.value, 'H')
  assert.equal(p.manufacturer?.value, 'Sresan Pharmaceutical')
  assert.equal(p.manufacturerState?.value, 'Tamil Nadu')
  assert.equal(p.marketedBy?.value, 'Example Health Pvt Ltd')
  assert.equal(p.licence?.value, '1747')
  assert.equal(p.mrp?.value, '72.50')
})

test('Pack label: capsule with "eq. to", Schedule H1, 1 x 10 pack, Composition heading', () => {
  const t = `MOXIKIND-CV 625
Composition: Each film coated tablet contains Amoxycillin Trihydrate IP eq. to Amoxycillin 500 mg Potassium Clavulanate Diluted IP eq. to Clavulanic Acid 125 mg
Schedule H1 Drug - Warning
1 x 10 Tablets
Mkt. by: Mankind Pharma Ltd, New Delhi
M.L. 25/UA/2011
M.R.P. ₹ 204.00`
  const p = parsePackLabel(t)
  assert.equal(p.schedule?.value, 'H1')
  assert.equal(p.composition.length, 2)
  assert.match(p.composition[0].value, /Amoxycillin Trihydrate IP 500 mg/)
  assert.match(p.composition[1].value, /Potassium Clavulanate Diluted IP 125 mg/)
  assert.equal(p.packSize?.value, '1 x 10 tablets')
  assert.equal(p.manufacturer?.value, 'Mankind Pharma Ltd')
  assert.equal(p.manufacturerState?.value, 'Delhi')
  assert.equal(p.licence?.value, '25/UA/2011')
  assert.equal(p.mrp?.value, '204.00')
})

test('Pack label pieces and OCR confidence', () => {
  assert.equal(detectForm('Azithromycin Oral Suspension'), 'suspension')
  assert.equal(parsePackSize('Each 5 ml contains Paracetamol 250 mg. 100 ml'), '100 ml')
  assert.equal(parsePackSize('Strip of 10 capsules'), '10 capsules')
  assert.equal(parseMrp('MRP: 45'), '45')
  assert.equal(parseMrp('No price here'), undefined)
  assert.equal(parseSchedule('To be sold by retail on the prescription of a Registered Medical Practitioner only'), 'H')
  assert.equal(parseSchedule('Paracetamol tablets'), undefined)
  assert.equal(parseLicence('Mfg. Lic. No. : G/25/1234'), 'G/25/1234')
  assert.equal(stateOf('Plot 12, Baddi, Distt. Solan (H.P.)'), 'Himachal Pradesh')
  assert.deepEqual(parseComposition('No composition here 500 mg'), [])
  const low = parsePackLabel(DOLO, (v) => (v.includes('Micro') ? 40 : 95))
  assert.equal(low.manufacturer?.confidence, 0.4)
  assert.equal(low.licence?.confidence, 0.85)
})

test('Pack label: noise yields no invented fields', () => {
  const p = parsePackLabel('%%% ~~ 12 34\n')
  assert.deepEqual(p.composition, [])
  assert.equal(p.product, undefined)
  assert.equal(p.manufacturer, undefined)
  assert.equal(p.licence, undefined)
})
