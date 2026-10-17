import { i32, key, str, u64 } from '@arkiv-network/sdk/attr'
import { beforeEach, describe, expect, it } from 'vitest'

import { ArkivReader, type ArkivRead } from '../../src/arkiv/reader.ts'
import { PROJECT } from '../../src/arkiv/schema.ts'
import { FakeArkiv } from './reader-fake-arkiv.ts'

const PUB = '0x1111111111111111111111111111111111111111' as const
const EVIL = '0x9999999999999999999999999999999999999999' as const

const alert = (o: { batch: string; sev?: number; peds?: 0 | 1; state?: string; alertYm?: number; expYm?: number; caseId?: string; brand?: string }) => ({
  project: str(PROJECT),
  t: str('alert'),
  v: i32(1),
  batch: str(o.batch),
  batch_raw: str(o.batch.toUpperCase()),
  case: str(o.caseId ?? `case-${o.batch}`),
  rid: str(`rid-${o.batch}`),
  brand: str(o.brand ?? 'coldrif'),
  form: str('syrup'),
  cat: str('adulterated'),
  fail: str('glycol'),
  sev: i32(o.sev ?? 5),
  peds: i32(o.peds ?? 1),
  mfr: str('sresan-pharmaceuticals'),
  ...(o.state ? { state: str(o.state) } : {}),
  exp_ym: i32(o.expYm ?? 202704),
  alert_ym: i32(o.alertYm ?? 202510),
  src: str('who-mpa'),
  juris: str('IN'),
  conf: i32(97),
  method: str('text'),
  tier: str('auto'),
})

describe('ArkivReader', () => {
  let fake: FakeArkiv
  let reader: ArkivReader
  beforeEach(() => {
    fake = new FakeArkiv(PUB)
    reader = new ArkivReader({ publisher: PUB, client: fake as unknown as ArkivRead })
    fake.add(alert({ batch: 'sr13', state: 'IN-TN' }), { product: 'COLDRIF Syrup', reason: 'DEG 48.6%', failures: ['glycol'] })
    fake.add(alert({ batch: 'r01gl2523', state: 'IN-GJ', sev: 4, peds: 0, alertYm: 202509, expYm: 202612, brand: 'respifresh' }))
    fake.add(alert({ batch: 'old1', alertYm: 202301, expYm: 202405, sev: 2, peds: 0 }))
  })

  it('Q1 finds a batch by match key and decodes it', async () => {
    const [a] = await reader.byBatch('SR-13')
    expect(a).toMatchObject({ batchKey: 'sr13', batch: 'SR13', severity: 5, peds: true, state: 'IN-TN', tier: 'auto', creator: PUB })
    expect(a!.payload?.product).toBe('COLDRIF Syrup')
    expect(fake.queries.at(-1)).toBe(`project=${PROJECT} & t=alert & batch=sr13 & $creator=${PUB}`)
  })

  it('ignores look-alike entities written by anyone else', async () => {
    fake.add(alert({ batch: 'sr13' }), {}, EVIL)
    fake.add({ ...alert({ batch: 'zz9' }), project: str('someone-else') })
    expect(await reader.byBatch('SR-13')).toHaveLength(1)
    expect(await reader.byBatch('zz9')).toHaveLength(0)
  })

  it('Q2 active by expiry range, Q3 feed by month and state, Q4 Child Shield', async () => {
    expect((await reader.active({ minExpYm: 202610 })).items.map((a) => a.batchKey).sort()).toEqual(['r01gl2523', 'sr13'])
    expect((await reader.active({ minExpYm: 202610, maxExpYm: 202612 })).items.map((a) => a.batchKey)).toEqual(['r01gl2523'])
    expect((await reader.feed({ sinceYm: 202501, state: 'IN-GJ' })).items.map((a) => a.batchKey)).toEqual(['r01gl2523'])
    expect((await reader.childShield()).items.map((a) => a.batchKey)).toEqual(['sr13'])
  })

  it('paginates with cursors', async () => {
    for (let i = 0; i < 5; i++) fake.add(alert({ batch: `pg${i}`, alertYm: 202601 }))
    const p1 = await reader.feed({ sinceYm: 202601, limit: 2 })
    expect(p1.items).toHaveLength(2)
    expect(p1.cursor).toBeTruthy()
    expect(p1.blockNumber).toBe('42')
    const p2 = await reader.feed({ sinceYm: 202601, limit: 2, cursor: p1.cursor })
    expect(p2.items.map((a) => a.batchKey)).not.toEqual(p1.items.map((a) => a.batchKey))
    expect(await reader.byCase('case-pg1')).toHaveLength(1)
  })

  it('Q6 latest heartbeat, Q7 notices, retractions', async () => {
    fake.add({ project: str(PROJECT), t: str('heartbeat'), v: i32(1), worker: str('nazar'), last_ok: u64(1000n) }, { lastOkMs: 1000, worker: 'nazar', sources: {}, alerts: 0, version: '0.1.0' })
    fake.add({ project: str(PROJECT), t: str('heartbeat'), v: i32(1), worker: str('nazar'), last_ok: u64(2000n) }, { lastOkMs: 2000, worker: 'nazar', sources: {}, alerts: 3, version: '0.1.0' })
    expect((await reader.heartbeat())?.lastOkMs).toBe(2000)

    fake.add({ project: str(PROJECT), t: str('notice'), v: i32(1), src: str('cdsco-pdf'), juris: str('IN'), notice_ym: i32(202509), sha: str('ab'.repeat(32)), rows: i32(40), parser: str('cdsco-modern@1') }, { title: 'NSQ Sep 2025' })
    const n = await reader.notices({ sinceYm: 202501 })
    expect(n.items[0]).toMatchObject({ sha: 'ab'.repeat(32), rows: 40, noticeYm: 202509, sourceId: 'cdsco-pdf' })
    expect(n.items[0]!.payload?.title).toBe('NSQ Sep 2025')

    const [sr] = await reader.byBatch('sr13')
    fake.add({ project: str(PROJECT), t: str('retraction'), v: i32(1), alert: key(sr!.entityKey), case: str('case-sr13'), reason: str('appeal'), src: str('who-mpa') }, { note: 'withdrawn' })
    const r = await reader.retractionsFor([sr!.entityKey, `0x${'33'.repeat(32)}`])
    expect(r.get(sr!.entityKey.toLowerCase())).toMatchObject({ reason: 'appeal', note: 'withdrawn' })
    expect(r.size).toBe(1)
  })
})
