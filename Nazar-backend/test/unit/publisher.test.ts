import { beforeEach, describe, expect, it } from 'vitest'

import { InsufficientFundsError, MAX_CREATES_PER_TX, Publisher, ledgerAlert, validateEntity, type ArkivPublic, type ArkivWallet } from '../../src/arkiv/publisher.ts'
import { PROJECT, buildAlert } from '../../src/arkiv/schema.ts'
import { confusionKey } from '../../src/domain/batch.ts'
import { resolveRows } from '../../src/resolve/index.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { FakeArkiv, rawDoc, row } from './reader-fake-arkiv.ts'

const OWNER = '0x1111111111111111111111111111111111111111' as const

function seed(ledger: Ledger, n: number, title = 'NSQ September 2025') {
  const doc = rawDoc({ title })
  ledger.upsertDocument(doc)
  const rows = Array.from({ length: n }, (_, i) => row(doc, i + 1))
  const r = resolveRows(doc, rows)
  ledger.upsertAlerts([...r.alerts, ...r.curator], confusionKey)
  ledger.upsertNotice(r.notice)
  return { doc, ...r }
}

const publisherFor = (ledger: Ledger, fake: FakeArkiv, mode: 'dry-run' | 'live', extra: Partial<ConstructorParameters<typeof Publisher>[0]> = {}) =>
  new Publisher({
    ledger,
    mode,
    public: fake as unknown as ArkivPublic,
    wallet: fake as unknown as ArkivWallet,
    address: OWNER,
    simulate: null,
    gasPrice: async () => 1_000_000_002n,
    reconcileDelayMs: 0,
    sleep: async () => undefined,
    ...extra,
  })

describe('Publisher dry-run', () => {
  let ledger: Ledger
  let fake: FakeArkiv
  beforeEach(() => {
    ledger = new Ledger(':memory:')
    fake = new FakeArkiv(OWNER)
  })

  it('chunks one notice + 25 alerts into ≤12-create batches, notice first, with predicted salts', async () => {
    const { doc } = seed(ledger, 25)
    const rep = await publisherFor(ledger, fake, 'dry-run').publishNotice(doc.sha256)
    expect(rep.mode).toBe('dry-run')
    expect(rep.candidates).toBe(25)
    expect(rep.chunks.map((c) => c.entities.length)).toEqual([12, 12, 2])
    expect(rep.chunks.every((c) => c.entities.length <= MAX_CREATES_PER_TX)).toBe(true)
    const first = rep.chunks[0]!
    expect(first.includesNotice).toBe(true)
    expect(first.entities[0]!.kind).toBe('notice')
    // every create carries the salt that predictEntityKeys paired with its key
    const predicted = await fake.predictEntityKeys({ owner: OWNER, count: 12 })
    expect(first.entities.map((e) => e.salt)).toEqual(predicted.map((p) => String(p.salt)))
    expect(rep.noticeKey).toBe(predicted[0]!.key)
    expect(rep.noticeKeyPredicted).toBe(true)
    // alerts point at the notice through a key attribute
    for (const c of rep.chunks) for (const e of c.entities.filter((x) => x.kind === 'alert')) expect(e.attributes.notice).toBe(rep.noticeKey)
    expect(first.entities[1]!.attributes).toMatchObject({ project: PROJECT, t: 'alert', batch: expect.stringMatching(/^pt10\d\d$/) })
    // nothing sent, nothing marked
    expect(fake.batches).toHaveLength(0)
    expect(ledger.stats().published).toBe(0)
    const log = ledger.recentPublishes(10) as { status: string }[]
    expect(log.filter((l) => l.status === 'dry-run')).toHaveLength(3)
  })

  it('skips curator-tier rows and validates sizes', async () => {
    const doc = rawDoc({ title: 'mixed' })
    ledger.upsertDocument(doc)
    const r = resolveRows(doc, [row(doc, 1), row(doc, 2, { confidence: 0.3 })])
    ledger.upsertAlerts([...r.alerts, ...r.curator], confusionKey)
    ledger.upsertNotice(r.notice)
    const rep = await publisherFor(ledger, fake, 'dry-run').publishNotice(doc.sha256)
    expect(rep.candidates).toBe(1)
    expect(validateEntity(buildAlert(r.alerts[0]!, null))).toEqual([])
  })

  it('works without a key (no prediction) and reports it', async () => {
    const { doc } = seed(ledger, 3)
    const rep = await publisherFor(ledger, fake, 'dry-run', { address: null }).publishNotice(doc.sha256)
    expect(rep.noticeKeyPredicted).toBe(false)
    expect(rep.warnings.join(' ')).toMatch(/no publisher key/)
    expect(rep.chunks[0]!.entities).toHaveLength(4)
  })
})

describe('Publisher live (fake chain)', () => {
  let ledger: Ledger
  let fake: FakeArkiv
  beforeEach(() => {
    ledger = new Ledger(':memory:')
    fake = new FakeArkiv(OWNER)
  })

  it('publishes atomically, records keys + tx hashes, and links alerts to the notice', async () => {
    const { doc } = seed(ledger, 14)
    const rep = await publisherFor(ledger, fake, 'live').publishNotice(doc.sha256)
    expect(rep.published).toBe(14)
    expect(fake.batches.map((b) => b.creates!.length)).toEqual([12, 3])
    const notice = ledger.getNotice(doc.sha256)!
    expect(notice.entityKey).toMatch(/^0x[0-9a-f]{64}$/)
    expect(notice.txHash).toMatch(/^0x[0-9a-f]{64}$/)
    const alerts = fake.entities.filter((e) => e.attributes.t?.value === 'alert')
    expect(alerts).toHaveLength(14)
    expect(alerts.every((e) => e.attributes.notice?.value === notice.entityKey)).toBe(true)
    expect(ledger.stats()).toMatchObject({ published: 14, pending: 0 })
    expect(rep.explorer).toHaveLength(2)
  })

  it('never publishes the same rid twice', async () => {
    const { doc, alerts } = seed(ledger, 5)
    const pub = publisherFor(ledger, fake, 'live')
    await pub.publishNotice(doc.sha256)
    // Simulate a lost ledger: forget the keys locally, then publish again.
    ledger.db.prepare('UPDATE alerts SET entity_key = NULL, tx_hash = NULL').run()
    ledger.db.prepare('UPDATE notices SET entity_key = NULL, tx_hash = NULL').run()
    const again = await pub.publishNotice(doc.sha256)
    expect(again.reconciled).toBe(5)
    expect(again.chunks).toHaveLength(0)
    expect(fake.batches).toHaveLength(1)
    expect(ledgerAlert(ledger, alerts[0]!.rid)!.entityKey).toMatch(/^0x/)
    // the reconcile queries are pinned to project + publisher
    expect(fake.queries.some((q) => q.includes(`project=${PROJECT}`) && q.includes(`$creator=${OWNER}`) && q.includes('t=alert'))).toBe(true)
  })

  it('reconciles by rid after a timeout instead of resending', async () => {
    const { doc } = seed(ledger, 3)
    fake.failNext = { error: new Error('request timed out'), land: true }
    const rep = await publisherFor(ledger, fake, 'live').publishNotice(doc.sha256)
    expect(rep.chunks[0]!.status).toBe('reconciled')
    expect(fake.batches).toHaveLength(1)
    expect(ledger.stats().published).toBe(3)
  })

  it('marks a chunk failed (no retry) when the tx never landed', async () => {
    const { doc } = seed(ledger, 3)
    fake.failNext = { error: new Error('Execution reverted'), land: false }
    const rep = await publisherFor(ledger, fake, 'live', { reconcileAttempts: 2 }).publishNotice(doc.sha256)
    expect(rep.chunks[0]!.status).toBe('failed')
    expect(fake.batches).toHaveLength(1)
    expect(ledger.stats().published).toBe(0)
  })

  it('refuses to send with an empty wallet and points to the faucet', async () => {
    const { doc } = seed(ledger, 3)
    fake.balance = 0n
    await expect(publisherFor(ledger, fake, 'live').publishNotice(doc.sha256)).rejects.toThrow(InsufficientFundsError)
    await expect(publisherFor(ledger, fake, 'live').publishNotice(doc.sha256)).rejects.toThrow(/hub\.arkiv\.network\/faucet/)
    expect(fake.batches).toHaveLength(0)
  })

  it('serialises writers on one wallet', async () => {
    const a = seed(ledger, 2, 'A')
    const b = seed(ledger, 2, 'B')
    const pub = publisherFor(ledger, fake, 'live')
    await Promise.all([pub.publishNotice(a.doc.sha256), pub.publishNotice(b.doc.sha256)])
    // with no overlap, every prediction matched: each notice's alerts point at that notice's real key
    for (const d of [a.doc, b.doc]) {
      const key = ledger.getNotice(d.sha256)!.entityKey
      expect(fake.entities.filter((e) => e.attributes.notice?.value === key)).toHaveLength(2)
    }
  })

  it('retracts a published alert with a retraction entity', async () => {
    const { doc, alerts } = seed(ledger, 1)
    const pub = publisherFor(ledger, fake, 'live')
    await pub.publishNotice(doc.sha256)
    const dry = await publisherFor(ledger, fake, 'dry-run').retract(alerts[0]!.rid, 'appeal', 'Withdrawn after re-test')
    expect(dry.entity?.attributes).toMatchObject({ t: 'retraction', reason: 'appeal' })
    expect(ledgerAlert(ledger, alerts[0]!.rid)!.retracted).toBe(false)
    const live = await pub.retract(alerts[0]!.rid, 'appeal', 'Withdrawn after re-test')
    expect(live.entityKey).toMatch(/^0x/)
    expect(ledgerAlert(ledger, alerts[0]!.rid)!.retracted).toBe(true)
    const ret = fake.entities.find((e) => e.attributes.t?.value === 'retraction')!
    expect(ret.attributes.alert?.value).toBe(ledgerAlert(ledger, alerts[0]!.rid)!.entityKey)
  })
})
