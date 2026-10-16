// Demo data source. Records mirror the shape the Arkiv-backed source will return,
// but entity keys, wallets and hashes are placeholders until the pipeline is live.

export type Category = 'adulterated' | 'spurious' | 'nsq' | 'misbranded'
export type ResultState = 'flagged' | 'retracted' | 'no_alert' | 'unreadable'

export type Alert = {
  batch: string
  brand: string
  drug: string
  form: string
  manufacturer: string
  category: Category
  failure: string
  severity: 1 | 2 | 3 | 4 | 5
  severityRules: string[]
  peds: boolean
  authority: string
  notice: string
  noticeDate: string
  expiry: string
  entityKey: string
  creator: string
  sourceSha: string
  retraction?: { date: string; reason: string; authority: string }
}

export type CheckResult =
  | { state: 'flagged' | 'retracted'; batch: string; alert: Alert; asOf: Date }
  | { state: 'no_alert'; batch: string; asOf: Date }
  | { state: 'unreadable'; batch: string; suggestion?: string; asOf: Date }

export const CATEGORY_MEANING: Record<Category, string> = {
  adulterated: 'Contains a substance that should not be there.',
  spurious: 'The named company says it never made this batch.',
  nsq: 'Not of Standard Quality: failed a lab test.',
  misbranded: 'The label is wrong or misleading.',
}

const DEMO_KEY = '0x7f3a…c91d'
const DEMO_WALLET = '0x51e0…a2b4'
const DEMO_SHA = '9c2e4b…f07a'

export const ALERTS: Alert[] = [
  {
    batch: 'SR-13',
    brand: 'Coldrif',
    drug: 'Cough syrup',
    form: 'Syrup',
    manufacturer: 'Sresan Pharmaceuticals, Tamil Nadu',
    category: 'adulterated',
    failure: 'Diethylene glycol contamination (48.6%)',
    severity: 5,
    severityRules: ['Adulterated with a toxic glycol: base 5', 'Paediatric syrup: +1 (capped at 5)'],
    peds: true,
    authority: 'Tamil Nadu Drugs Control Department',
    notice: 'Declaration of adulterated drug',
    noticeDate: '2 Oct 2025',
    expiry: 'Apr 2027',
    entityKey: DEMO_KEY,
    creator: DEMO_WALLET,
    sourceSha: DEMO_SHA,
  },
  {
    batch: 'R01GL2523',
    brand: 'Respifresh TR',
    drug: 'Cough syrup',
    form: 'Syrup',
    manufacturer: 'Rednex Pharmaceuticals, Gujarat',
    category: 'adulterated',
    failure: 'Diethylene glycol contamination',
    severity: 5,
    severityRules: ['Adulterated with a toxic glycol: base 5', 'Paediatric syrup: +1 (capped at 5)'],
    peds: true,
    authority: 'State drug regulator notice',
    notice: 'Stop-use notice',
    noticeDate: 'Oct 2025',
    expiry: 'Demo record',
    entityKey: DEMO_KEY,
    creator: DEMO_WALLET,
    sourceSha: DEMO_SHA,
  },
  {
    batch: 'LSL25160',
    brand: 'Relife',
    drug: 'Cough syrup',
    form: 'Syrup',
    manufacturer: 'Shape Pharma, Gujarat',
    category: 'adulterated',
    failure: 'Diethylene glycol contamination',
    severity: 5,
    severityRules: ['Adulterated with a toxic glycol: base 5', 'Paediatric syrup: +1 (capped at 5)'],
    peds: true,
    authority: 'State drug regulator notice',
    notice: 'Stop-use notice',
    noticeDate: 'Oct 2025',
    expiry: 'Demo record',
    entityKey: DEMO_KEY,
    creator: DEMO_WALLET,
    sourceSha: DEMO_SHA,
  },
  {
    batch: 'DEMO-RT1',
    brand: 'Sample Paracetamol 500',
    drug: 'Paracetamol',
    form: 'Tablet',
    manufacturer: 'Example Labs (demo)',
    category: 'nsq',
    failure: 'Dissolution',
    severity: 2,
    severityRules: ['Dissolution failure: base 2'],
    peds: false,
    authority: 'Demo publisher',
    notice: 'Monthly NSQ list (demo)',
    noticeDate: 'Aug 2026',
    expiry: 'Dec 2027',
    entityKey: DEMO_KEY,
    creator: DEMO_WALLET,
    sourceSha: DEMO_SHA,
    retraction: {
      date: 'Sep 2026',
      reason: 'Withdrawn after re-testing on appeal',
      authority: 'Demo publisher',
    },
  },
]

/** Lowercase, separators removed: "SR-13" becomes "sr13". */
export function matchKey(batch: string) {
  return batch.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Folds characters OCR and people commonly confuse: 0/O, 1/I/L, 5/S, 8/B. */
function confusionKey(batch: string) {
  return matchKey(batch).replace(/o/g, '0').replace(/[il]/g, '1').replace(/s/g, '5').replace(/b/g, '8')
}

const BATCH_SHAPE = /^[A-Za-z0-9\-/. ]{2,20}$/

export function checkBatch(input: string): CheckResult {
  const batch = input.trim().toUpperCase()
  const asOf = new Date()

  if (!BATCH_SHAPE.test(batch) || matchKey(batch).length < 2) {
    return { state: 'unreadable', batch, asOf }
  }

  const exact = ALERTS.find((a) => matchKey(a.batch) === matchKey(batch))
  if (exact) {
    return { state: exact.retraction ? 'retracted' : 'flagged', batch: exact.batch, alert: exact, asOf }
  }

  // A look-alike is never shown as a flag; we ask the person to re-read the pack.
  const lookAlike = ALERTS.find((a) => confusionKey(a.batch) === confusionKey(batch))
  if (lookAlike) {
    return { state: 'unreadable', batch, suggestion: lookAlike.batch, asOf }
  }

  return { state: 'no_alert', batch, asOf }
}

export const activeAlerts = ALERTS.filter((a) => !a.retraction)
export const childAlerts = activeAlerts.filter((a) => a.peds)
