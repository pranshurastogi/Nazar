import { describe, expect, it } from 'vitest'

import { createApp } from '../../src/api/app.ts'
import { buildSnapshot } from '../../src/api/snapshot.ts'
import { confusionKey } from '../../src/domain/batch.ts'
import type { AlertRecord, ExtractedRow, RawDoc } from '../../src/domain/types.ts'
import { resolveRows } from '../../src/resolve/index.ts'
import { RESOLVE_VERSION, migrateResolved, reresolveLedger } from '../../src/resolve/reresolve.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'

const FIRST_SEEN = 'date not published; first seen Oct 2026'
const MAKER = 'Dr. Puri Proprietory Product, Sinnar, Dist -Nashik'

const mhDoc = () =>
  rawDoc({
    title: 'Maharashtra FDA NSQ alerts (as of 2026-10-17)', sourceId: 'mh-fda', jurisdiction: 'IN-MH', authority: 'Food and Drug Administration, Maharashtra',
    noticeYm: 202610, publishedAt: null, kind: 'html', fetchedAt: '2026-10-17T00:00:00.000Z',
  })
const mhRowsFor = (mh: RawDoc): ExtractedRow[] => [
  row(mh, 1, { product: 'Faiza Beauty Cream', batch: 'FZ-1', manufacturer: 'POONIA BROTHERS (PVT) LTD', reason: 'Spurious', issues: [FIRST_SEEN] }),
  row(mh, 2, { product: 'Diabeties -ALL', batch: 'A-1', manufacturer: MAKER, reason: 'Declared as Spurious', issues: [FIRST_SEEN] }),
  row(mh, 3, { product: 'DIABETIES-ALL POWDER', batch: 'A-1', manufacturer: `${MAKER},`, reason: 'Declared as Spurious', issues: [FIRST_SEEN] }),
]

function store(ledger: Ledger, doc: RawDoc, rows: ExtractedRow[]) {
  ledger.upsertDocument(doc)
  ledger.replaceRows(doc.sha256, rows)
  const r = resolveRows(doc, rows)
  ledger.upsertAlerts([...r.alerts, ...r.curator], confusionKey)
  ledger.upsertNotice(r.notice)
  ledger.setDocumentStatus(doc.sha256, 'resolved')
  for (const m of r.merged) ledger.markSuperseded(m.rid, m.into)
  return r
}

/** A ledger as the old resolver left it: no dateKnown/productClass, the repeat listing stored, a label word in the maker. */
function legacyLedger() {
  const ledger = new Ledger(':memory:')
  const mh = mhDoc()
  const rows = mhRowsFor(mh)
  ledger.upsertDocument(mh)
  ledger.replaceRows(mh.sha256, rows)
  ledger.setDocumentStatus(mh.sha256, 'resolved')
  const old = rows.map((r): AlertRecord => {
    const [a] = resolveRows(mh, [r]).alerts
    const { dateKnown: _d, productClass: _p, ...legacy } = a!
    return legacy
  })
  const who = rawDoc({ title: 'WHO Medical Product Alert N°5/2025', sourceId: 'who-mpa', noticeYm: 202510, authority: 'WHO' })
  const whoRows = [row(who, 1, { product: 'COLDRIF', batch: 'SR-13', manufacturer: 'Sresan Pharmaceutical manufacturer, No. 787 Bangalore Highways, Kancheepuram, Dist. 602106', reason: 'Diethylene glycol 48.6% w/v' })]
  ledger.upsertDocument(who)
  ledger.replaceRows(who.sha256, whoRows)
  ledger.setDocumentStatus(who.sha256, 'published')
  const [w] = resolveRows(who, whoRows).alerts
  const { dateKnown: _d, productClass: _p, ...legacyWho } = w!
  ledger.upsertAlerts([...old, { ...legacyWho, manufacturer: 'Sresan Pharmaceutical manufacturer' }], confusionKey)
  // Write the legacy columns as an old deploy would have: every row dated, every row a medicine.
  ledger.db.exec("UPDATE alerts SET date_known = 1, product_class = 'medicine'")
  ledger.markAlertPublished(rows[2]!.rid, `0x${'ab'.repeat(32)}`, `0x${'cd'.repeat(32)}`)
  return { ledger, mh, rows, who }
}

const app = (ledger: Ledger) =>
  createApp({ ledger, reader: null, publisher: null, mode: 'dry-run', chainId: 1, corsOrigins: ['*'], explorerBase: 'https://explorer.test', directory: null, mcp: { proofClient: null } })
const get = async (ledger: Ledger, path: string) => (await app(ledger).request(path)).json()

describe('reresolveLedger (startup migration and `cli reresolve`)', () => {
  it('re-derives dateKnown, productClass and the maker from stored rows, and hides the repeat listing', () => {
    const { ledger, rows } = legacyLedger()
    const report = reresolveLedger(ledger)
    expect(report).toMatchObject({ version: RESOLVE_VERSION, dryRun: false, documents: 2, superseded: 1, manufacturerChanged: 1, undated: 2, notInLedger: 0 })
    expect(report.byClass).toEqual({ cosmetic: 1, medicine: 2 })
    const kept = ledger.alertsByBatchKey('a1').map((r) => r.record)
    expect(kept.map((a) => [a.rid, a.tier, a.supersededBy ?? null])).toEqual(
      expect.arrayContaining([
        [rows[1]!.rid, 'auto', null],
        [rows[2]!.rid, 'curator_only', rows[1]!.rid],
      ]),
    )
    // The hidden copy keeps its entity key: nothing about it changes on chain.
    expect(ledger.alertsByBatchKey('a1').find((r) => r.rid === rows[2]!.rid)?.entityKey).toMatch(/^0x/)
    expect(ledger.alertsByBatchKey('sr13')[0]!.record.manufacturer).toBe('Sresan Pharmaceutical')
    expect(ledger.getKv('migration:resolve')).toBe(RESOLVE_VERSION)
  })

  it('is idempotent, and the startup hook runs once per version', () => {
    const { ledger } = legacyLedger()
    expect(migrateResolved(ledger)?.superseded).toBe(1)
    const snapshot = ledger.db.prepare('SELECT rid, tier, data, date_known, product_class FROM alerts ORDER BY rid').all()
    expect(migrateResolved(ledger)).toBeNull()
    expect(reresolveLedger(ledger)).toMatchObject({ superseded: 0, manufacturerChanged: 0 })
    expect(ledger.db.prepare('SELECT rid, tier, data, date_known, product_class FROM alerts ORDER BY rid').all()).toEqual(snapshot)
  })

  it('--dry-run reports and rolls back', () => {
    const { ledger } = legacyLedger()
    const before = ledger.db.prepare('SELECT rid, tier, data, date_known, product_class FROM alerts ORDER BY rid').all()
    expect(reresolveLedger(ledger, { dryRun: true })).toMatchObject({ dryRun: true, superseded: 1, classBackfilled: 1 }) // the hidden copy is not re-upserted
    expect(ledger.db.prepare('SELECT rid, tier, data, date_known, product_class FROM alerts ORDER BY rid').all()).toEqual(before)
    expect(ledger.getKv('migration:resolve')).toBeUndefined()
  })

  it('classifies alerts that have no stored rows from their own fields', () => {
    const ledger = new Ledger(':memory:')
    const doc = rawDoc()
    const [a] = resolveRows(doc, [row(doc, 1, { product: 'Advanced HAND Sanitizer' })]).alerts
    const { productClass: _p, ...legacy } = a!
    ledger.upsertAlerts([legacy], confusionKey)
    expect(reresolveLedger(ledger)).toMatchObject({ documents: 0, classBackfilled: 1, byClass: { hygiene: 1 } })
    expect(ledger.alertsByBatchKey(a!.batchKey)[0]!.record.productClass).toBe('hygiene')
  })

  it('a re-fetched page hides a repeat listing an earlier run had stored', () => {
    const { ledger, mh, rows } = legacyLedger()
    const again = { ...mh, sha256: 'e'.repeat(64) }
    store(ledger, again, mhRowsFor(again).map((r, i) => ({ ...r, rid: rows[i]!.rid })))
    expect(ledger.alertsByBatchKey('a1').filter((r) => r.record.tier === 'auto')).toHaveLength(1)
  })
})

describe('undated alerts and product class in the API and snapshot', () => {
  function seeded() {
    const ledger = new Ledger(':memory:')
    const mh = mhDoc()
    store(ledger, mh, mhRowsFor(mh))
    const cdsco = rawDoc({ title: 'CDSCO NSQ alert for August 2026', sourceId: 'cdsco-online', noticeYm: 202608, publishedAt: null })
    store(ledger, cdsco, [
      row(cdsco, 1, { product: 'Kojic Acid Glycerin Soap', batch: 'KS-1', reason: 'Spurious' }),
      row(cdsco, 2, { product: 'Paracetamol Tablets IP 500 mg', batch: 'PT-9', reason: 'Dissolution' }),
    ])
    const old = rawDoc({ title: 'CDSCO NSQ alert for June 2025', sourceId: 'cdsco-pdf', noticeYm: 202506 })
    store(ledger, old, [row(old, 1, { product: 'Amoxicillin Capsules IP 500 mg', batch: 'AM-5', reason: 'Assay' })])
    return ledger
  }

  it('lists dated alerts first (newest month first, medicines before cosmetics), then undated ones', async () => {
    const ledger = seeded()
    const body = await get(ledger, '/v1/alerts')
    expect(body.total).toBe(5)
    const items = body.items as { batch: string; dateKnown: boolean; productClass: string; alertYm: number }[]
    expect(items.map((a) => a.batch)).toEqual(['PT-9', 'KS-1', 'AM-5', 'A-1', 'FZ-1'])
    expect(items.map((a) => a.dateKnown)).toEqual([true, true, true, false, false])
    expect(items.find((a) => a.batch === 'KS-1')).toMatchObject({ productClass: 'cosmetic', alertYm: 202608 })
    // High-severity list (Home): spurious undated cosmetics no longer lead it.
    const severe = (await get(ledger, '/v1/alerts?minSeverity=4')).items as { batch: string }[]
    expect(severe.map((a) => a.batch)).toEqual(['KS-1', 'A-1', 'FZ-1'])
    expect(((await get(ledger, '/v1/alerts?minSeverity=4&productClass=medicine')).items as { batch: string }[]).map((a) => a.batch)).toEqual(['A-1'])
    expect((await app(ledger).request('/v1/alerts?productClass=food')).status).toBe(400)
  })

  it('exposes dateKnown and productClass on checks, and fills them in for records stored before the fields existed', async () => {
    const ledger = seeded()
    expect((await get(ledger, '/v1/check?batch=FZ-1')).alerts[0]).toMatchObject({ dateKnown: false, productClass: 'cosmetic' })
    expect((await get(ledger, '/v1/check?batch=PT-9')).alerts[0]).toMatchObject({ dateKnown: true, productClass: 'medicine' })
    expect((await get(ledger, '/v1/check?batch=A-1')).alerts).toHaveLength(1)
    ledger.db.exec("UPDATE alerts SET data = json_remove(data, '$.dateKnown', '$.productClass')")
    expect((await get(ledger, '/v1/check?batch=KS-1')).alerts[0]).toMatchObject({ dateKnown: true, productClass: 'cosmetic' })
  })

  it('appends dateKnown and productClass at the end of each snapshot row (format v1 unchanged)', () => {
    const s = buildSnapshot(seeded())
    expect(s.v).toBe(1)
    expect(s.count).toBe(5)
    for (const rows of Object.values(s.alerts)) for (const r of rows) expect(r).toHaveLength(22)
    expect(s.alerts.fz1![0]!.slice(16, 22)).toEqual([202610, 0, 0, 0, 0, 'cosmetic'])
    expect(s.alerts.pt9![0]!.slice(19)).toEqual([0, 1, 'medicine'])
    expect(s.alerts.a1).toHaveLength(1)
  })

  it('/v1/sources keeps setup details in operatorNote, out of disabledReason', async () => {
    const items = (await get(new Ledger(':memory:'), '/v1/sources')).items as { id: string; enabled: boolean; disabledReason: string | null; operatorNote: string | null }[]
    const tg = items.find((s) => s.id === 'tg-dca')!
    expect(tg).toMatchObject({ enabled: false, disabledReason: expect.stringMatching(/^Paused: /), operatorNote: expect.stringMatching(/NAZAR_SOURCES=tg-dca/) })
    for (const s of items) expect(s.disabledReason ?? '').not.toMatch(/NAZAR_/)
    expect(items.filter((s) => s.enabled).map((s) => s.id)).toEqual(['cdsco-online', 'cdsco-pdf', 'tn-dc', 'mh-fda', 'who-mpa', 'curated'])
  })
})
