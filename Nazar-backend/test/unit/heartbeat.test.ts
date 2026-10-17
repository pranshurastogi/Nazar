import { NoEntityFoundError, type CreateEntityParameters, type ExtendEntityParameters, type PatchEntityParameters } from '@arkiv-network/sdk'
import type { Hex } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'

import { HEARTBEAT_KEY, Heartbeat, type HeartbeatPublic } from '../../src/arkiv/heartbeat.ts'
import { keepAlive, type KeepAlivePublic } from '../../src/arkiv/keepalive.ts'
import type { ArkivWallet } from '../../src/arkiv/publisher.ts'
import { LIFETIME, PROJECT } from '../../src/arkiv/schema.ts'
import { pipelineStatus } from '../../src/pipeline/status.ts'
import { startWorker } from '../../src/pipeline/worker.ts'
import { Ledger } from '../../src/storage/ledger.ts'

const OWNER = '0x1111111111111111111111111111111111111111' as Hex
const OTHER = '0x2222222222222222222222222222222222222222' as Hex
const key = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex

/** Records every write; entities "exist" until expired by the test. */
class FakeChain {
  calls: { op: string; key?: Hex; minutes?: number; days?: number; set?: unknown }[] = []
  alive = new Set<Hex>()
  next = 1
  failPatch: Error | null = null
  failExtend = 0

  wallet(): ArkivWallet {
    return {
      createEntity: async (p: CreateEntityParameters) => {
        const k = key(this.next++)
        this.alive.add(k)
        this.calls.push({ op: 'create', key: k, minutes: Number(p.expires.minLifetime) / 30 })
        return { entityKey: k, txHash: key(1000 + this.next), expiresAt: 1n }
      },
      patchEntity: async (p: PatchEntityParameters) => {
        this.calls.push({ op: 'patch', key: p.entityKey, set: p.set })
        if (this.failPatch) throw this.failPatch
        if (!this.alive.has(p.entityKey)) throw new Error('execution reverted: entity not found')
        return { entityKey: p.entityKey, txHash: key(2000 + this.next++) }
      },
      extendEntity: async (p: ExtendEntityParameters) => {
        this.calls.push({ op: 'extend', key: p.entityKey, minutes: Number(p.expires.minLifetime) / 30, days: Number(p.expires.minLifetime) / 43200 })
        if (this.failExtend > 0) {
          this.failExtend--
          throw new Error('timeout')
        }
        return { entityKey: p.entityKey, txHash: key(3000 + this.next++), expiresAt: 99n }
      },
      executeBatch: async () => {
        throw new Error('not used')
      },
    } as unknown as ArkivWallet
  }

  public(): HeartbeatPublic {
    return {
      getEntity: async (k: Hex) => {
        if (!this.alive.has(k)) throw new NoEntityFoundError(k)
        return {} as never
      },
    } as HeartbeatPublic
  }
}

describe('Heartbeat', () => {
  let ledger: Ledger
  let chain: FakeChain
  let now = 1_000_000
  const hb = () => new Heartbeat({ ledger, mode: 'live', wallet: chain.wallet(), public: chain.public(), address: OWNER, now: () => now })
  beforeEach(() => {
    ledger = new Ledger(':memory:')
    chain = new FakeChain()
    now = 1_000_000
  })

  it('creates once, then renews with patch + extend (20 minutes from now)', async () => {
    const first = await hb().beat()
    expect(first.action).toBe('created')
    expect(chain.calls.map((c) => c.op)).toEqual(['create'])
    expect(chain.calls[0]!.minutes).toBe(LIFETIME.heartbeatMinutes)
    expect(ledger.getKv(HEARTBEAT_KEY)).toBe(first.entityKey)

    now += 5 * 60_000
    const second = await hb().beat()
    expect(second.action).toBe('renewed')
    expect(second.entityKey).toBe(first.entityKey)
    expect(chain.calls.map((c) => c.op)).toEqual(['create', 'patch', 'extend'])
    expect((chain.calls[1]!.set as { last_ok: { value: bigint } }).last_ok.value).toBe(BigInt(now))
    expect(chain.calls[2]!.minutes).toBe(LIFETIME.heartbeatMinutes)
  })

  it('creates a fresh heartbeat only when the old one has expired', async () => {
    const first = await hb().beat()
    chain.alive.delete(first.entityKey as Hex)
    const again = await hb().beat()
    expect(again.action).toBe('created')
    expect(again.entityKey).not.toBe(first.entityKey)
    expect(ledger.getKv(HEARTBEAT_KEY)).toBe(again.entityKey)
  })

  it('rethrows a transient failure instead of creating a duplicate', async () => {
    await hb().beat()
    chain.failPatch = new Error('fetch failed')
    await expect(hb().beat()).rejects.toThrow('fetch failed')
    expect(chain.calls.filter((c) => c.op === 'create')).toHaveLength(1)
  })

  it('retries a failed extend once after a successful patch', async () => {
    await hb().beat()
    chain.failExtend = 1
    const r = await hb().beat()
    expect(r.action).toBe('renewed')
    expect(chain.calls.filter((c) => c.op === 'extend')).toHaveLength(2)
  })

  it('dry-run writes nothing on chain but still reports to /v1/pipeline/status', async () => {
    const r = await new Heartbeat({ ledger, mode: 'dry-run', now: () => now }).beat()
    expect(r.action).toBe('dry-run')
    const st = await pipelineStatus({ ledger, mode: 'dry-run', address: null, now: () => now + 1000 })
    expect(st.heartbeat).toMatchObject({ lastOkMs: now, mode: 'dry-run', action: 'dry-run', entityKey: null, stale: false, ageMs: 1000 })
  })

  it('status shows the live entity, flags staleness after 20 minutes, and prefers a newer on-chain beat', async () => {
    const r = await hb().beat()
    const st = await pipelineStatus({ ledger, mode: 'live', address: null, now: () => now + 21 * 60_000 })
    expect(st.heartbeat).toMatchObject({ entityKey: r.entityKey, mode: 'live', action: 'created', txHash: r.txHash, stale: true })
    const chainBeat = { entityKey: key(77), lastOkMs: now + 20 * 60_000, expiresAtBlock: '123' }
    const st2 = await pipelineStatus({ ledger, mode: 'live', address: null, now: () => now + 21 * 60_000, chainHeartbeat: async () => chainBeat })
    expect(st2.heartbeat).toMatchObject({ lastOkMs: chainBeat.lastOkMs, entityKey: key(77), stale: false, chain: chainBeat })
    const st3 = await pipelineStatus({ ledger, mode: 'live', address: null, chainHeartbeat: async () => Promise.reject(new Error('rpc down')) })
    expect(st3.heartbeat?.chain).toBeNull()
  })
})

describe('worker heartbeat', () => {
  it('beats on start and schedules a renewal every 5 minutes', async () => {
    const ledger = new Ledger(':memory:')
    let beats = 0
    const w = await startWorker({
      ledger,
      publish: false,
      handleSignals: false,
      heartbeat: { beat: async () => (beats++, { mode: 'dry-run', action: 'dry-run', entityKey: null, txHash: null, payload: {} as never }) },
    })
    try {
      const job = w.jobs.find((j) => j.name === 'heartbeat')!
      expect(job.pattern).toBe('*/5 * * * *')
      expect(new Date(job.next!).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000)
      await w.beat()
      expect(beats).toBeGreaterThanOrEqual(2)
    } finally {
      await w.stop()
    }
  })

  it('keeps running when a beat fails', async () => {
    const w = await startWorker({ ledger: new Ledger(':memory:'), publish: false, handleSignals: false, heartbeat: { beat: async () => Promise.reject(new Error('no funds')) } })
    await expect(w.beat()).resolves.toBeUndefined()
    await w.stop()
  })
})

describe('keep-alive', () => {
  const entity = (over: Record<string, unknown> = {}) => ({
    key: key(5),
    creator: OWNER,
    owner: OWNER,
    expiresAt: 1000n + 30n * 43200n,
    creationFlags: { readonly: true, permissionlessExtension: true },
    attributes: { project: { type: 'str', value: PROJECT }, t: { type: 'str', value: 'alert' } },
    ...over,
  })
  const pub = (e: unknown, balance = 10n ** 18n): KeepAlivePublic =>
    ({
      getEntity: async (k: Hex) => {
        if (!e) throw new NoEntityFoundError(k)
        return e
      },
      getBlockTiming: async () => ({ currentBlock: 1000n, currentBlockTime: 0, blockDuration: 2 }),
      getBalance: async () => balance,
    }) as unknown as KeepAlivePublic

  it('extends a permissionless alert from any wallet (live), setting the new life from now', async () => {
    const chain = new FakeChain()
    const r = await keepAlive(key(5), 90, { public: pub(entity()), mode: 'live', signer: OTHER, wallet: () => chain.wallet(), publisher: OWNER, simulate: null })
    expect(r.action).toBe('extended')
    expect(r.fromNazarPublisher).toBe(true)
    expect(r.remainingDays).toBe(30)
    expect(chain.calls).toEqual([{ op: 'extend', key: key(5), minutes: 90 * 1440, days: 90 }])
    expect(r.newExpiresAtBlock).toBe('99')
  })

  it('dry-run reads and estimates but sends nothing', async () => {
    const chain = new FakeChain()
    const r = await keepAlive(key(5), 90, {
      public: pub(entity()),
      mode: 'dry-run',
      signer: OTHER,
      wallet: () => chain.wallet(),
      publisher: OWNER,
      simulate: async () => ({ ok: true, gas: '50000', gasPrice: '1', costGlm: '0' }),
    })
    expect(r.action).toBe('dry-run')
    expect(r.estimate?.gas).toBe('50000')
    expect(chain.calls).toEqual([])
  })

  it('skips an extension that would not move the expiry later', async () => {
    const r = await keepAlive(key(5), 10, { public: pub(entity()), mode: 'live', signer: OTHER, wallet: () => new FakeChain().wallet(), publisher: OWNER })
    expect(r.action).toBe('skipped')
    expect(r.reason).toMatch(/already lives 30 more days/)
  })

  it('refuses expired, foreign and non-extendable entities, and stops when the wallet is short', async () => {
    const opts = { mode: 'live' as const, signer: OTHER, wallet: () => new FakeChain().wallet(), publisher: OWNER }
    await expect(keepAlive(key(5), 90, { ...opts, public: pub(null) })).rejects.toThrow(/cannot be revived/)
    await expect(keepAlive(key(5), 90, { ...opts, public: pub(entity({ attributes: { project: { type: 'str', value: 'x' } } })) })).rejects.toThrow(/not a Nazar entity/)
    await expect(keepAlive(key(5), 90, { ...opts, public: pub(entity({ creationFlags: { readonly: true, permissionlessExtension: false } })) })).rejects.toThrow(/only its owner/)
    await expect(keepAlive(key(5), 90, { ...opts, public: pub(entity(), 0n) })).rejects.toThrow(/hub\.arkiv\.network\/faucet/)
    await expect(keepAlive('0x12' as Hex, 90, { ...opts, public: pub(entity()) })).rejects.toThrow(/not an entity key/)
    await expect(keepAlive(key(5), 0, { ...opts, public: pub(entity()) })).rejects.toThrow(/--days/)
  })
})
