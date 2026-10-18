import { createPublicClient } from '@arkiv-network/sdk'
import { i32, key, str, u64 } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { http } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../../src/api/app.ts'
import { ArkivDirectory, EntitiesQuery, baseExpressions, filterExpressions, queryString, sdkSnippet } from '../../src/arkiv/directory.ts'
import type { ArkivRead } from '../../src/arkiv/reader.ts'
import { PROJECT } from '../../src/arkiv/schema.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { FakeArkiv } from './reader-fake-arkiv.ts'

const PUB = '0x1111111111111111111111111111111111111111' as const
const EVIL = '0x9999999999999999999999999999999999999999' as const
const NOTICE = `0x${'ab'.repeat(32)}` as const

const alert = (i: number, o: Partial<{ src: string; sev: number; peds: number; state: string; cat: string; form: string; fail: string; exp: number; alertYm: number; batch: string }> = {}) => ({
  project: str(PROJECT),
  t: str('alert'),
  v: i32(1),
  batch: str(o.batch ?? `b${i}`),
  batch_raw: str((o.batch ?? `b${i}`).toUpperCase()),
  brand: str('coldrif'),
  form: str(o.form ?? 'syrup'),
  cat: str(o.cat ?? 'nsq'),
  fail: str(o.fail ?? 'assay'),
  sev: i32(o.sev ?? 3),
  peds: i32(o.peds ?? 0),
  ...(o.state ? { state: str(o.state) } : {}),
  exp_ym: i32(o.exp ?? 202712),
  alert_ym: i32(o.alertYm ?? 202609),
  src: str(o.src ?? 'cdsco-online'),
  notice: key(NOTICE),
})

const parse = (q: Record<string, string>) => EntitiesQuery.parse(q)

describe('Arkiv directory: filters → Arkiv query', () => {
  it('maps every alert filter onto typed eq/gte/lte predicates in a fixed order', () => {
    const q = parse({ type: 'alert', src: 'tn-dc', state: 'IN-TN', cat: 'spurious', fail: 'glycol', form: 'syrup', sevMin: '4', peds: '1', expFrom: '202610', alertFrom: '202601', alertTo: '202609', batch: 'SR-13', notice: NOTICE })
    const s = queryString(q.type, filterExpressions(q), PUB)
    expect(s).toBe(
      "project = str('nazar-in-batch-alerts') AND t = str('alert') AND batch = str('sr13') AND src = str('tn-dc') AND state = str('IN-TN') AND cat = str('spurious') AND fail = str('glycol') AND form = str('syrup') AND sev >= i32(4) AND peds = i32(1) AND exp_ym >= i32(202610) AND alert_ym >= i32(202601) AND alert_ym <= i32(202609) AND notice = key(" +
        NOTICE +
        `) AND $creator = addr(${PUB})`,
    )
  })

  it('produces exactly the text the SDK builder sends', () => {
    const client = createPublicClient({ chain: tiramisu, transport: http('http://127.0.0.1:9') })
    const q = parse({ sevMin: '2', sevMax: '4', peds: '0', expTo: '202812', notice: NOTICE })
    const f = filterExpressions(q)
    const built = client.select().where([...baseExpressions('alert'), ...f]).createdBy(PUB).toString()
    expect(queryString('alert', f, PUB)).toBe(built)
  })

  it('collapses an exact severity to eq and drops no-op bounds', () => {
    expect(filterExpressions(parse({ sevMin: '5', sevMax: '5' })).map(String)).toEqual(['sev = i32(5)'])
    expect(filterExpressions(parse({ sevMin: '1', sevMax: '5' }))).toEqual([])
  })

  it('supports notice filters and nothing else for heartbeats', () => {
    expect(filterExpressions(parse({ type: 'notice', src: 'cdsco-pdf', noticeYm: '202506' })).map(String)).toEqual(["src = str('cdsco-pdf')", 'notice_ym = i32(202506)'])
    expect(filterExpressions(parse({ type: 'heartbeat' }))).toEqual([])
  })

  it('emits a runnable SDK snippet with the matching imports and the pinned next page', () => {
    const q = parse({ sevMin: '4', notice: NOTICE })
    const code = sdkSnippet('alert', filterExpressions(q), PUB, 25)
    expect(code).toContain("import { i32, key, str } from '@arkiv-network/sdk/attr'")
    expect(code).toContain("import { eq, gte } from '@arkiv-network/sdk/query'")
    expect(code).toContain("gte('sev', i32(4)),")
    expect(code).toContain(`eq('notice', key('${NOTICE}')),`)
    expect(code).toContain(`.createdBy('${PUB}')`)
    expect(code).toContain('.atBlock(page.blockNumber).cursor(page.cursor)')
  })

  it('rejects bad input with field-level issues', () => {
    const bad = (q: Record<string, string>) => EntitiesQuery.safeParse(q)
    expect(bad({ sevMin: '9' }).success).toBe(false)
    expect(bad({ cat: 'poison' }).success).toBe(false)
    expect(bad({ expFrom: '202613' }).success).toBe(false)
    expect(bad({ notice: '0x1234' }).success).toBe(false)
    expect(bad({ sevMin: '4', sevMax: '2' }).success).toBe(false)
    expect(bad({ type: 'heartbeat', src: 'tn-dc' }).success).toBe(false)
    expect(bad({ type: 'notice', sevMin: '3' }).success).toBe(false)
    expect(bad({ cursor: 'c:25' }).success).toBe(false)
    expect(bad({ unknown: '1' }).success).toBe(false)
    expect(bad({ batch: '-' }).success).toBe(false)
  })
})

describe('Arkiv directory: entities', () => {
  let fake: FakeArkiv
  let dir: ArkivDirectory
  beforeEach(() => {
    fake = new FakeArkiv(PUB)
    for (let i = 0; i < 7; i++) fake.add(alert(i, { sev: 1 + (i % 5), peds: i % 2 }), { product: `Product ${i}` })
    fake.add(alert(99, { sev: 5 }), { product: 'Injected' }, EVIL)
    dir = new ArkivDirectory({ publisher: PUB, client: fake as unknown as ArkivRead })
  })

  it('returns typed attributes, payload, flags and the creator check', async () => {
    const r = await dir.entities(parse({ sevMin: '5' }))
    expect(r.items).toHaveLength(1)
    const e = r.items[0]!
    expect(e).toMatchObject({ type: 'alert', creator: PUB, official: true, payload: { product: 'Product 4' }, flags: { readonly: false, permissionlessExtension: false } })
    expect(e.attributes.find((a) => a.name === 'sev')).toEqual({ name: 'sev', type: 'i32', value: 5 })
    expect(e.attributes.find((a) => a.name === 'notice')).toEqual({ name: 'notice', type: 'key', value: NOTICE })
    expect(e.expiresAtEstimate).toMatch(/^\d{4}-/)
    expect(r.query.string).toContain('$creator = addr(')
    expect(fake.queries.at(-1)).toContain(`$creator=${PUB}`)
  })

  it('pins every later page to the first page’s block, even after the head moves', async () => {
    fake.advance = true
    fake.strictCursor = true
    const p1 = await dir.entities(parse({ limit: '3' }))
    expect(p1.items).toHaveLength(3)
    expect(p1.cursor).toBeTruthy()
    const p2 = await dir.entities(parse({ limit: '3', cursor: p1.cursor!, block: p1.block }))
    const p3 = await dir.entities(parse({ limit: '3', cursor: p2.cursor!, block: p2.block }))
    expect(p2.block).toBe(p1.block)
    expect(p3.items).toHaveLength(1)
    expect(p3.cursor).toBeNull()
    expect(new Set([...p1.items, ...p2.items, ...p3.items].map((e) => e.key)).size).toBe(7)
    expect(fake.fetchLog.slice(1).every((f) => f.atBlock === BigInt(p1.block))).toBe(true)
    expect(fake.head).toBeGreaterThan(BigInt(p1.block))
  })

  it('caches a normalised query for 60 s', async () => {
    let t = 1_000_000
    dir = new ArkivDirectory({ publisher: PUB, client: fake as unknown as ArkivRead, now: () => t })
    await dir.entities(parse({ sevMin: '3', peds: '1' }))
    const again = await dir.entities(EntitiesQuery.parse({ peds: 'true', sevMin: '3' }))
    expect(again.cached).toBe(true)
    expect(fake.fetchLog).toHaveLength(1)
    t += 61_000
    expect((await dir.entities(parse({ sevMin: '3', peds: '1' }))).cached).toBe(false)
    expect(fake.fetchLog).toHaveLength(2)
  })

  it('classifies a 429 as throttled', async () => {
    fake.failNextFetch = Object.assign(new Error('HTTP request failed. Status: 429 ANON_COST_LIMITED'), { status: 429 })
    await expect(dir.entities(parse({}))).rejects.toMatchObject({ code: 'ARKIV_THROTTLED' })
  })
})

describe('Arkiv directory: summary', () => {
  let fake: FakeArkiv
  let t: number
  let dir: ArkivDirectory
  beforeEach(() => {
    fake = new FakeArkiv(PUB)
    t = Date.parse('2026-10-18T00:00:00Z')
    for (let i = 0; i < 450; i++) {
      fake.add(alert(i, { src: i % 3 ? 'cdsco-online' : 'tn-dc', sev: 1 + (i % 5), peds: i % 10 === 0 ? 1 : 0, state: i % 2 ? 'IN-GJ' : undefined, exp: i % 4 ? 202812 : 202509, cat: i % 50 === 0 ? 'spurious' : 'nsq' }))
    }
    fake.add({ project: str(PROJECT), t: str('notice'), v: i32(1), src: str('cdsco-pdf'), notice_ym: i32(202506), sha: str('aa'), rows: i32(12) }, { title: 'NSQ list June 2025', url: 'https://cdsco.gov.in/x.pdf' })
    fake.add({ project: str(PROJECT), t: str('notice'), v: i32(1), src: str('tn-dc'), notice_ym: i32(202608), sha: str('bb'), rows: i32(3) }, { title: 'TN August 2026' })
    fake.add({ project: str(PROJECT), t: str('heartbeat'), v: i32(1), worker: str('nazar'), last_ok: u64(1792305000008n) }, { worker: 'nazar' })
    fake.add({ project: str(PROJECT), t: str('notice'), v: i32(1), src: str('fake'), notice_ym: i32(202608), sha: str('cc'), rows: i32(1) }, {}, EVIL)
    dir = new ArkivDirectory({ publisher: PUB, client: fake as unknown as ArkivRead, now: () => t })
  })

  it('counts everything from Arkiv at one block, walking pinned cursors', async () => {
    fake.advance = true
    fake.strictCursor = true
    const s = await dir.summary()
    expect(s.entities).toEqual({ alert: 450, notice: 2, retraction: 0, heartbeat: 1, snapshot: 0 })
    expect(s.alerts.total).toBe(450)
    expect(s.alerts.bySrc).toEqual({ 'tn-dc': 150, 'cdsco-online': 300 })
    expect(s.alerts.bySev).toEqual({ 1: 90, 2: 90, 3: 90, 4: 90, 5: 90 })
    expect(s.alerts.byState).toEqual({ unknown: 225, 'IN-GJ': 225 })
    expect(s.alerts.byCat).toEqual({ spurious: 9, nsq: 441 })
    expect(s.alerts.peds).toBe(45)
    expect(s.alerts.inDate).toBe(337)
    expect(s.notices.map((n) => n.title)).toEqual(['TN August 2026', 'NSQ list June 2025'])
    expect(s.notices[1]).toMatchObject({ src: 'cdsco-pdf', noticeYm: 202506, rows: 12, sha: 'aa', url: 'https://cdsco.gov.in/x.pdf' })
    expect(s.heartbeat).toMatchObject({ lastOkMs: 1792305000008 })
    expect(s.stale).toBe(false)
    // Three alert pages (200 + 200 + 50) and one per other type, all read at the first page's block.
    expect(fake.fetchLog).toHaveLength(7)
    expect(fake.fetchLog.slice(1).every((f) => f.atBlock === BigInt(s.generatedAtBlock))).toBe(true)
  })

  it('serves a fresh snapshot from memory, then stale-while-revalidate', async () => {
    await dir.summary()
    const n = fake.fetchLog.length
    t += 60_000
    await dir.summary()
    expect(fake.fetchLog.length).toBe(n)
    t += 5 * 60_000
    fake.add(alert(1000))
    const stale = await dir.summary()
    expect(stale.stale).toBe(true)
    expect(stale.alerts.total).toBe(450)
    await new Promise((r) => setTimeout(r, 10))
    const fresh = await dir.summary()
    expect(fresh.stale).toBe(false)
    expect(fresh.alerts.total).toBe(451)
  })

  it('keeps the last snapshot when a refresh fails, and says why', async () => {
    await dir.summary()
    t += 6 * 60_000
    fake.failNextFetch = Object.assign(new Error('429 Too Many Requests'), { status: 429 })
    const first = await dir.summary()
    expect(first.stale).toBe(true)
    await new Promise((r) => setTimeout(r, 10))
    const after = await dir.summary()
    expect(after.stale).toBe(true)
    expect(after.error).toMatch(/rate limiting/)
  })

  it('never blocks a cold request past coldWaitMs', async () => {
    const slow = { select: () => ({ where: () => ({ createdBy: () => ({ limit: () => ({ fetch: () => new Promise(() => {}) }) }) }) }) } as unknown as ArkivRead
    const cold = new ArkivDirectory({ publisher: PUB, client: slow, coldWaitMs: 30 })
    await expect(cold.summary()).rejects.toMatchObject({ code: 'SUMMARY_WARMING' })
  })
})

describe('Arkiv directory: HTTP', () => {
  const app = (dir: ArkivDirectory | null) =>
    createApp({ ledger: new Ledger(':memory:'), reader: null, directory: dir, publisher: PUB, corsOrigins: ['*'], explorerBase: 'https://explorer.test' })

  it('GET /v1/arkiv/entities validates, queries and returns the query text', async () => {
    const fake = new FakeArkiv(PUB)
    fake.add(alert(1, { sev: 5, src: 'who-mpa' }), { product: 'COLDRIF' })
    const a = app(new ArkivDirectory({ publisher: PUB, client: fake as unknown as ArkivRead }))
    const ok = await a.request('/v1/arkiv/entities?type=alert&src=who-mpa&sevMin=4')
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.items).toHaveLength(1)
    expect(body.query.string).toContain("src = str('who-mpa') AND sev >= i32(4)")
    expect(body.query.sdk).toContain("eq('src', str('who-mpa'))")

    const bad = await a.request('/v1/arkiv/entities?type=heartbeat&sevMin=9')
    expect(bad.status).toBe(400)
    const err = await bad.json()
    expect(err.error.code).toBe('BAD_REQUEST')
    expect(err.error.details.map((d: { path: string }) => d.path)).toContain('sevMin')

    fake.failNextFetch = Object.assign(new Error('rate limited'), { status: 429 })
    const throttled = await a.request('/v1/arkiv/entities?type=notice')
    expect(throttled.status).toBe(503)
    expect(throttled.headers.get('retry-after')).toBe('30')
    expect((await throttled.json()).error.code).toBe('ARKIV_THROTTLED')
  })

  it('GET /v1/arkiv/summary answers from Arkiv; 503 when not wired', async () => {
    const fake = new FakeArkiv(PUB)
    fake.add(alert(1))
    const res = await app(new ArkivDirectory({ publisher: PUB, client: fake as unknown as ArkivRead })).request('/v1/arkiv/summary')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ project: PROJECT, publisher: PUB, entities: { alert: 1 }, generatedAtBlock: '42' })
    expect((await app(null).request('/v1/arkiv/summary')).status).toBe(503)
  })
})
