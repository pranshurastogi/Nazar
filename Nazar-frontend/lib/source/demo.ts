import { confusionKey, matchKey, resolveResult } from './match'
import { noticeOrder } from './map'
import type { Alert, CheckResult } from './types'

// Last-resort demo data, used only when neither the Nazar API nor Arkiv can answer.
// The three cough syrups are the batches named in WHO Medical Product Alert N°5/2025.
// They are not published on Arkiv from here, so there is no entity key or wallet.

const WHO_N5 = {
  authority: 'World Health Organization',
  sourceId: 'who-mpa',
  alertYm: 202510,
  notice: 'Medical Product Alert N°5/2025: Substandard (contaminated) oral liquid medicines',
  noticeDate: '13 Oct 2025',
  noticeOrder: noticeOrder('2025-10-13', null),
  noticeUrl: 'https://www.who.int/news/item/13-10-2025-medical-product-alert-n-5-2025--substandard-(contaminated)-oral-liquid-medicines',
  /** SHA-256 of the alert PDF as fetched by the Nazar pipeline (Nazar-backend/test/fixtures/pdf/who-mpa-2025-n5.pdf). */
  sourceSha: '353dbcd674192bfee9f3621b073d5116cdb89cc78204aa23d6c6f9fb9d1e7a96',
}

const unpublished = {
  entityKey: null,
  txHash: null,
  creator: null,
  explorer: { entity: null, tx: null, creator: null },
  method: 'curated',
  confidence: 1,
  tier: 'auto',
  demo: true,
} as const

const GLYCOL_RULES = ['Adulterated with a toxic glycol: base 5', 'Paediatric syrup: +1 (capped at 5)']

export const DEMO_ALERTS: Alert[] = [
  {
    id: 'demo-sr13',
    batch: 'SR-13',
    brand: 'COLDRIF',
    drug: 'Cough syrup',
    form: 'Syrup',
    manufacturer: 'Sresan Pharmaceutical, Kancheepuram, Tamil Nadu',
    state: 'IN-TN',
    category: 'adulterated',
    failure: 'Diethylene glycol (DEG) 48.6% w/v',
    severity: 5,
    severityRules: GLYCOL_RULES,
    peds: true,
    mfg: 'May 2025',
    expiry: 'Apr 2027',
    ...WHO_N5,
    ...unpublished,
  },
  {
    id: 'demo-r01gl2523',
    batch: 'R01GL2523',
    brand: 'Respifresh TR',
    drug: 'Cough syrup',
    form: 'Syrup',
    manufacturer: 'Rednex Pharmaceutical Pvt Ltd, Ahmedabad, Gujarat',
    state: 'IN-GJ',
    category: 'adulterated',
    failure: 'Diethylene glycol (DEG) 1.34%',
    severity: 5,
    severityRules: GLYCOL_RULES,
    peds: true,
    mfg: 'Jan 2025',
    expiry: 'Dec 2026',
    ...WHO_N5,
    ...unpublished,
  },
  {
    id: 'demo-lsl25160',
    batch: 'LSL25160',
    brand: 'ReLife',
    drug: 'Cough syrup',
    form: 'Syrup',
    manufacturer: 'Shape Pharma Pvt Ltd, Surendranagar, Gujarat',
    state: 'IN-GJ',
    category: 'adulterated',
    failure: 'Diethylene glycol (DEG) 0.61%',
    severity: 5,
    severityRules: GLYCOL_RULES,
    peds: true,
    mfg: 'Jan 2025',
    expiry: 'Dec 2026',
    ...WHO_N5,
    ...unpublished,
  },
  {
    id: 'demo-rt1',
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
    sourceId: 'demo',
    state: null,
    alertYm: 202608,
    notice: 'Monthly NSQ list (demo)',
    noticeDate: 'Aug 2026',
    noticeOrder: noticeOrder(null, 202608),
    noticeUrl: null,
    mfg: null,
    expiry: 'Dec 2027',
    sourceSha: null,
    ...unpublished,
    retraction: {
      date: 'Sep 2026',
      reason: 'Withdrawn after re-testing on appeal',
      authority: 'Demo publisher',
    },
  },
]

export function checkDemo(batch: string): CheckResult {
  const exact = DEMO_ALERTS.filter((a) => matchKey(a.batch) === matchKey(batch))
  const lookAlike = exact.length ? undefined : DEMO_ALERTS.find((a) => confusionKey(a.batch) === confusionKey(batch))?.batch
  return resolveResult(batch, exact, lookAlike, 'demo')
}

export const demoActiveAlerts = () => DEMO_ALERTS.filter((a) => !a.retraction)
