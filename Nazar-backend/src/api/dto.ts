import type { AlertView } from '../arkiv/schema.ts'
import { CATEGORIES, DOSAGE_FORMS, FAILURES } from '../domain/vocab.ts'
import type { AlertRecord, NoticeRecord } from '../domain/types.ts'
import type { AlertRow } from '../storage/ledger.ts'

/** Wire shapes for the web app. AlertDTO = the resolved record plus where it lives on Arkiv. */

export interface Explorer {
  entity: string | null
  tx: string | null
}

export type AlertDTO = AlertRecord & {
  entityKey: string | null
  txHash: string | null
  creator: string | null
  publishedAt: string | null
  retracted: boolean
  explorer: Explorer
}

export type NoticeDTO = NoticeRecord & { entityKey: string | null; txHash: string | null; explorer: Explorer }

export interface DtoContext {
  publisher: string | null
  explorerBase: string
}

const isHash = (s: string | null | undefined): s is string => !!s && /^0x[0-9a-fA-F]{64}$/.test(s)

export function explorerFor(ctx: DtoContext, entityKey: string | null, txHash: string | null): Explorer {
  return {
    entity: isHash(entityKey) ? `${ctx.explorerBase}/entity/${entityKey}` : null,
    tx: isHash(txHash) ? `${ctx.explorerBase}/tx/${txHash}` : null,
  }
}

export function alertDto(row: AlertRow, ctx: DtoContext): AlertDTO {
  const txHash = isHash(row.txHash) ? row.txHash : null
  return {
    ...row.record,
    entityKey: row.entityKey,
    txHash,
    creator: row.entityKey ? ctx.publisher : null,
    publishedAt: row.publishedAt,
    retracted: row.retracted,
    explorer: explorerFor(ctx, row.entityKey, txHash),
  }
}

const oneOf = <T extends string>(list: readonly T[], v: string | undefined, fallback: T): T => (list as readonly string[]).includes(v ?? '') ? (v as T) : fallback

/** An alert read straight from Arkiv (when the local ledger has nothing), mapped onto the same DTO. */
export function viewDto(v: AlertView, retracted: boolean, ctx: DtoContext): AlertDTO {
  const p = v.payload
  const failures = (p?.failures ?? [v.failure]).filter((f): f is (typeof FAILURES)[number] => (FAILURES as readonly string[]).includes(f))
  return {
    rid: v.rid,
    caseId: v.caseId,
    batch: v.batch,
    batchKey: v.batchKey,
    brand: p?.product && v.brand === 'unknown' ? p.product : v.brand,
    product: p?.product ?? v.brand,
    generic: p?.generic ?? null,
    form: oneOf(DOSAGE_FORMS, v.form, 'other'),
    category: oneOf(CATEGORIES, v.category, 'nsq'),
    failures: failures.length ? failures : ['other'],
    reason: p?.reason ?? '',
    severity: Math.min(5, Math.max(1, v.severity)),
    severityRules: p?.severityRules ?? [],
    ruleVersion: p?.ruleVersion ?? '',
    peds: v.peds,
    manufacturer: p?.manufacturer ?? null,
    manufacturerRole: p?.manufacturerRole ?? 'maker',
    plantId: null,
    state: v.state,
    mfgYm: v.mfgYm,
    expYm: v.expYm,
    alertYm: v.alertYm,
    sourceId: v.sourceId,
    authority: p?.authority ?? '',
    jurisdiction: v.jurisdiction,
    noticeSha: p?.noticeSha ?? '',
    noticeTitle: p?.noticeTitle ?? '',
    noticeUrl: p?.noticeUrl ?? '',
    noticeDate: p?.noticeDate ?? null,
    method: (p ? v.method : 'text') as AlertRecord['method'],
    confidence: v.confidence,
    tier: oneOf(['auto', 'machine_read', 'drug_level', 'curator_only'] as const, v.tier, 'auto'),
    entityKey: v.entityKey,
    txHash: null,
    creator: v.creator,
    publishedAt: null,
    retracted,
    explorer: explorerFor(ctx, v.entityKey, null),
  }
}

export function noticeDto(r: { record: NoticeRecord; entityKey: string | null; txHash: string | null }, ctx: DtoContext): NoticeDTO {
  const txHash = isHash(r.txHash) ? r.txHash : null
  return { ...r.record, entityKey: r.entityKey, txHash, explorer: explorerFor(ctx, r.entityKey, txHash) }
}
