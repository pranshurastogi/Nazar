import {
  ExpirationTime,
  jsonToPayload,
  type CreateEntityParameters,
  type Entity,
} from '@arkiv-network/sdk'
import { i32, key, str, u64 } from '@arkiv-network/sdk/attr'
import type { Hex } from 'viem'

import { endOfYm, ymOf } from '../domain/dates.ts'
import type { AlertRecord, NoticeRecord } from '../domain/types.ts'

/**
 * Nazar's Arkiv data contract (documented for judges and other builders in /arkiv/schema.md).
 *
 * Every entity carries:
 *   project = PROJECT   unique tag so our queries never pick up other apps' data
 *   t       = type      notice | alert | retraction | heartbeat | snapshot
 *   v       = schema version
 * Queried fields live in typed attributes (numbers for ranges, YYYYMM ints for months);
 * display-only detail lives in the JSON payload.
 */
export const PROJECT = 'nazar-in-batch-alerts'
export const SCHEMA_VERSION = 1

export const ENTITY_TYPES = ['notice', 'alert', 'retraction', 'heartbeat', 'snapshot'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

const DAY = 24 * 60 * 60 * 1000

/** Lifetimes follow product logic, not a flat TTL. */
export const LIFETIME = {
  /** Source notices stay five years; they are the evidence behind every alert. */
  noticeDays: 5 * 365,
  /** Alerts live until the batch can no longer be sold, plus 180 days; never less than 90 days from now. */
  alertGraceDays: 180,
  alertMinDays: 90,
  /** Alerts with no printed expiry: three years from the alert month. */
  alertNoExpiryDays: 3 * 365,
  /** Retractions outlive the alert they correct by a year. */
  retractionExtraDays: 365,
  /** Heartbeat: 20 minutes, renewed every 5 by the worker, so a dead pipeline visibly disappears. */
  heartbeatMinutes: 20,
  /** Daily snapshot of the batch index: 7 days. */
  snapshotDays: 7,
} as const

const clampDays = (days: number) => Math.max(1, Math.ceil(days))

/** Whole days from `now` until the alert should expire. */
export function alertLifetimeDays(a: Pick<AlertRecord, 'expYm' | 'alertYm'>, now = new Date()): number {
  const until = a.expYm
    ? endOfYm(a.expYm).getTime() + LIFETIME.alertGraceDays * DAY
    : endOfYm(a.alertYm).getTime() + LIFETIME.alertNoExpiryDays * DAY
  return clampDays(Math.max((until - now.getTime()) / DAY, LIFETIME.alertMinDays))
}

const slug = (s: string | null | undefined, max = 64) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)

/** Strings on Arkiv are capped at 128 UTF-8 bytes; keep attributes short and put the long form in the payload. */
export const short = (s: string, maxBytes = 120) => {
  const enc = new TextEncoder()
  if (enc.encode(s).length <= maxBytes) return s
  let out = s
  while (enc.encode(out).length > maxBytes) out = out.slice(0, -1)
  return out
}

const base = (t: EntityType) => ({ project: str(PROJECT), t: str(t), v: i32(SCHEMA_VERSION) })

export interface NoticePayload {
  title: string
  authority: string
  jurisdiction: string
  url: string
  publishedAt: string | null
  sha256: string
  rows: number
  parser: string
  method: string
}

export function buildNotice(n: NoticeRecord, salt?: bigint): CreateEntityParameters {
  const payload: NoticePayload = {
    title: n.title,
    authority: n.authority,
    jurisdiction: n.jurisdiction,
    url: n.url,
    publishedAt: n.publishedAt,
    sha256: n.sha,
    rows: n.rows,
    parser: n.parser,
    method: n.method,
  }
  return {
    payload: jsonToPayload(payload),
    contentType: 'application/json',
    attributes: {
      ...base('notice'),
      src: str(n.sourceId),
      juris: str(n.jurisdiction),
      notice_ym: i32(n.noticeYm),
      sha: str(n.sha),
      rows: i32(n.rows),
      parser: str(short(n.parser, 64)),
    },
    expires: ExpirationTime.fromDays(LIFETIME.noticeDays),
    flags: { readonly: true },
    ...(salt !== undefined ? { salt } : {}),
  }
}

export interface AlertPayload {
  product: string
  generic: string | null
  manufacturer: string | null
  manufacturerRole: AlertRecord['manufacturerRole']
  reason: string
  failures: string[]
  severityRules: string[]
  ruleVersion: string
  authority: string
  noticeTitle: string
  noticeUrl: string
  noticeDate: string | null
  noticeSha: string
  mfgYm: number | null
  expYm: number | null
  tier: AlertRecord['tier']
}

export function buildAlert(a: AlertRecord, noticeKey: Hex | null, now = new Date()): CreateEntityParameters {
  const payload: AlertPayload = {
    product: a.product,
    generic: a.generic,
    manufacturer: a.manufacturer,
    manufacturerRole: a.manufacturerRole,
    reason: a.reason,
    failures: a.failures,
    severityRules: a.severityRules,
    ruleVersion: a.ruleVersion,
    authority: a.authority,
    noticeTitle: a.noticeTitle,
    noticeUrl: a.noticeUrl,
    noticeDate: a.noticeDate,
    noticeSha: a.noticeSha,
    mfgYm: a.mfgYm,
    expYm: a.expYm,
    tier: a.tier,
  }
  return {
    payload: jsonToPayload(payload),
    contentType: 'application/json',
    attributes: {
      ...base('alert'),
      batch: str(short(a.batchKey, 64)),
      batch_raw: str(short(a.batch, 64)),
      case: str(a.caseId),
      rid: str(a.rid),
      brand: str(short(slug(a.brand), 64) || 'unknown'),
      form: str(a.form),
      cat: str(a.category),
      fail: str(a.failures[0] ?? 'other'),
      sev: i32(a.severity),
      peds: i32(a.peds ? 1 : 0),
      mfr: str(short(slug(a.manufacturer) || 'unknown', 64)),
      ...(a.plantId ? { plant: str(short(a.plantId, 64)) } : {}),
      ...(a.state ? { state: str(a.state) } : {}),
      ...(a.mfgYm ? { mfg_ym: i32(a.mfgYm) } : {}),
      ...(a.expYm ? { exp_ym: i32(a.expYm) } : {}),
      alert_ym: i32(a.alertYm),
      src: str(a.sourceId),
      juris: str(a.jurisdiction),
      ...(noticeKey ? { notice: key(noticeKey) } : {}),
      conf: i32(Math.round(a.confidence * 100)),
      method: str(a.method),
      tier: str(a.tier),
    },
    expires: ExpirationTime.fromDays(alertLifetimeDays(a, now)),
    // readonly: nobody, not even Nazar, can rewrite an alert. Corrections are new retraction entities.
    // permissionlessExtension: anyone (a chemist, an NGO) can keep an alert alive while the batch is still on shelves.
    flags: { readonly: true, permissionlessExtension: true },
  }
}

export type RetractionReason = 'appeal' | 'correction' | 'duplicate' | 'superseded'

export function buildRetraction(input: {
  alertKey: Hex
  caseId: string
  reason: RetractionReason
  sourceId: string
  note: string
  remainingAlertDays: number
}): CreateEntityParameters {
  return {
    payload: jsonToPayload({ note: input.note }),
    contentType: 'application/json',
    attributes: {
      ...base('retraction'),
      alert: key(input.alertKey),
      case: str(input.caseId),
      reason: str(input.reason),
      src: str(input.sourceId),
    },
    expires: ExpirationTime.fromDays(clampDays(input.remainingAlertDays + LIFETIME.retractionExtraDays)),
    flags: { readonly: true },
  }
}

export interface HeartbeatPayload {
  worker: string
  lastOkMs: number
  sources: Record<string, { lastCheckedMs: number; ok: boolean; docs: number }>
  alerts: number
  version: string
}

export function buildHeartbeat(h: HeartbeatPayload): CreateEntityParameters {
  return {
    payload: jsonToPayload(h),
    contentType: 'application/json',
    attributes: { ...base('heartbeat'), worker: str(h.worker), last_ok: u64(BigInt(h.lastOkMs)) },
    expires: ExpirationTime.fromMinutes(LIFETIME.heartbeatMinutes),
  }
}

export function buildSnapshot(s: { day: number; count: number; sha256: string; batches: string[] }): CreateEntityParameters {
  return {
    payload: jsonToPayload({ batches: s.batches }),
    contentType: 'application/json',
    attributes: { ...base('snapshot'), day: i32(s.day), count: i32(s.count), sha: str(s.sha256) },
    expires: ExpirationTime.fromDays(LIFETIME.snapshotDays),
    flags: { readonly: true },
  }
}

// ---------------------------------------------------------------------------------------------
// Decoding: Arkiv entity → plain objects the API and web app use.

type Attr = { type: string; value: unknown }
const attrs = (e: Pick<Entity, 'attributes'>) => (e.attributes ?? {}) as Record<string, Attr | undefined>
const s = (a: Attr | undefined) => (a ? String(a.value) : null)
const n = (a: Attr | undefined) => (a === undefined ? null : Number(a.value))

export interface AlertView {
  entityKey: Hex
  creator: Hex | null
  owner: Hex | null
  expiresAtBlock: string | null
  createdAtBlock: string | null
  batchKey: string
  batch: string
  caseId: string
  rid: string
  brand: string
  form: string
  category: string
  failure: string
  severity: number
  peds: boolean
  manufacturerSlug: string
  state: string | null
  mfgYm: number | null
  expYm: number | null
  alertYm: number
  sourceId: string
  jurisdiction: string
  noticeKey: string | null
  confidence: number
  method: string
  tier: string
  payload: AlertPayload | null
}

export function decodeAlert(e: Entity): AlertView {
  const a = attrs(e)
  let payload: AlertPayload | null = null
  try {
    payload = e.payload && e.payload.length ? (e.toJson() as AlertPayload) : null
  } catch {
    payload = null
  }
  return {
    entityKey: e.key as Hex,
    creator: (e.creator as Hex | undefined) ?? null,
    owner: (e.owner as Hex | undefined) ?? null,
    expiresAtBlock: e.expiresAt !== undefined ? String(e.expiresAt) : null,
    createdAtBlock: e.createdAt !== undefined ? String(e.createdAt) : null,
    batchKey: s(a.batch) ?? '',
    batch: s(a.batch_raw) ?? s(a.batch) ?? '',
    caseId: s(a.case) ?? '',
    rid: s(a.rid) ?? '',
    brand: s(a.brand) ?? '',
    form: s(a.form) ?? 'other',
    category: s(a.cat) ?? 'nsq',
    failure: s(a.fail) ?? 'other',
    severity: n(a.sev) ?? 1,
    peds: n(a.peds) === 1,
    manufacturerSlug: s(a.mfr) ?? '',
    state: s(a.state),
    mfgYm: n(a.mfg_ym),
    expYm: n(a.exp_ym),
    alertYm: n(a.alert_ym) ?? ymOf(new Date()),
    sourceId: s(a.src) ?? '',
    jurisdiction: s(a.juris) ?? 'IN',
    noticeKey: s(a.notice),
    confidence: (n(a.conf) ?? 0) / 100,
    method: s(a.method) ?? 'text',
    tier: s(a.tier) ?? 'auto',
    payload,
  }
}
