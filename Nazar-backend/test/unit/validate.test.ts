import { ExpirationTime, jsonToPayload, type CreateEntityParameters } from '@arkiv-network/sdk'
import { i32, str } from '@arkiv-network/sdk/attr'
import { beforeEach, describe, expect, it } from 'vitest'

import { fundingInstructions } from '../../src/arkiv/funding.ts'
import { LIFETIME, PROJECT, alertLifetimeDays, buildAlert, buildHeartbeat, buildNotice, manufacturerKey, slugAttr } from '../../src/arkiv/schema.ts'
import { checkEntity, planChunks, publishOrder, validateLedger, type LedgerCheckOptions } from '../../src/arkiv/validate.ts'
import { confusionKey } from '../../src/domain/batch.ts'
import type { AlertRecord } from '../../src/domain/types.ts'
import { resolveRows } from '../../src/resolve/index.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'

const OWNER = '0x1111111111111111111111111111111111111111' as const
const KEY = `0x${'ab'.repeat(32)}` as const

function seed(ledger: Ledger, n: number, over: Partial<Parameters<typeof rawDoc>[0]> = {}) {
  const doc = rawDoc({ title: `notice ${over.sourceId ?? 'cdsco-pdf'} ${n}`, ...over })
  ledger.upsertDocument(doc)
  const r = resolveRows(doc, Array.from({ length: n }, (_, i) => row(doc, i + 1)))
  ledger.upsertAlerts([...r.alerts, ...r.curator], confusionKey)
  ledger.upsertNotice(r.notice)
  return { doc, ...r }
}

const base = { project: str(PROJECT), t: str('alert'), v: i32(1) }
const entity = (attributes: Record<string, unknown>, extra: Partial<CreateEntityParameters> = {}): CreateEntityParameters =>
  ({ payload: jsonToPayload({}), contentType: 'application/json', attributes, expires: ExpirationTime.fromDays(100), ...extra }) as CreateEntityParameters

describe('checkEntity', () => {
  it('passes a real alert and notice built by the schema', () => {
    const ledger = new Ledger(':memory:')
    const { alerts, notice } = seed(ledger, 1)
    expect(checkEntity(buildAlert(alerts[0]!, KEY), 'alert').problems).toEqual([])
    expect(checkEntity(buildNotice(notice), 'notice').problems).toEqual([])
    const hb = buildHeartbeat({ worker: 'nazar', lastOkMs: Date.now(), sources: {}, alerts: 0, version: '0.1.0' })
    expect(checkEntity(hb, 'heartbeat').problems).toEqual([])
  })

  it('rejects names outside the grammar, reserved words and long names', () => {
    const p = checkEntity(entity({ ...base, '1abc': str('x'), key: str('x'), NOT: str('x'), ['a'.repeat(33)]: str('x'), 'bad name': str('x') })).problems
    expect(p.some((x) => x.includes('"1abc" breaks the grammar'))).toBe(true)
    expect(p.some((x) => x.includes('"key" is a reserved'))).toBe(true)
    expect(p.some((x) => x.includes('"NOT" is a reserved'))).toBe(true)
    expect(p.some((x) => x.includes('longer than 32 bytes'))).toBe(true)
    expect(p.some((x) => x.includes('"bad name"'))).toBe(true)
  })

  it('enforces 32 attributes, 128-byte strings, i32 range, YYYYMM months and the 128 KB payload', () => {
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`a${i}`, i32(i)]))
    expect(checkEntity(entity(many)).problems).toContain('33 attributes > 32')
    const p = checkEntity(
      entity(
        { ...base, s: { type: 'str', value: 'é'.repeat(65) }, n: { type: 'i32', value: 2 ** 31 }, f: { type: 'i32', value: 1.5 }, exp_ym: i32(202613), k: { type: 'key', value: '0x12' } },
        { payload: new Uint8Array(128 * 1024 + 1) },
      ),
    ).problems
    expect(p).toContain('attribute s is 130 bytes > 128')
    expect(p.some((x) => x.startsWith('attribute n=2147483648 is not an i32'))).toBe(true)
    expect(p.some((x) => x.startsWith('attribute f=1.5'))).toBe(true)
    expect(p).toContain('attribute exp_ym=202613 is not a YYYYMM month')
    expect(p).toContain('attribute k is not a 32-byte entity key')
    expect(p.some((x) => x.startsWith('payload 131073 bytes'))).toBe(true)
  })

  it('checks the contract per type: tags, required attributes, flags and lifetime window', () => {
    const p = checkEntity(entity({ project: str('other'), t: str('notice'), v: i32(2), batch: str('x') }, { expires: ExpirationTime.fromDays(20 * 365) }), 'alert').problems
    expect(p).toContain(`project tag must be "${PROJECT}"`)
    expect(p).toContain('t must be "alert", got "notice"')
    expect(p).toContain('v must be 1')
    expect(p).toContain('missing attribute rid')
    expect(p).toContain('missing attribute notice')
    expect(p).toContain('alerts must be readonly and permissionlessExtension')
    expect(p.some((x) => x.startsWith('lifetime 7300.00 days is outside'))).toBe(true)
    expect(checkEntity(entity(base, { expires: undefined as never })).problems).toContain('expires must be built with ExpirationTime')
  })
})

describe('schema builder fixes', () => {
  it('cuts long slugs at a word boundary, never on a dash', () => {
    const long = 'Amino Acids (10%w/v) Injection with Electrolytes, Dextrose Injection IP (15%w/v) and Intravenous Fat Emulsion'
    const s = slugAttr(long)
    expect(s.length).toBeLessThanOrEqual(48)
    expect(s).toBe('amino-acids-10-w-v-injection-with-electrolytes')
    expect(slugAttr('COLDRIF')).toBe('coldrif')
    expect(slugAttr('x'.repeat(60))).toHaveLength(48)
  })

  it('uses the resolver firm key for mfr, matching the plant id', () => {
    expect(manufacturerKey({ manufacturer: 'Sresan Pharmaceuticals Pvt Ltd', plantId: 'sresan-pharmaceuticals-602106' })).toBe('sresan-pharmaceuticals')
    expect(manufacturerKey({ manufacturer: 'Sresan Pharmaceuticals Pvt. Ltd.', plantId: null })).toBe('sresan-pharmaceuticals')
    expect(manufacturerKey({ manufacturer: null, plantId: null })).toBe('unknown')
    const ledger = new Ledger(':memory:')
    const { alerts } = seed(ledger, 1)
    const a = alerts[0]!
    const attrs = buildAlert(a, KEY).attributes as Record<string, { value: unknown }>
    expect(String(attrs.plant?.value).startsWith(String(attrs.mfr?.value))).toBe(true)
  })

  it('caps an implausible printed expiry at ten years', () => {
    const now = new Date('2026-10-17T00:00:00Z')
    expect(alertLifetimeDays({ expYm: 209912, alertYm: 202610 }, now)).toBe(LIFETIME.alertMaxDays)
    expect(alertLifetimeDays({ expYm: 202501, alertYm: 202412 }, now)).toBe(LIFETIME.alertMinDays)
  })
})

describe('validateLedger', () => {
  let ledger: Ledger
  const opts = (over: Partial<LedgerCheckOptions> = {}): LedgerCheckOptions => ({
    chunkSize: 12,
    from: OWNER,
    chainId: 7738577,
    simulate: async (creates) => ({ ok: true, gas: String(creates.length * 200_000 + 50_000), gasPrice: '1000000000', costGlm: null, calldataBytes: creates.length * 6000 }),
    fallbackGasPerCreate: 230_000n,
    fallbackGasPrice: 1_000_000_002n,
    now: new Date('2026-10-17T00:00:00Z'),
    ...over,
  })
  beforeEach(() => {
    ledger = new Ledger(':memory:')
  })

  it('builds every entity, plans ≤12-create batches, checks notice links and estimates gas from samples', async () => {
    seed(ledger, 25)
    const curator = rawDoc({ title: 'mixed' })
    ledger.upsertDocument(curator)
    const r2 = resolveRows(curator, [row(curator, 1), row(curator, 2, { confidence: 0.3 })])
    ledger.upsertAlerts([...r2.alerts, ...r2.curator], confusionKey)
    ledger.upsertNotice(r2.notice)

    const rep = await validateLedger(ledger, opts())
    expect(rep.ok).toBe(true)
    expect(rep.failures).toEqual([])
    expect(rep.notices.total).toBe(2)
    expect(rep.entities).toEqual({ notice: 2, alert: 26, total: 28 })
    expect(rep.skipped.curator).toBe(1)
    expect(rep.pending).toEqual({ notices: 2, alerts: 26, creates: 28, chunks: 4 })
    expect(rep.chunks.sizes).toEqual({ '12': 2, '2': 2 })
    expect(rep.chunks.maxCreates).toBeLessThanOrEqual(12)
    expect(rep.links).toEqual({ alertsChecked: 26, broken: 0 })
    expect(rep.limits.maxAttributes).toBeLessThanOrEqual(32)
    expect(rep.limits.maxStr!.bytes).toBeLessThanOrEqual(128)
    expect(rep.gas.method).toBe('eth_estimateGas')
    expect(rep.gas.samples.length).toBe(3)
    expect(BigInt(rep.gas.gasPerCreate)).toBeGreaterThan(200_000n)
    expect(BigInt(rep.gas.totalGas)).toBe(BigInt(rep.gas.gasPerCreate) * 28n)
    expect(Number(rep.gas.recommendedGlm)).toBeGreaterThan(Number(rep.gas.totalGlm))
  })

  it('counts published alerts as already on chain and prices only what is pending', async () => {
    const { alerts, doc } = seed(ledger, 3)
    ledger.markNoticePublished(doc.sha256, KEY, '0x1')
    ledger.markAlertPublished(alerts[0]!.rid, KEY, '0x1')
    const rep = await validateLedger(ledger, opts({ simulate: null }))
    expect(rep.skipped.alreadyOnChain).toBe(1)
    expect(rep.entities.alert).toBe(3)
    expect(rep.pending).toEqual({ notices: 1, alerts: 2, creates: 2, chunks: 1 })
    expect(rep.links.broken).toBe(0)
    expect(rep.gas.method).toBe('fallback')
    expect(rep.gas.totalGas).toBe(String(230_000n * 2n))
  })

  it('filters by source and limits notices in publish order', async () => {
    seed(ledger, 2, { sourceId: 'cdsco-pdf' })
    seed(ledger, 2, { sourceId: 'who-mpa', noticeYm: 202510 })
    seed(ledger, 2, { sourceId: 'curated', noticeYm: 202510 })
    expect(publishOrder(ledger, { sources: ['who-mpa', 'curated'] })).toHaveLength(2)
    expect(publishOrder(ledger, { limit: 1 })).toHaveLength(1)
    const rep = await validateLedger(ledger, opts({ sources: ['who-mpa', 'curated'], limitNotices: 1, simulate: null }))
    expect(rep.notices.total).toBe(1)
    expect(Object.keys(rep.bySource).every((s) => ['who-mpa', 'curated'].includes(s))).toBe(true)
  })

  it('reports builder failures and oversized values instead of throwing', async () => {
    const { alerts } = seed(ledger, 2)
    const bad: AlertRecord = { ...alerts[0]!, rid: 'r'.repeat(200) }
    ledger.upsertAlerts([bad], confusionKey)
    const rep = await validateLedger(ledger, opts({ simulate: null }))
    expect(rep.ok).toBe(false)
    expect(rep.failures.some((f) => f.ref === bad.rid && f.problems[0]!.includes('128-byte'))).toBe(true)
  })

  it('fails a batch whose encoded calldata is too large', async () => {
    seed(ledger, 12)
    const rep = await validateLedger(ledger, opts({ simulate: async () => ({ ok: true, gas: '1', gasPrice: '1', costGlm: null, calldataBytes: 200_000 }) }))
    expect(rep.ok).toBe(false)
    expect(rep.failures[0]!.problems[0]).toMatch(/encoded batch is 200000 bytes/)
  })

  it('plans chunks exactly like the publisher', () => {
    const a = Array.from({ length: 25 }, (_, i) => ({ rid: String(i) }) as AlertRecord)
    expect(planChunks(a, false, 12).map((c) => c.alerts.length + (c.notice ? 1 : 0))).toEqual([12, 12, 2])
    expect(planChunks(a, true, 12).map((c) => c.alerts.length)).toEqual([12, 12, 1])
  })
})

describe('funding instructions', () => {
  it('names the address, the faucet, the shortfall and the rerun command', () => {
    const msg = fundingInstructions({ address: OWNER, balanceWei: 0n, neededWei: 120_000_000_000_000_000n, what: '459 creates', rerun: 'pnpm cli publish --live --source who-mpa,curated' })
    expect(msg).toContain(OWNER)
    expect(msg).toContain('https://hub.arkiv.network/faucet')
    expect(msg).toContain('~0.12 GLM for 459 creates')
    expect(msg).toContain('short    0.12 GLM')
    expect(msg).toContain('pnpm cli publish --live --source who-mpa,curated')
    expect(msg).toContain('Nothing was sent.')
  })
})
