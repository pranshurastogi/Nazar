import {
  createWalletClient,
  EntityMutationError,
  type CreateEntityParameters,
  type ExecuteBatchParameters,
  type PublicArkivClient,
  type WalletArkivClient,
} from '@arkiv-network/sdk'
import { key, str } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq } from '@arkiv-network/sdk/query'
import { custom, formatEther, http as viemHttp, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { arkivHttpUrl, env } from '../config/env.ts'
import type { AlertRecord, NoticeRecord } from '../domain/types.ts'
import { NazarError, errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { sleep } from '../lib/retry.ts'
import { isPublishableTier } from '../resolve/case.ts'
import type { Ledger } from '../storage/ledger.ts'
import { explorerEntity, explorerTx, publicClient, publisherAddress, walletClient } from './client.ts'
import { FAUCET_URL, fundingInstructions } from './funding.ts'
import { PROJECT, alertLifetimeDays, buildAlert, buildNotice, buildRetraction, type EntityType, type RetractionReason } from './schema.ts'
import { checkEntity, planChunks, publishOrder } from './validate.ts'

const log = child('publisher')

/**
 * Publisher: ledger → Arkiv.
 *
 * One notice and its alerts go out as atomic `executeBatch` transactions of at most CHUNK creates.
 * The first chunk carries the notice itself; every alert in it points at the notice through a
 * `notice` key attribute, which works inside one transaction because the keys are predicted
 * (predictEntityKeys) and each create carries the salt that mints its key. Later chunks reference
 * the notice key that is by then on chain.
 *
 * Safety rules, because a duplicate alert on a public ledger cannot be deleted (alerts are readonly):
 *  - before sending, existing alerts are read back from Arkiv (by notice key, created by us) and
 *    reconciled into the ledger, so a rid is never published twice;
 *  - one writer per wallet (an in-process mutex), since key prediction assumes nothing else is in flight;
 *  - on a timeout or an ambiguous failure we reconcile by rid and never blindly resend.
 */

export const MAX_CREATES_PER_TX = 12
/**
 * eth_estimateGas on real 12-alert batches from the ledger: ≈210k gas per create (a bare create with
 * a tiny payload is ≈136k; real alerts carry 25 attributes and a ~1 KB payload). Padded for the balance pre-check.
 */
export const GAS_PER_CREATE = 230_000n
export const FALLBACK_GAS_PRICE = 1_000_000_002n
export { FAUCET_URL }
const PLACEHOLDER_KEY = `0x${'00'.repeat(32)}` as Hex

export type PublishMode = 'dry-run' | 'live'

export type ArkivPublic = Pick<PublicArkivClient, 'select' | 'getBalance' | 'predictEntityKeys'>
export type ArkivWallet = Pick<WalletArkivClient, 'executeBatch' | 'createEntity' | 'patchEntity' | 'extendEntity'>

export interface SimulationResult {
  ok: boolean
  gas: string | null
  gasPrice: string | null
  costGlm: string | null
  /** Size of the encoded transaction data, when it could be captured. */
  calldataBytes?: number | null
  error?: string
}
export type SimulateFn = (creates: CreateEntityParameters[], from: Hex | null) => Promise<SimulationResult>

export class InsufficientFundsError extends NazarError {
  constructor(address: Hex, balanceWei: bigint, neededWei: bigint, what = 'this publish') {
    super(fundingInstructions({ address, balanceWei, neededWei, what }), 'FUNDS', {
      address,
      balance: balanceWei.toString(),
      needed: neededWei.toString(),
      faucet: FAUCET_URL,
    })
  }
}

export class PublishError extends NazarError {
  constructor(message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, 'PUBLISH', details, options)
  }
}

export interface EntitySummary {
  kind: 'notice' | 'alert' | 'retraction'
  rid: string | null
  salt: string | null
  attributes: Record<string, string | number>
  attributeCount: number
  payloadBytes: number
}

export interface PublishChunkReport {
  index: number
  includesNotice: boolean
  rids: string[]
  predictedKeys: string[]
  status: 'dry-run' | 'confirmed' | 'reconciled' | 'failed'
  txHash: string | null
  entityKeys: string[]
  entities: EntitySummary[]
  error?: string
}

export interface PublishReport {
  sha: string
  mode: PublishMode
  publisher: Hex | null
  noticeKey: string | null
  noticeKeyPredicted: boolean
  noticeAlreadyOnChain: boolean
  /** Alerts found already on chain and reconciled into the ledger instead of being re-sent. */
  reconciled: number
  candidates: number
  published: number
  invalid: { rid: string; problems: string[] }[]
  chunks: PublishChunkReport[]
  simulation: SimulationResult | null
  explorer: string[]
  warnings: string[]
}

export interface PublisherOptions {
  ledger: Ledger
  mode?: PublishMode
  /** Defaults to the shared public client. */
  public?: ArkivPublic
  /** Defaults to the configured wallet (live mode only). */
  wallet?: ArkivWallet
  /** Publisher address; defaults to the configured key's address. */
  address?: Hex | null
  chunkSize?: number
  simulate?: SimulateFn | null
  gasPrice?: () => Promise<bigint>
  txTimeoutMs?: number
  reconcileAttempts?: number
  reconcileDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
}

// ---- one writer per wallet
const writerLocks = new Map<string, Promise<unknown>>()
export async function withWriterLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const k = address.toLowerCase()
  const prev = writerLocks.get(k) ?? Promise.resolve()
  const run = prev.catch(() => undefined).then(fn)
  const settled = run.catch(() => undefined)
  writerLocks.set(k, settled)
  try {
    return await run
  } finally {
    if (writerLocks.get(k) === settled) writerLocks.delete(k)
  }
}

// ---- validation against Arkiv's limits (and our contract when the kind is known), before anything is sent
type Tagged = { type: string; value: unknown }

export function validateEntity(p: CreateEntityParameters, kind?: EntityType): string[] {
  return checkEntity(p, kind).problems
}

export function summarise(kind: EntitySummary['kind'], p: CreateEntityParameters, rid: string | null = null): EntitySummary {
  const attributes: Record<string, string | number> = {}
  for (const [name, v] of Object.entries((p.attributes ?? {}) as Record<string, unknown>)) {
    const t = v as Tagged
    attributes[name] = typeof t?.value === 'number' ? t.value : String(t?.value ?? v)
  }
  return {
    kind,
    rid,
    salt: p.salt !== undefined ? String(p.salt) : null,
    attributes,
    attributeCount: Object.keys(attributes).length,
    payloadBytes: p.payload.length,
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new PublishError(`${what} timed out after ${ms} ms`, { timeout: true })), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })

export class Publisher {
  readonly mode: PublishMode
  private readonly ledger: Ledger
  private readonly chunkSize: number
  private readonly addressOverride: Hex | null | undefined
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => Date

  constructor(private readonly o: PublisherOptions) {
    this.ledger = o.ledger
    this.mode = o.mode ?? env().NAZAR_PUBLISH_MODE
    this.chunkSize = Math.max(2, Math.min(o.chunkSize ?? MAX_CREATES_PER_TX, MAX_CREATES_PER_TX))
    this.addressOverride = o.address
    this.sleep = o.sleep ?? sleep
    this.now = o.now ?? (() => new Date())
  }

  get address(): Hex | null {
    return this.addressOverride !== undefined ? this.addressOverride : publisherAddress()
  }

  private get pub(): ArkivPublic {
    return this.o.public ?? publicClient()
  }

  private get wallet(): ArkivWallet {
    return this.o.wallet ?? walletClient()
  }

  // ------------------------------------------------------------------ reads used for reconciliation

  /** The notice entity for a document, if we already created it. */
  async findNoticeOnChain(sha: string): Promise<Hex | null> {
    const address = this.address
    if (!address) return null
    const page = await this.pub
      .select({ key: true })
      .where(eq('project', str(PROJECT)), eq('t', str('notice')), eq('sha', str(sha)))
      .createdBy(address)
      .limit(5)
      .fetch()
    return (page.entities[0]?.key as Hex | undefined) ?? null
  }

  /** rid → entity key for every alert of ours that points at this notice. */
  async alertsOnChainByNotice(noticeKey: Hex): Promise<Map<string, Hex>> {
    const out = new Map<string, Hex>()
    const address = this.address
    if (!address) return out
    let page = await this.pub
      .select({ key: true, attributes: { rid: true } })
      .where(eq('project', str(PROJECT)), eq('t', str('alert')), eq('notice', key(noticeKey)))
      .createdBy(address)
      .limit(200)
      .fetch()
    for (;;) {
      for (const e of page.entities) {
        const rid = (e.attributes as Record<string, Tagged | undefined>).rid?.value
        if (rid && e.key) out.set(String(rid), e.key as Hex)
      }
      if (!page.hasNextPage()) break
      page = await page.next()
    }
    return out
  }

  async alertOnChainByRid(rid: string): Promise<Hex | null> {
    const address = this.address
    if (!address) return null
    const page = await this.pub
      .select({ key: true })
      .where(eq('project', str(PROJECT)), eq('t', str('alert')), eq('rid', str(rid)))
      .createdBy(address)
      .limit(5)
      .fetch()
    return (page.entities[0]?.key as Hex | undefined) ?? null
  }

  /** Brings the ledger in line with what is already on chain for one notice. */
  async reconcile(sha: string): Promise<{ noticeKey: Hex | null; onChain: Map<string, Hex> }> {
    const local = this.ledger.getNotice(sha)
    let noticeKey = (local?.entityKey as Hex | null | undefined) ?? null
    if (!noticeKey) {
      noticeKey = await this.findNoticeOnChain(sha)
      if (noticeKey && local) this.ledger.markNoticePublished(sha, noticeKey, '')
    }
    const onChain = noticeKey ? await this.alertsOnChainByNotice(noticeKey) : new Map<string, Hex>()
    if (onChain.size) {
      const pending = new Set(this.ledger.unpublishedAlerts(sha).map((r) => r.rid))
      for (const [rid, k] of onChain) if (pending.has(rid)) this.ledger.markAlertPublished(rid, k, '')
    }
    return { noticeKey, onChain }
  }

  // ------------------------------------------------------------------ publishing

  async publishNotice(sha: string, opts: { live?: boolean } = {}): Promise<PublishReport> {
    const mode: PublishMode = opts.live ? 'live' : this.mode
    if (mode === 'live') {
      const address = this.address
      if (!address) throw new PublishError('Live publishing needs NAZAR_PUBLISHER_PRIVATE_KEY (run `pnpm cli wallet:new`)')
      return withWriterLock(address, () => this.publishInner(sha, mode))
    }
    return this.publishInner(sha, mode)
  }

  /** Every notice that still has publishable alerts waiting, oldest first, optionally from some sources only. */
  pendingNotices(limit = 50, sources?: string[]): string[] {
    return publishOrder(this.ledger, { limit, sources, pendingOnly: true })
  }

  async publishPending(opts: { live?: boolean; limit?: number; sources?: string[] } = {}): Promise<PublishReport[]> {
    const out: PublishReport[] = []
    for (const sha of this.pendingNotices(opts.limit, opts.sources)) out.push(await this.publishNotice(sha, opts))
    return out
  }

  private async publishInner(sha: string, mode: PublishMode): Promise<PublishReport> {
    const notice = this.ledger.getNotice(sha)
    if (!notice) throw new PublishError(`No resolved notice ${sha} in the ledger; run the pipeline first`, { sha })
    const address = this.address
    const report: PublishReport = {
      sha,
      mode,
      publisher: address,
      noticeKey: notice.entityKey,
      noticeKeyPredicted: false,
      noticeAlreadyOnChain: !!notice.entityKey,
      reconciled: 0,
      candidates: 0,
      published: 0,
      invalid: [],
      chunks: [],
      simulation: null,
      explorer: [],
      warnings: [],
    }

    // 1. Reconcile with the chain first, so nothing is ever sent twice.
    if (address) {
      try {
        const r = await this.reconcile(sha)
        report.noticeKey = r.noticeKey
        report.noticeAlreadyOnChain = !!r.noticeKey
        report.reconciled = r.onChain.size
      } catch (err) {
        if (mode === 'live') throw new PublishError(`Could not read Arkiv to reconcile before publishing: ${errorMessage(err)}`, { sha }, { cause: err })
        report.warnings.push(`reconcile skipped: ${errorMessage(err)}`)
      }
    } else {
      report.warnings.push('no publisher key configured: skipped on-chain reconciliation and key prediction')
    }

    // 2. What still needs to go out. Curator-tier and retracted rows never do.
    const pending = this.ledger
      .unpublishedAlerts(sha)
      .filter((r) => !r.retracted && isPublishableTier(r.record.tier))
      .map((r) => r.record)
    const valid: AlertRecord[] = []
    for (const a of pending) {
      let problems: string[]
      try {
        problems = validateEntity(buildAlert(a, PLACEHOLDER_KEY, this.now()), 'alert')
      } catch (err) {
        problems = [`builder threw: ${errorMessage(err)}`]
      }
      if (problems.length) {
        report.invalid.push({ rid: a.rid, problems })
        this.ledger.logPublish({ kind: 'alert', ref: a.rid, status: 'failed', error: problems.join('; ') })
      } else valid.push(a)
    }
    report.candidates = valid.length
    const noticeProblems = validateEntity(buildNotice(notice.record), 'notice')
    if (noticeProblems.length) throw new PublishError(`Notice ${sha} fails Arkiv limits: ${noticeProblems.join('; ')}`)
    if (!valid.length) {
      if (!report.warnings.length) report.warnings.push('nothing to publish: every alert is already on chain')
      return report
    }

    // 3. Plan the chunks: the first one carries the notice when it is not on chain yet.
    const plan = planChunks(valid, !!report.noticeKey, this.chunkSize)

    if (mode === 'live') {
      await this.checkBalance(address!, valid.length + (report.noticeKey ? 0 : 1))
    }

    for (const [index, chunk] of plan.entries()) {
      const c = await this.sendChunk(index, chunk, notice.record, report, mode)
      report.chunks.push(c)
      if (c.status === 'failed') break
    }
    return report
  }

  private async buildChunk(chunk: { notice: boolean; alerts: AlertRecord[] }, notice: NoticeRecord, report: PublishReport) {
    const count = chunk.alerts.length + (chunk.notice ? 1 : 0)
    const address = this.address
    let predicted: { key: Hex; salt: bigint }[] = []
    if (address) predicted = await this.pub.predictEntityKeys({ owner: address, count })
    const creates: CreateEntityParameters[] = []
    const entities: EntitySummary[] = []
    let offset = 0
    let noticeKey = (report.noticeKey as Hex | null) ?? null
    if (chunk.notice) {
      const p = predicted[0]
      noticeKey = p?.key ?? null
      const n = buildNotice(notice, p?.salt)
      creates.push(n)
      entities.push(summarise('notice', n))
      offset = 1
    }
    for (const [i, a] of chunk.alerts.entries()) {
      const p = predicted[i + offset]
      const params: CreateEntityParameters = { ...buildAlert(a, noticeKey ?? PLACEHOLDER_KEY, this.now()), ...(p ? { salt: p.salt } : {}) }
      creates.push(params)
      entities.push(summarise('alert', params, a.rid))
    }
    return { creates, entities, predicted, noticeKey }
  }

  private async sendChunk(
    index: number,
    chunk: { notice: boolean; alerts: AlertRecord[] },
    notice: NoticeRecord,
    report: PublishReport,
    mode: PublishMode,
  ): Promise<PublishChunkReport> {
    const { creates, entities, predicted, noticeKey } = await this.buildChunk(chunk, notice, report)
    const rids = chunk.alerts.map((a) => a.rid)
    const ref = `${notice.sha}#${index}`
    const base: PublishChunkReport = {
      index,
      includesNotice: chunk.notice,
      rids,
      predictedKeys: predicted.map((p) => p.key),
      status: 'dry-run',
      txHash: null,
      entityKeys: [],
      entities,
    }
    if (chunk.notice) {
      report.noticeKey = noticeKey
      report.noticeKeyPredicted = !!noticeKey
    }

    if (mode === 'dry-run') {
      if (index === 0 && this.o.simulate !== null) {
        const sim = this.o.simulate ?? rpcSimulate
        report.simulation = await sim(creates, this.address).catch((err) => ({ ok: false, gas: null, gasPrice: null, costGlm: null, error: errorMessage(err) }))
      }
      this.ledger.logPublish({ kind: chunk.notice ? 'notice+alerts' : 'alerts', ref, status: 'dry-run', entityKeys: base.predictedKeys })
      log.info({ ref, creates: creates.length, notice: chunk.notice }, 'dry-run chunk built')
      return base
    }

    // Live. Record intent first, so a crash mid-send still leaves the predicted keys to reconcile against.
    this.ledger.logPublish({ kind: chunk.notice ? 'notice+alerts' : 'alerts', ref, status: 'sent', entityKeys: base.predictedKeys })
    try {
      const res = await withTimeout(this.wallet.executeBatch({ creates }), this.o.txTimeoutMs ?? 120_000, `executeBatch ${ref}`)
      this.applyCreated(chunk, notice.sha, res.createdEntities, res.txHash, report)
      this.ledger.logPublish({ kind: chunk.notice ? 'notice+alerts' : 'alerts', ref, status: 'confirmed', txHash: res.txHash, entityKeys: res.createdEntities })
      report.explorer.push(explorerTx(res.txHash))
      log.info({ ref, tx: explorerTx(res.txHash), notice: chunk.notice ? explorerEntity(res.createdEntities[0]!) : undefined }, 'published chunk')
      return { ...base, status: 'confirmed', txHash: res.txHash, entityKeys: res.createdEntities }
    } catch (err) {
      const txHash = err instanceof EntityMutationError ? (err.txHash ?? null) : null
      log.warn({ ref, err: errorMessage(err), txHash }, 'chunk send failed or timed out; reconciling by rid')
      // Never resend blindly: the transaction may still land. Look for it on chain instead.
      const landed = await this.reconcileChunk(notice.sha, chunk, report)
      if (landed) {
        this.ledger.logPublish({ kind: 'reconcile', ref, status: 'confirmed', txHash: txHash ?? undefined, entityKeys: landed })
        return { ...base, status: 'reconciled', txHash, entityKeys: landed }
      }
      const msg = errorMessage(err)
      this.ledger.logPublish({ kind: chunk.notice ? 'notice+alerts' : 'alerts', ref, status: 'failed', txHash: txHash ?? undefined, error: msg })
      return { ...base, status: 'failed', txHash, error: msg }
    }
  }

  private applyCreated(chunk: { notice: boolean; alerts: AlertRecord[] }, sha: string, keys: Hex[], txHash: string, report: PublishReport) {
    let offset = 0
    if (chunk.notice) {
      const k = keys[0]
      if (k) {
        this.ledger.markNoticePublished(sha, k, txHash)
        report.noticeKey = k
      }
      offset = 1
    }
    this.ledger.tx(() => {
      for (const [i, a] of chunk.alerts.entries()) {
        const k = keys[i + offset]
        if (k) this.ledger.markAlertPublished(a.rid, k, txHash)
      }
    })
    report.published += chunk.alerts.length
  }

  /** After an ambiguous failure: poll a few blocks for the chunk's rids. Batches are atomic, so any hit means all landed. */
  private async reconcileChunk(sha: string, chunk: { notice: boolean; alerts: AlertRecord[] }, report: PublishReport): Promise<Hex[] | null> {
    const attempts = this.o.reconcileAttempts ?? 5
    for (let i = 0; i < attempts; i++) {
      try {
        const { noticeKey, onChain } = await this.reconcile(sha)
        const hits = chunk.alerts.map((a) => onChain.get(a.rid)).filter((k): k is Hex => !!k)
        if (hits.length || (chunk.notice && noticeKey && !chunk.alerts.length)) {
          report.noticeKey = noticeKey
          report.published += hits.length
          return noticeKey && chunk.notice ? [noticeKey, ...hits] : hits
        }
      } catch (err) {
        log.warn({ err: errorMessage(err) }, 'reconcile read failed')
      }
      if (i < attempts - 1) await this.sleep(this.o.reconcileDelayMs ?? 3000)
    }
    return null
  }

  private async checkBalance(address: Hex, creates: number) {
    const [balance, gasPrice] = await Promise.all([
      this.pub.getBalance({ address }),
      (this.o.gasPrice ?? defaultGasPrice)().catch(() => FALLBACK_GAS_PRICE),
    ])
    const needed = BigInt(creates) * GAS_PER_CREATE * gasPrice
    if (balance < needed) throw new InsufficientFundsError(address, balance, needed, `${creates} entity create(s)`)
    log.info({ address, balance: formatEther(balance), needed: formatEther(needed) }, 'balance ok')
  }

  // ------------------------------------------------------------------ retractions

  /** Publishes a retraction entity for an alert (alerts are readonly; corrections are new entities). */
  async retract(rid: string, reason: RetractionReason, note: string, opts: { live?: boolean } = {}) {
    const mode: PublishMode = opts.live ? 'live' : this.mode
    const row = ledgerAlert(this.ledger, rid)
    if (!row) throw new PublishError(`Unknown alert ${rid}`, { rid })
    let alertKey = (row.entityKey as Hex | null) ?? null
    if (!alertKey && this.address) alertKey = await this.alertOnChainByRid(rid).catch(() => null)
    if (!alertKey) {
      // Never published: retract locally so it is never sent.
      if (mode === 'live') this.ledger.markRetracted(rid)
      this.ledger.logPublish({ kind: 'retraction', ref: rid, status: mode === 'live' ? 'confirmed' : 'dry-run', error: 'alert was never published; retracted locally' })
      return { mode, rid, entity: null, txHash: null as string | null, entityKey: null as string | null, local: true }
    }
    const params = buildRetraction({
      alertKey,
      caseId: row.record.caseId,
      reason,
      sourceId: row.record.sourceId,
      note: note.slice(0, 2000),
      remainingAlertDays: alertLifetimeDays(row.record, this.now()),
    })
    const problems = validateEntity(params, 'retraction')
    if (problems.length) throw new PublishError(`Retraction fails Arkiv limits: ${problems.join('; ')}`)
    const entity = summarise('retraction', params, rid)
    if (mode === 'dry-run') {
      this.ledger.logPublish({ kind: 'retraction', ref: rid, status: 'dry-run' })
      return { mode, rid, entity, txHash: null, entityKey: null, local: false }
    }
    const address = this.address
    if (!address) throw new PublishError('Live retraction needs NAZAR_PUBLISHER_PRIVATE_KEY')
    return withWriterLock(address, async () => {
      await this.checkBalance(address, 1)
      const res = await this.wallet.createEntity(params)
      this.ledger.markRetracted(rid)
      this.ledger.logPublish({ kind: 'retraction', ref: rid, status: 'confirmed', txHash: res.txHash, entityKeys: [res.entityKey] })
      log.info({ rid, tx: explorerTx(res.txHash) }, 'retraction published')
      return { mode, rid, entity, txHash: res.txHash as string, entityKey: res.entityKey as string, local: false }
    })
  }
}

/** Reads one alert row straight from the ledger (the Ledger class has no by-rid getter). */
export function ledgerAlert(ledger: Ledger, rid: string) {
  const r = ledger.db.prepare('SELECT data, entity_key, tx_hash, published_at, retracted FROM alerts WHERE rid = ?').get(rid) as
    | { data: string; entity_key: string | null; tx_hash: string | null; published_at: string | null; retracted: number }
    | undefined
  if (!r) return undefined
  return {
    rid,
    record: JSON.parse(r.data) as AlertRecord,
    entityKey: r.entity_key,
    txHash: r.tx_hash,
    publishedAt: r.published_at,
    retracted: r.retracted === 1,
  }
}

type RpcRequest = (args: { method: string; params?: unknown }) => Promise<unknown>

function upstreamRpc(): RpcRequest {
  const t = viemHttp(arkivHttpUrl(), { retryCount: 1, timeout: 20_000 })({ chain: tiramisu, retryCount: 1 })
  return t.request as unknown as RpcRequest
}

export async function defaultGasPrice(): Promise<bigint> {
  return BigInt((await upstreamRpc()({ method: 'eth_gasPrice' })) as string)
}

class DryRunCapture extends Error {}

/**
 * Dry-run simulation without spending anything, even if the wallet is funded:
 * the SDK encodes the batch through a transport that captures the calldata and refuses to send,
 * then we ask the node for eth_estimateGas on that calldata (no fee fields, so an empty wallet works).
 * Works for any batch: creates, patches, extensions.
 */
export async function rpcSimulateBatch(batch: ExecuteBatchParameters, from: Hex | null): Promise<SimulationResult> {
  const upstream = upstreamRpc()
  let captured: { to: Hex; data: Hex } | undefined
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      if (['eth_fillTransaction', 'eth_estimateGas', 'eth_sendRawTransaction', 'eth_sendTransaction', 'eth_signTransaction'].includes(method)) {
        const tx = (Array.isArray(params) ? params[0] : undefined) as { to?: Hex; data?: Hex; input?: Hex } | undefined
        const data = tx?.data ?? tx?.input
        if (tx?.to && data) captured = { to: tx.to, data }
        throw new DryRunCapture(`dry-run: refused ${method}`)
      }
      return upstream({ method, params })
    },
  })
  // A throwaway signer: it never sends, it only lets the SDK encode the transaction.
  const account = privateKeyToAccount(generatePrivateKey())
  const wc = createWalletClient({ chain: tiramisu, account, transport })
  await wc.executeBatch(batch).catch(() => undefined)
  if (!captured) return { ok: false, gas: null, gasPrice: null, costGlm: null, error: 'could not capture calldata from the SDK' }
  const calldataBytes = (captured.data.length - 2) / 2
  const sender = from ?? account.address
  try {
    const [gasHex, priceHex] = await Promise.all([
      upstream({ method: 'eth_estimateGas', params: [{ from: sender, to: captured.to, data: captured.data }] }) as Promise<string>,
      upstream({ method: 'eth_gasPrice' }) as Promise<string>,
    ])
    const gas = BigInt(gasHex)
    const price = BigInt(priceHex)
    return { ok: true, gas: gas.toString(), gasPrice: price.toString(), costGlm: formatEther(gas * price), calldataBytes }
  } catch (err) {
    return { ok: false, gas: null, gasPrice: null, costGlm: null, calldataBytes, error: errorMessage(err).split('\n')[0] }
  }
}

export const rpcSimulate: SimulateFn = (creates, from) => rpcSimulateBatch({ creates }, from)
