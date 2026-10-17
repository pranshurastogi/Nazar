import { ExpirationTime, NoEntityFoundError, type PublicArkivClient } from '@arkiv-network/sdk'
import type { Hex } from 'viem'

import { errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { InsufficientFundsError, PublishError, withWriterLock, type ArkivWallet, type PublishMode, type SimulationResult } from './publisher.ts'
import { LIFETIME, PROJECT } from './schema.ts'
import { BLOCK_SECONDS } from './validate.ts'

const log = child('keep-alive')

/**
 * Keep Alive: extend an alert's life while the batch is still on shelves.
 *
 * Alerts are created with `permissionlessExtension`, so ANY wallet can call `extendEntity` on them:
 * a chemist, an NGO, a journalist. Nazar does not need (and does not offer) an endpoint for it; this
 * command is the reference client. An extension sets a new expiry counted from now and the engine
 * rejects one that would not move it later, so we read the current expiry first and skip no-ops.
 */

export type KeepAlivePublic = Pick<PublicArkivClient, 'getEntity' | 'getBlockTiming' | 'getBalance'>

export interface KeepAliveReport {
  entityKey: Hex
  mode: PublishMode
  action: 'extended' | 'dry-run' | 'skipped'
  type: string | null
  creator: string | null
  fromNazarPublisher: boolean | null
  permissionlessExtension: boolean
  currentBlock: string
  expiresAtBlock: string | null
  remainingDays: number | null
  requestedDays: number
  txHash: string | null
  newExpiresAtBlock: string | null
  estimate: SimulationResult | null
  reason?: string
}

const DAY_BLOCKS = BigInt((24 * 60 * 60) / BLOCK_SECONDS)
/** An extend touches one entity; measured creates are ~136k, so this is a generous ceiling for the balance check. */
const EXTEND_GAS_CEILING = 120_000n

type Tagged = { type: string; value: unknown }

export async function keepAlive(
  entityKey: Hex,
  days: number,
  o: {
    public: KeepAlivePublic
    mode: PublishMode
    /** The signer; any funded wallet works for permissionless entities. */
    signer: Hex | null
    wallet?: () => ArkivWallet
    /** Nazar's publisher, to label whether the entity is an official alert. */
    publisher: Hex | null
    simulate?: ((entityKey: Hex, days: number, from: Hex | null) => Promise<SimulationResult>) | null
    gasPrice?: () => Promise<bigint>
  },
): Promise<KeepAliveReport> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(entityKey)) throw new PublishError(`"${entityKey}" is not an entity key (0x + 64 hex)`)
  if (!Number.isInteger(days) || days < 1 || days > LIFETIME.alertMaxDays) throw new PublishError(`--days must be a whole number between 1 and ${LIFETIME.alertMaxDays}`)

  const entity = await o.public.getEntity(entityKey).catch((err) => {
    if (err instanceof NoEntityFoundError || (err as { name?: string })?.name === 'NoEntityFoundError') {
      throw new PublishError(`No live entity ${entityKey}: it never existed or has already expired (an expired entity cannot be revived)`, { entityKey })
    }
    throw err
  })
  const attrs = (entity.attributes ?? {}) as Record<string, Tagged | undefined>
  if (attrs.project?.value !== PROJECT) throw new PublishError(`Entity ${entityKey} is not a Nazar entity (project tag "${String(attrs.project?.value ?? '')}")`, { entityKey })
  const permissionless = !!entity.creationFlags?.permissionlessExtension
  const owner = (entity.owner as string | undefined)?.toLowerCase()
  if (!permissionless && (!o.signer || owner !== o.signer.toLowerCase())) {
    throw new PublishError(`Entity ${entityKey} (${String(attrs.t?.value)}) is not permissionlessly extendable; only its owner can extend it`, { entityKey })
  }
  const creator = (entity.creator as string | undefined) ?? null
  const { currentBlock } = await o.public.getBlockTiming()
  const expiresAt = entity.expiresAt ?? null
  const remainingBlocks = expiresAt !== null ? expiresAt - currentBlock : null
  const requestedBlocks = BigInt(days) * DAY_BLOCKS
  const report: KeepAliveReport = {
    entityKey,
    mode: o.mode,
    action: o.mode === 'live' ? 'extended' : 'dry-run',
    type: attrs.t?.value !== undefined ? String(attrs.t.value) : null,
    creator,
    fromNazarPublisher: o.publisher && creator ? creator.toLowerCase() === o.publisher.toLowerCase() : null,
    permissionlessExtension: permissionless,
    currentBlock: currentBlock.toString(),
    expiresAtBlock: expiresAt?.toString() ?? null,
    remainingDays: remainingBlocks !== null ? Math.round((Number(remainingBlocks) / Number(DAY_BLOCKS)) * 10) / 10 : null,
    requestedDays: days,
    txHash: null,
    newExpiresAtBlock: null,
    estimate: null,
  }
  if (remainingBlocks !== null && requestedBlocks <= remainingBlocks) {
    return {
      ...report,
      action: 'skipped',
      reason: `already lives ${report.remainingDays} more days; an extension sets a new expiry from now, so ask for more than that`,
    }
  }

  if (o.simulate) report.estimate = await o.simulate(entityKey, days, o.signer).catch((err) => ({ ok: false, gas: null, gasPrice: null, costGlm: null, error: errorMessage(err) }))
  if (o.mode === 'dry-run') return report

  const signer = o.signer
  if (!signer || !o.wallet) throw new PublishError('Keep Alive in live mode needs a funded wallet key (NAZAR_PUBLISHER_PRIVATE_KEY)')
  return withWriterLock(signer, async () => {
    const [balance, price] = await Promise.all([o.public.getBalance({ address: signer }), (o.gasPrice ?? (async () => 1_000_000_002n))().catch(() => 1_000_000_002n)])
    const gas = report.estimate?.ok && report.estimate.gas ? (BigInt(report.estimate.gas) * 12n) / 10n : EXTEND_GAS_CEILING
    if (balance < gas * price) throw new InsufficientFundsError(signer, balance, gas * price, `one extendEntity`)
    const res = await o.wallet!().extendEntity({ entityKey, expires: ExpirationTime.fromDays(days) })
    log.info({ entityKey, days, tx: res.txHash }, 'entity extended')
    return { ...report, action: 'extended' as const, txHash: res.txHash, newExpiresAtBlock: res.expiresAt?.toString() ?? null }
  })
}
