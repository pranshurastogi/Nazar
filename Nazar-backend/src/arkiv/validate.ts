import {
  I32_MAX,
  I32_MIN,
  MAX_ATTRIBUTES,
  MAX_NAME_BYTES,
  MAX_PAYLOAD_BYTES,
  MAX_STRING_BYTES,
  U64_MAX,
  isValidAttributeName,
  predictEntityKey,
  type CreateEntityParameters,
} from '@arkiv-network/sdk'
import { formatEther, type Hex } from 'viem'

import type { AlertRecord, NoticeRecord } from '../domain/types.ts'
import { errorMessage } from '../lib/errors.ts'
import { isPublishableTier } from '../resolve/case.ts'
import type { Ledger } from '../storage/ledger.ts'
import { ENTITY_TYPES, LIFETIME, PROJECT, SCHEMA_VERSION, buildAlert, buildNotice, type EntityType } from './schema.ts'

/**
 * Pre-flight checks for everything Nazar writes to Arkiv. Public alerts are readonly, so a bad
 * entity can never be fixed in place: every limit the chain enforces (and a few product rules it
 * does not) is checked here, offline, before a transaction is even built.
 */

const enc = new TextEncoder()
const bytes = (s: string) => enc.encode(s).length

/** Arkiv's block time; every lifetime is a whole number of 2 s blocks. */
export const BLOCK_SECONDS = 2
const DAY_BLOCKS = (24 * 60 * 60) / BLOCK_SECONDS

/** Words the query language reserves (matched case-insensitively), mirrored from the SDK for clear error messages. */
export const RESERVED_ATTRIBUTE_NAMES = new Set(['and', 'or', 'not', 'true', 'false', 'startswith', 'exists', 'typeof', 'bool', 'i32', 'u64', 'u256', 'dec', 'bytes32', 'bytes', 'str', 'addr', 'key'])
const NAME_RE = /^[A-Za-z][A-Za-z0-9._-]*$/

/** Largest transaction calldata we are willing to send in one batch (the node's limit is 128 KiB). */
export const MAX_BATCH_BYTES = 120 * 1024

const YM_ATTRS = new Set(['notice_ym', 'mfg_ym', 'exp_ym', 'alert_ym'])
const REQUIRED: Partial<Record<EntityType, string[]>> = {
  notice: ['src', 'juris', 'notice_ym', 'sha', 'rows', 'parser'],
  alert: ['batch', 'batch_raw', 'case', 'rid', 'brand', 'form', 'cat', 'fail', 'sev', 'peds', 'mfr', 'alert_ym', 'src', 'juris', 'notice', 'conf', 'method', 'tier'],
  retraction: ['alert', 'case', 'reason', 'src'],
  heartbeat: ['worker', 'last_ok'],
  snapshot: ['day', 'count', 'sha'],
}

/** Sane lifetime window per entity type, in days. */
const LIFETIME_DAYS: Record<EntityType, [number, number]> = {
  notice: [LIFETIME.noticeDays, LIFETIME.noticeDays + 1],
  alert: [LIFETIME.alertMinDays, LIFETIME.alertMaxDays + 1],
  retraction: [LIFETIME.retractionExtraDays, LIFETIME.retractionExtraDays + LIFETIME.alertMaxDays + 1],
  heartbeat: [LIFETIME.heartbeatMinutes / (24 * 60), LIFETIME.heartbeatMinutes / (24 * 60)],
  snapshot: [LIFETIME.snapshotDays, LIFETIME.snapshotDays],
}

export const isYm = (v: number) => Number.isInteger(v) && v >= 199001 && v <= 209912 && v % 100 >= 1 && v % 100 <= 12

type Tagged = { type: string; value: unknown }

export interface EntityCheck {
  /** Would be rejected by the chain or breaks the data contract. Never sent. */
  problems: string[]
  /** Legal but suspicious; reported, still sent. */
  warnings: string[]
  attributeCount: number
  payloadBytes: number
  /** Longest str attribute, in UTF-8 bytes. */
  maxStr: { name: string; bytes: number } | null
  lifetimeDays: number | null
}

/** Checks one create against Arkiv's limits and, when `kind` is given, against Nazar's contract for that type. */
export function checkEntity(p: CreateEntityParameters, kind?: EntityType): EntityCheck {
  const problems: string[] = []
  const warnings: string[] = []
  const attrs = Object.entries((p.attributes ?? {}) as Record<string, unknown>)
  let maxStr: EntityCheck['maxStr'] = null

  if (attrs.length > MAX_ATTRIBUTES) problems.push(`${attrs.length} attributes > ${MAX_ATTRIBUTES}`)
  for (const [name, raw] of attrs) {
    if (!NAME_RE.test(name)) problems.push(`attribute name "${name}" breaks the grammar ^[A-Za-z][A-Za-z0-9._-]*$`)
    else if (RESERVED_ATTRIBUTE_NAMES.has(name.toLowerCase())) problems.push(`attribute name "${name}" is a reserved query word`)
    else if (bytes(name) > MAX_NAME_BYTES) problems.push(`attribute name "${name}" is longer than ${MAX_NAME_BYTES} bytes`)
    else if (!isValidAttributeName(name)) problems.push(`attribute name "${name}" is rejected by the SDK`)

    const t = raw as Tagged
    if (!t || typeof t !== 'object' || typeof t.type !== 'string') {
      problems.push(`attribute ${name} is not a typed value`)
      continue
    }
    switch (t.type) {
      case 'str': {
        const b = bytes(String(t.value))
        if (b > MAX_STRING_BYTES) problems.push(`attribute ${name} is ${b} bytes > ${MAX_STRING_BYTES}`)
        if (b === 0) warnings.push(`attribute ${name} is empty`)
        if (!maxStr || b > maxStr.bytes) maxStr = { name, bytes: b }
        break
      }
      case 'i32': {
        const v = t.value as number
        if (!Number.isInteger(v) || v < I32_MIN || v > I32_MAX) problems.push(`attribute ${name}=${String(v)} is not an i32`)
        else if (YM_ATTRS.has(name) && !isYm(v)) problems.push(`attribute ${name}=${v} is not a YYYYMM month`)
        break
      }
      case 'u64': {
        const v = t.value
        if (typeof v !== 'bigint' || v < 0n || v > U64_MAX) problems.push(`attribute ${name} is not a u64`)
        break
      }
      case 'key':
        if (!/^0x[0-9a-fA-F]{64}$/.test(String(t.value))) problems.push(`attribute ${name} is not a 32-byte entity key`)
        break
    }
  }

  if (!(p.payload instanceof Uint8Array)) problems.push('payload is not bytes')
  else if (p.payload.length > MAX_PAYLOAD_BYTES) problems.push(`payload ${p.payload.length} bytes > ${MAX_PAYLOAD_BYTES}`)
  if (!p.contentType) problems.push('missing content type')

  // Lifetimes are carried in blocks, so they are whole multiples of the 2 s block time by construction;
  // what can go wrong is a missing, zero or absurd value.
  let lifetimeDays: number | null = null
  const exp = p.expires as { minLifetime?: unknown; expiresAt?: unknown } | undefined
  if (!exp || typeof exp.minLifetime !== 'bigint') problems.push('expires must be built with ExpirationTime')
  else if (exp.minLifetime <= 0n && !(typeof exp.expiresAt === 'bigint' && exp.expiresAt > 0n)) problems.push('expires is zero')
  else lifetimeDays = Number(exp.minLifetime) / DAY_BLOCKS

  if (kind) {
    const a = Object.fromEntries(attrs) as Record<string, Tagged | undefined>
    if (a.project?.value !== PROJECT) problems.push(`project tag must be "${PROJECT}"`)
    if (a.t?.value !== kind) problems.push(`t must be "${kind}", got "${String(a.t?.value)}"`)
    if (a.v?.value !== SCHEMA_VERSION) problems.push(`v must be ${SCHEMA_VERSION}`)
    for (const r of REQUIRED[kind] ?? []) if (a[r] === undefined) problems.push(`missing attribute ${r}`)
    if (lifetimeDays !== null) {
      const [lo, hi] = LIFETIME_DAYS[kind]
      if (lifetimeDays < lo - 1e-9 || lifetimeDays > hi + 1e-9) problems.push(`lifetime ${lifetimeDays.toFixed(2)} days is outside ${lo}–${hi} for a ${kind}`)
    }
    if (kind === 'alert') {
      const n = (x: Tagged | undefined) => (typeof x?.value === 'number' ? x.value : NaN)
      const sev = n(a.sev)
      if (!(sev >= 1 && sev <= 5)) problems.push(`sev=${sev} is outside 1–5`)
      if (![0, 1].includes(n(a.peds))) problems.push('peds must be 0 or 1')
      const conf = n(a.conf)
      if (!(conf >= 0 && conf <= 100)) problems.push(`conf=${conf} is outside 0–100`)
      if (!p.flags?.readonly || !p.flags?.permissionlessExtension) problems.push('alerts must be readonly and permissionlessExtension')
      if (a.mfr?.value === 'unknown') warnings.push('manufacturer unknown')
      const exp = n(a.exp_ym)
      const alertYm = n(a.alert_ym)
      if (Number.isFinite(exp) && Number.isFinite(alertYm) && exp - alertYm > 800) warnings.push(`exp_ym ${exp} is more than 8 years after the alert (likely a misread; lifetime capped)`)
    }
    if ((kind === 'notice' || kind === 'snapshot' || kind === 'retraction') && !p.flags?.readonly) problems.push(`${kind} must be readonly`)
  }

  return { problems, warnings, attributeCount: attrs.length, payloadBytes: p.payload?.length ?? 0, maxStr, lifetimeDays }
}

export const isEntityType = (s: string): s is EntityType => (ENTITY_TYPES as readonly string[]).includes(s)

const pad32 = (n: number) => Math.ceil(n / 32) * 32

/**
 * Upper-bound calldata size of a batch. Every attribute is ABI-encoded as a (bytes32 name, uint8 type,
 * bytes value) tuple, about 160 bytes of words before its value, so 25 small attributes cost more
 * than a 1 KB payload. Calibrated against captured calldata (12 alerts ≈ 71 KB on Tiramisu).
 */
export function approxBatchBytes(creates: CreateEntityParameters[]): number {
  let total = 4 + 64
  for (const c of creates) {
    total += 256 + 160 + pad32(c.payload?.length ?? 0) + 160 + pad32(bytes(c.contentType ?? ''))
    for (const v of Object.values((c.attributes ?? {}) as Record<string, Tagged>)) total += 160 + pad32(Math.max(1, bytes(String(v?.value ?? ''))))
  }
  return total
}

// ---------------------------------------------------------------------------------------------
// Whole-ledger validation: build every notice and alert exactly as the publisher would.

export interface ChunkPlan {
  notice: boolean
  alerts: AlertRecord[]
}

/** Same chunking as the publisher: the first transaction carries the notice plus chunkSize−1 alerts. */
export function planChunks(alerts: AlertRecord[], noticeOnChain: boolean, chunkSize: number): ChunkPlan[] {
  const plan: ChunkPlan[] = []
  let rest = alerts
  if (!noticeOnChain) {
    plan.push({ notice: true, alerts: rest.slice(0, chunkSize - 1) })
    rest = rest.slice(chunkSize - 1)
  }
  for (let i = 0; i < rest.length; i += chunkSize) plan.push({ notice: false, alerts: rest.slice(i, i + chunkSize) })
  return plan
}

export interface SimulationLike {
  ok: boolean
  gas: string | null
  gasPrice: string | null
  costGlm: string | null
  calldataBytes?: number | null
  error?: string
}
export type SimulateCreates = (creates: CreateEntityParameters[], from: Hex | null) => Promise<SimulationLike>

export interface LedgerCheckOptions {
  /** Only notices from these sources. */
  sources?: string[]
  /** Only the first N notices (in publish order). */
  limitNotices?: number
  chunkSize: number
  /** Address used for key prediction and gas estimation; a fixed placeholder when null. */
  from: Hex | null
  chainId: number
  now?: Date
  /** eth_estimateGas on real calldata; null skips estimation (offline). */
  simulate?: SimulateCreates | null
  /** How many real chunks to estimate (spread over notices and sizes). */
  sampleChunks?: number
  /** Used when estimation is skipped or fails. */
  fallbackGasPerCreate: bigint
  fallbackGasPrice: bigint
}

export interface CheckFailure {
  kind: EntityType
  ref: string
  notice: string
  problems: string[]
}

export interface LedgerCheckReport {
  ok: boolean
  notices: { total: number; pending: number; onChain: number }
  entities: { notice: number; alert: number; total: number }
  /** What a publish would send right now (everything not yet on chain). */
  pending: { notices: number; alerts: number; creates: number; chunks: number }
  skipped: { curator: number; retracted: number; alreadyOnChain: number }
  bySource: Record<string, { notices: number; alerts: number; pendingAlerts: number }>
  chunks: { count: number; maxCreates: number; maxApproxBytes: number; sizes: Record<string, number> }
  limits: {
    maxAttributes: number
    maxStr: { name: string; bytes: number; ref: string } | null
    maxPayloadBytes: number
    alertLifetimeDays: { min: number; max: number } | null
  }
  links: { alertsChecked: number; broken: number }
  failures: CheckFailure[]
  warnings: { count: number; byMessage: Record<string, number> }
  gas: {
    method: 'eth_estimateGas' | 'fallback'
    samples: { notice: string; index: number; creates: number; ok: boolean; gas: string | null; calldataBytes: number | null; error?: string }[]
    gasPerCreate: string
    gasPrice: string
    totalGas: string
    totalGlm: string
    /** totalGlm plus a 25 % margin: what to have in the wallet before a live publish. */
    recommendedGlm: string
  }
}

const PLACEHOLDER_FROM = '0x000000000000000000000000000000000000dEaD' as Hex

/** Notices with publishable alerts, in the publisher's order (oldest alert month first). */
export function publishOrder(ledger: Ledger, o: { sources?: string[]; limit?: number; pendingOnly?: boolean } = {}): string[] {
  const where = [`retracted = 0`, `tier IN ('auto','machine_read')`]
  const args: (string | number)[] = []
  if (o.pendingOnly) where.push('entity_key IS NULL')
  if (o.sources?.length) {
    where.push(`source_id IN (${o.sources.map(() => '?').join(',')})`)
    args.push(...o.sources)
  }
  const sql = `SELECT notice_sha FROM alerts WHERE ${where.join(' AND ')} GROUP BY notice_sha ORDER BY MIN(alert_ym), notice_sha${o.limit ? ' LIMIT ?' : ''}`
  if (o.limit) args.push(o.limit)
  return (ledger.db.prepare(sql).all(...args) as { notice_sha: string }[]).map((r) => r.notice_sha)
}

interface LedgerAlertRow {
  rid: string
  data: string
  entity_key: string | null
  retracted: number
  tier: string
}

export async function validateLedger(ledger: Ledger, o: LedgerCheckOptions): Promise<LedgerCheckReport> {
  const now = o.now ?? new Date()
  const from = o.from ?? PLACEHOLDER_FROM
  const rep: LedgerCheckReport = {
    ok: true,
    notices: { total: 0, pending: 0, onChain: 0 },
    entities: { notice: 0, alert: 0, total: 0 },
    pending: { notices: 0, alerts: 0, creates: 0, chunks: 0 },
    skipped: { curator: 0, retracted: 0, alreadyOnChain: 0 },
    bySource: {},
    chunks: { count: 0, maxCreates: 0, maxApproxBytes: 0, sizes: {} },
    limits: { maxAttributes: 0, maxStr: null, maxPayloadBytes: 0, alertLifetimeDays: null },
    links: { alertsChecked: 0, broken: 0 },
    failures: [],
    warnings: { count: 0, byMessage: {} },
    gas: { method: 'fallback', samples: [], gasPerCreate: '0', gasPrice: '0', totalGas: '0', totalGlm: '0', recommendedGlm: '0' },
  }
  const fail = (f: CheckFailure) => {
    rep.failures.push(f)
    rep.ok = false
  }
  const track = (kind: EntityType, ref: string, notice: string, c: EntityCheck) => {
    rep.entities[kind === 'notice' ? 'notice' : 'alert']++
    rep.entities.total++
    rep.limits.maxAttributes = Math.max(rep.limits.maxAttributes, c.attributeCount)
    rep.limits.maxPayloadBytes = Math.max(rep.limits.maxPayloadBytes, c.payloadBytes)
    if (c.maxStr && (!rep.limits.maxStr || c.maxStr.bytes > rep.limits.maxStr.bytes)) rep.limits.maxStr = { ...c.maxStr, ref }
    if (kind === 'alert' && c.lifetimeDays !== null) {
      const l = rep.limits.alertLifetimeDays
      rep.limits.alertLifetimeDays = l ? { min: Math.min(l.min, c.lifetimeDays), max: Math.max(l.max, c.lifetimeDays) } : { min: c.lifetimeDays, max: c.lifetimeDays }
    }
    for (const w of c.warnings) {
      rep.warnings.count++
      const k = w.replace(/\d{6}/g, 'YYYYMM')
      rep.warnings.byMessage[k] = (rep.warnings.byMessage[k] ?? 0) + 1
    }
    if (c.problems.length) fail({ kind, ref, notice, problems: c.problems })
  }

  // Build every create once, with real predicted keys for the publisher address, so links are checked
  // exactly as they will exist on chain. The nonce is local to this check; a live publish predicts afresh.
  let nonce = 0n
  let salt = 1n
  const sampleable: { notice: string; index: number; creates: CreateEntityParameters[] }[] = []

  for (const sha of publishOrder(ledger, { sources: o.sources, limit: o.limitNotices })) {
    const n = ledger.getNotice(sha)
    if (!n) {
      fail({ kind: 'notice', ref: sha, notice: sha, problems: ['alerts point at a notice that is missing from the ledger'] })
      continue
    }
    rep.notices.total++
    const notice: NoticeRecord = n.record
    const src = (rep.bySource[notice.sourceId] ??= { notices: 0, alerts: 0, pendingAlerts: 0 })
    src.notices++

    const rows = ledger.db.prepare('SELECT rid, data, entity_key, retracted, tier FROM alerts WHERE notice_sha = ? ORDER BY rid').all(sha) as unknown as LedgerAlertRow[]
    const all: AlertRecord[] = []
    const pending: AlertRecord[] = []
    for (const r of rows) {
      if (!isPublishableTier(r.tier as AlertRecord['tier'])) {
        rep.skipped.curator++
        continue
      }
      if (r.retracted) {
        rep.skipped.retracted++
        continue
      }
      const rec = JSON.parse(r.data) as AlertRecord
      all.push(rec)
      if (r.entity_key) rep.skipped.alreadyOnChain++
      else pending.push(rec)
    }
    src.alerts += all.length
    src.pendingAlerts += pending.length
    if (n.entityKey) rep.notices.onChain++

    // 1. Every entity of the notice, published or not, must satisfy the contract.
    const noticeKeyForCheck = (n.entityKey as Hex | null) ?? predictEntityKey({ owner: from, nonce, salt, chainId: o.chainId })
    try {
      track('notice', sha, sha, checkEntity(buildNotice(notice, salt), 'notice'))
    } catch (err) {
      fail({ kind: 'notice', ref: sha, notice: sha, problems: [`builder threw: ${errorMessage(err)}`] })
    }
    for (const a of all) {
      try {
        track('alert', a.rid, sha, checkEntity(buildAlert(a, noticeKeyForCheck, now), 'alert'))
      } catch (err) {
        fail({ kind: 'alert', ref: a.rid, notice: sha, problems: [`builder threw: ${errorMessage(err)}`] })
      }
    }

    // 2. What a publish would send: chunk plan, predicted keys, and the notice link inside each batch.
    if (!pending.length) continue
    rep.notices.pending++
    rep.pending.notices++
    rep.pending.alerts += pending.length
    const plan = planChunks(pending, !!n.entityKey, o.chunkSize)
    let noticeKey = (n.entityKey as Hex | null) ?? null
    for (const [index, chunk] of plan.entries()) {
      const creates: CreateEntityParameters[] = []
      const keys: Hex[] = []
      const count = chunk.alerts.length + (chunk.notice ? 1 : 0)
      for (let i = 0; i < count; i++) {
        keys.push(predictEntityKey({ owner: from, nonce: nonce + BigInt(i), salt: salt + BigInt(i), chainId: o.chainId }))
      }
      if (chunk.notice) {
        noticeKey = keys[0]!
        creates.push(buildNotice(notice, salt))
      }
      chunk.alerts.forEach((a, i) => {
        const s = salt + BigInt(i + (chunk.notice ? 1 : 0))
        try {
          creates.push({ ...buildAlert(a, noticeKey, now), salt: s })
        } catch {
          // already reported above
        }
      })
      nonce += BigInt(count)
      salt += BigInt(count)

      // The link: every alert in this batch names the notice created in this same batch (first chunk)
      // or the notice already on chain (later chunks).
      for (const c of creates.slice(chunk.notice ? 1 : 0)) {
        rep.links.alertsChecked++
        const link = (c.attributes as Record<string, Tagged | undefined>).notice?.value
        const rid = String((c.attributes as Record<string, Tagged | undefined>).rid?.value ?? '?')
        if (!noticeKey || link !== noticeKey) {
          rep.links.broken++
          fail({ kind: 'alert', ref: rid, notice: sha, problems: [`notice link ${String(link)} does not match the batch's notice key ${noticeKey}`] })
        }
      }
      if (chunk.notice && creates[0] && (creates[0].attributes as Record<string, Tagged>).t?.value !== 'notice') {
        fail({ kind: 'notice', ref: sha, notice: sha, problems: ['the notice is not the first create of its batch'] })
      }

      const approx = approxBatchBytes(creates)
      rep.chunks.count++
      rep.chunks.maxCreates = Math.max(rep.chunks.maxCreates, creates.length)
      rep.chunks.maxApproxBytes = Math.max(rep.chunks.maxApproxBytes, approx)
      rep.chunks.sizes[String(creates.length)] = (rep.chunks.sizes[String(creates.length)] ?? 0) + 1
      if (creates.length > o.chunkSize) fail({ kind: 'notice', ref: `${sha}#${index}`, notice: sha, problems: [`batch of ${creates.length} creates > ${o.chunkSize}`] })
      if (approx > MAX_BATCH_BYTES) fail({ kind: 'notice', ref: `${sha}#${index}`, notice: sha, problems: [`batch is about ${approx} bytes > ${MAX_BATCH_BYTES}`] })
      rep.pending.creates += creates.length
      sampleable.push({ notice: sha, index, creates })
    }
    rep.pending.chunks += plan.length
  }

  // 3. Cost: eth_estimateGas on a spread of real chunks (no funds needed), scaled to every pending create.
  const samples = pickSamples(sampleable, o.sampleChunks ?? 3)
  let gasSum = 0n
  let createSum = 0
  let price: bigint | null = null
  if (o.simulate) {
    for (const s of samples) {
      const r = await o.simulate(s.creates, o.from).catch((err): SimulationLike => ({ ok: false, gas: null, gasPrice: null, costGlm: null, error: errorMessage(err) }))
      rep.gas.samples.push({ notice: s.notice, index: s.index, creates: s.creates.length, ok: r.ok, gas: r.gas, calldataBytes: r.calldataBytes ?? null, ...(r.error ? { error: r.error } : {}) })
      if (r.calldataBytes && r.calldataBytes > MAX_BATCH_BYTES) {
        fail({ kind: 'notice', ref: `${s.notice}#${s.index}`, notice: s.notice, problems: [`encoded batch is ${r.calldataBytes} bytes > ${MAX_BATCH_BYTES}`] })
      }
      if (r.ok && r.gas) {
        gasSum += BigInt(r.gas)
        createSum += s.creates.length
        if (r.gasPrice) price = BigInt(r.gasPrice)
      }
    }
  }
  const perCreate = createSum ? gasSum / BigInt(createSum) : o.fallbackGasPerCreate
  const gasPrice = price ?? o.fallbackGasPrice
  const totalGas = perCreate * BigInt(rep.pending.creates)
  rep.gas.method = createSum ? 'eth_estimateGas' : 'fallback'
  rep.gas.gasPerCreate = perCreate.toString()
  rep.gas.gasPrice = gasPrice.toString()
  rep.gas.totalGas = totalGas.toString()
  rep.gas.totalGlm = formatEther(totalGas * gasPrice)
  rep.gas.recommendedGlm = formatEther((totalGas * gasPrice * 125n) / 100n)
  return rep
}

/** A spread of chunks: the largest first-chunk (notice + alerts), a full alert-only chunk, then one per other source. */
function pickSamples<T extends { notice: string; index: number; creates: CreateEntityParameters[] }>(all: T[], n: number): T[] {
  if (n <= 0 || !all.length) return []
  const out: T[] = []
  const add = (x: T | undefined) => {
    if (x && !out.includes(x) && out.length < n) out.push(x)
  }
  const bySize = [...all].sort((a, b) => b.creates.length - a.creates.length)
  add(bySize.find((c) => c.index === 0))
  add(bySize.find((c) => c.index > 0))
  const seen = new Set(out.map((c) => c.notice))
  for (const c of all) if (!seen.has(c.notice)) (add(c), seen.add(c.notice))
  for (const c of bySize) add(c)
  return out
}
