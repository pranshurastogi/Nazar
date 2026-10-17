import { ExpirationTime, jsonToPayload } from '@arkiv-network/sdk'
import { u64 } from '@arkiv-network/sdk/attr'
import type { Hex } from 'viem'

import { env } from '../config/env.ts'
import { errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { sourceLastChecks } from '../pipeline/status.ts'
import type { Ledger } from '../storage/ledger.ts'
import { explorerEntity, publisherAddress, walletClient } from './client.ts'
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

/**
 * The heartbeat is one mutable entity with a 20-minute life. The worker renews it every 5 minutes
 * (patch the payload, then extend). If the pipeline dies, the entity expires on its own and the app
 * can say "pipeline quiet since …" instead of silently serving stale data.
 */
export class Heartbeat {
  constructor(
    private readonly o: {
      ledger: Ledger
      mode?: PublishMode
      wallet?: ArkivWallet
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

  async beat(opts: { live?: boolean } = {}): Promise<HeartbeatResult> {
    const mode: PublishMode = opts.live ? 'live' : this.mode
    const payload = this.payload()
    const existing = this.o.ledger.getKv(HEARTBEAT_KEY) ?? null
    if (mode === 'dry-run') {
      this.o.ledger.setKv(HEARTBEAT_LAST_OK, String(payload.lastOkMs))
      return { mode, action: 'dry-run', entityKey: existing, txHash: null, payload }
    }
    const address = this.o.address !== undefined ? this.o.address : publisherAddress()
    if (!address) throw new Error('Live heartbeat needs NAZAR_PUBLISHER_PRIVATE_KEY')
    const wallet = this.o.wallet ?? walletClient()
    return withWriterLock(address, async () => {
      if (existing) {
        try {
          await wallet.patchEntity({
            entityKey: existing as Hex,
            set: { last_ok: u64(BigInt(payload.lastOkMs)) },
            payload: jsonToPayload(payload),
            contentType: 'application/json',
          })
          const ext = await wallet.extendEntity({ entityKey: existing as Hex, expires: ExpirationTime.fromMinutes(LIFETIME.heartbeatMinutes) })
          this.o.ledger.setKv(HEARTBEAT_LAST_OK, String(payload.lastOkMs))
          return { mode, action: 'renewed' as const, entityKey: existing, txHash: ext.txHash, payload }
        } catch (err) {
          // Expired (or never landed): start a fresh heartbeat entity.
          log.warn({ err: errorMessage(err) }, 'heartbeat renew failed; creating a new one')
        }
      }
      const res = await wallet.createEntity(buildHeartbeat(payload))
      this.o.ledger.setKv(HEARTBEAT_KEY, res.entityKey)
      this.o.ledger.setKv(HEARTBEAT_LAST_OK, String(payload.lastOkMs))
      log.info({ entity: explorerEntity(res.entityKey) }, 'heartbeat created')
      return { mode, action: 'created' as const, entityKey: res.entityKey, txHash: res.txHash, payload }
    })
  }
}
