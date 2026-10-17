import { ExpirationTime, NoEntityFoundError, jsonToPayload, type PublicArkivClient } from '@arkiv-network/sdk'
import { u64 } from '@arkiv-network/sdk/attr'
import type { Hex } from 'viem'

import { env } from '../config/env.ts'
import { errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { HEARTBEAT_LAST, sourceLastChecks, type HeartbeatRecord } from '../pipeline/status.ts'
import type { Ledger } from '../storage/ledger.ts'
import { explorerEntity, publicClient, publisherAddress, walletClient } from './client.ts'
import { withWriterLock, type ArkivWallet, type PublishMode } from './publisher.ts'
import { LIFETIME, buildHeartbeat, type HeartbeatPayload } from './schema.ts'

const log = child('heartbeat')

export const HEARTBEAT_KEY = 'heartbeat:entityKey'
export const HEARTBEAT_LAST_OK = 'heartbeat:lastOkMs'
const VERSION = '0.1.0'

export interface HeartbeatResult {
  mode: PublishMode
  action: 'created' | 'renewed' | 'dry-run'
  entityKey: string | null
  txHash: string | null
  payload: HeartbeatPayload
}

export type HeartbeatPublic = Pick<PublicArkivClient, 'getEntity'>

/**
 * The heartbeat is one mutable entity with a 20-minute life. The worker renews it every 5 minutes:
 * patch the payload and `last_ok`, then extend the expiry (an extension sets a new expiry from now,
 * so 20 minutes always moves it later). If the pipeline dies, the entity expires on its own and the
 * app can say "pipeline quiet since …" instead of silently serving stale data.
 *
 * A new entity is created only when the old one is provably gone (expired or never landed). A
 * transient RPC failure is rethrown instead, so a flaky node never leaves two heartbeats alive.
 */
export class Heartbeat {
  constructor(
    private readonly o: {
      ledger: Ledger
      mode?: PublishMode
      wallet?: ArkivWallet
      public?: HeartbeatPublic
      address?: Hex | null
      worker?: string
      now?: () => number
    },
  ) {}

  private get mode(): PublishMode {
    return this.o.mode ?? env().NAZAR_PUBLISH_MODE
  }

  payload(): HeartbeatPayload {
    const now = this.o.now?.() ?? Date.now()
    return {
      worker: this.o.worker ?? env().NAZAR_APP_TAG,
      lastOkMs: now,
      sources: sourceLastChecks(this.o.ledger),
      alerts: this.o.ledger.stats().published,
      version: VERSION,
    }
  }

  private record(r: HeartbeatResult) {
    this.o.ledger.setKv(HEARTBEAT_LAST_OK, String(r.payload.lastOkMs))
    const rec: HeartbeatRecord = { mode: r.mode, action: r.action, atMs: r.payload.lastOkMs, entityKey: r.entityKey, txHash: r.txHash }
    this.o.ledger.setKv(HEARTBEAT_LAST, JSON.stringify(rec))
    return r
  }

  /** True only when the node says the entity does not exist (expired or never created). */
  private async isGone(entityKey: Hex): Promise<boolean> {
    try {
      await (this.o.public ?? publicClient()).getEntity(entityKey)
      return false
    } catch (err) {
      if (err instanceof NoEntityFoundError || (err as { name?: string })?.name === 'NoEntityFoundError') return true
      throw err
    }
  }

  async beat(opts: { live?: boolean } = {}): Promise<HeartbeatResult> {
    const mode: PublishMode = opts.live ? 'live' : this.mode
    const payload = this.payload()
    const existing = (this.o.ledger.getKv(HEARTBEAT_KEY) ?? null) as Hex | null
    if (mode === 'dry-run') return this.record({ mode, action: 'dry-run', entityKey: existing, txHash: null, payload })

    const address = this.o.address !== undefined ? this.o.address : publisherAddress()
    if (!address) throw new Error('Live heartbeat needs NAZAR_PUBLISHER_PRIVATE_KEY')
    const wallet = this.o.wallet ?? walletClient()
    return withWriterLock(address, async () => {
      if (existing) {
        let alive = true
        try {
          await wallet.patchEntity({
            entityKey: existing,
            set: { last_ok: u64(BigInt(payload.lastOkMs)) },
            payload: jsonToPayload(payload),
            contentType: 'application/json',
          })
        } catch (err) {
          if (!(await this.isGone(existing))) throw err
          alive = false
          log.warn({ err: errorMessage(err), entityKey: existing }, 'heartbeat entity is gone; creating a new one')
        }
        if (alive) {
          const extend = () => wallet.extendEntity({ entityKey: existing, expires: ExpirationTime.fromMinutes(LIFETIME.heartbeatMinutes) })
          // The patch landed, so the entity is alive with a fresh payload; one retry, then let the next tick try again.
          const ext = await extend().catch(async (err) => {
            log.warn({ err: errorMessage(err) }, 'heartbeat extend failed; retrying once')
            return extend()
          })
          return this.record({ mode, action: 'renewed', entityKey: existing, txHash: ext.txHash, payload })
        }
      }
      const res = await wallet.createEntity(buildHeartbeat(payload))
      this.o.ledger.setKv(HEARTBEAT_KEY, res.entityKey)
      log.info({ entity: explorerEntity(res.entityKey) }, 'heartbeat created')
      return this.record({ mode, action: 'created', entityKey: res.entityKey, txHash: res.txHash, payload })
    })
  }
}
