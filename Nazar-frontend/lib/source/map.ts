import { explorerAddress, explorerEntity, explorerTx } from './config'
import type { Alert, Category, Tier } from './types'

// Maps API DTOs and Arkiv entities onto the app's Alert shape.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 202704 → "Apr 2027". */
export function formatYm(ym: number | null | undefined): string | null {
  if (!ym) return null
  const y = Math.floor(ym / 100)
  const m = ym % 100
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : null
}

/** ISO date (or date-time) → "13 Oct 2025"; anything unparseable is returned as-is. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso)
  if (!m) return iso
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return iso
  return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`
}

/** Epoch ms for sorting notices: the notice date when parseable, else the alert month. */
export function noticeOrder(date: string | null | undefined, ym: number | null | undefined): number {
  const t = date ? Date.parse(date) : NaN
  if (!Number.isNaN(t)) return t
  return ym ? Date.UTC(Math.floor(ym / 100), (ym % 100) - 1, 1) : 0
}

const FAILURE_LABEL: Record<string, string> = {
  spurious: 'Spurious: the named maker says it did not make this batch',
  glycol: 'Contaminated with a toxic glycol (DEG/EG)',
  identification: 'Failed identification: active ingredient not found',
  sterility: 'Failed sterility test',
  endotoxin: 'Failed bacterial endotoxin test',
  particulate: 'Particulate matter found',
  assay: 'Wrong strength (assay)',
  related_substances: 'Excess impurities (related substances)',
  dissolution: 'Does not dissolve properly (dissolution)',
  disintegration: 'Does not break down properly (disintegration)',
  labelling: 'Labelling or misbranding problem',
  microbial: 'Microbial contamination',
  description: 'Looks wrong (description)',
  ph: 'pH out of range',
  uniformity: 'Uneven content or weight',
  other: 'Failed a quality test',
}

const CATEGORIES: Category[] = ['adulterated', 'spurious', 'nsq', 'misbranded']
const TIERS: Tier[] = ['auto', 'machine_read', 'drug_level', 'curator_only']

const asCategory = (c: unknown): Category => (CATEGORIES.includes(c as Category) ? (c as Category) : 'nsq')
const asTier = (t: unknown): Tier => (TIERS.includes(t as Tier) ? (t as Tier) : 'auto')
const asSeverity = (n: unknown): Alert['severity'] => Math.min(5, Math.max(1, Math.round(Number(n) || 1))) as Alert['severity']
const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const failureText = (reason: string | null | undefined, code: string | undefined) =>
  reason?.trim() || FAILURE_LABEL[code ?? 'other'] || FAILURE_LABEL.other!
const manufacturerText = (m: string | null | undefined, role?: string) =>
  !m ? 'Manufacturer not listed' : role === 'label_claim' ? `${m} (named on the label)` : m

/** AlertDTO from the Nazar API: AlertRecord fields plus publication metadata. */
export type AlertDTO = {
  rid: string
  caseId?: string
  batch: string
  batchKey?: string
  brand?: string
  product?: string
  generic?: string | null
  form?: string
  category?: string
  failures?: string[]
  reason?: string
  severity?: number
  severityRules?: string[]
  peds?: boolean
  manufacturer?: string | null
  manufacturerRole?: string
  mfgYm?: number | null
  expYm?: number | null
  alertYm?: number
  authority?: string
  noticeSha?: string
  noticeTitle?: string
  noticeUrl?: string
  noticeDate?: string | null
  method?: string
  confidence?: number
  tier?: string
  entityKey?: string | null
  txHash?: string | null
  creator?: string | null
  publishedAt?: string | null
  retracted?: boolean
  explorer?: { entity?: string | null; tx?: string | null }
}

export function fromDto(d: AlertDTO): Alert {
  const authority = d.authority || 'Drug regulator'
  return {
    id: d.rid || d.entityKey || d.batch,
    batch: d.batch,
    brand: d.brand?.trim() || d.product?.trim() || 'Unnamed product',
    drug: d.generic || d.product || '',
    form: titleCase(d.form || 'other'),
    manufacturer: manufacturerText(d.manufacturer, d.manufacturerRole),
    category: asCategory(d.category),
    failure: failureText(d.reason, d.failures?.[0]),
    severity: asSeverity(d.severity),
    severityRules: d.severityRules ?? [],
    peds: !!d.peds,
    authority,
    notice: d.noticeTitle || 'Regulator notice',
    noticeDate: formatDate(d.noticeDate) ?? formatYm(d.alertYm) ?? 'Date not listed',
    noticeOrder: noticeOrder(d.noticeDate, d.alertYm),
    noticeUrl: d.noticeUrl || null,
    mfg: formatYm(d.mfgYm),
    expiry: formatYm(d.expYm) ?? 'Not listed',
    entityKey: d.entityKey ?? null,
    txHash: d.txHash ?? null,
    creator: d.creator ?? null,
    sourceSha: d.noticeSha || null,
    method: d.method ?? null,
    confidence: typeof d.confidence === 'number' ? d.confidence : null,
    tier: asTier(d.tier),
    explorer: {
      entity: d.explorer?.entity ?? (d.entityKey ? explorerEntity(d.entityKey) : null),
      tx: d.explorer?.tx ?? (d.txHash ? explorerTx(d.txHash) : null),
      creator: d.creator ? explorerAddress(d.creator) : null,
    },
    demo: false,
    ...(d.retracted ? { retraction: { date: '', reason: 'Withdrawn by the regulator', authority } } : {}),
  }
}

/** Decoded Arkiv alert entity (attributes + JSON payload), mirroring decodeAlert in the backend. */
export type ArkivAlert = {
  entityKey: string
  creator: string | null
  batchKey: string
  batch: string
  rid: string
  brand: string
  form: string
  category: string
  failure: string
  severity: number
  peds: boolean
  mfgYm: number | null
  expYm: number | null
  alertYm: number | null
  confidence: number
  method: string
  tier: string
  payload: {
    product?: string
    generic?: string | null
    manufacturer?: string | null
    manufacturerRole?: string
    reason?: string
    severityRules?: string[]
    authority?: string
    noticeTitle?: string
    noticeUrl?: string
    noticeDate?: string | null
    noticeSha?: string
  } | null
  retraction?: { reason: string; note: string | null }
}

const RETRACTION_REASON: Record<string, string> = {
  appeal: 'Withdrawn after re-testing on appeal',
  correction: 'Corrected by the regulator',
  duplicate: 'Duplicate of another notice',
  superseded: 'Superseded by a newer notice',
}

export function fromArkiv(a: ArkivAlert): Alert {
  const p = a.payload ?? {}
  const authority = p.authority || 'Drug regulator'
  return {
    id: a.rid || a.entityKey,
    batch: a.batch || a.batchKey.toUpperCase(),
    brand: p.product?.trim() || titleCase(a.brand || 'Unnamed product'),
    drug: p.generic || '',
    form: titleCase(a.form || 'other'),
    manufacturer: manufacturerText(p.manufacturer, p.manufacturerRole),
    category: asCategory(a.category),
    failure: failureText(p.reason, a.failure),
    severity: asSeverity(a.severity),
    severityRules: p.severityRules ?? [],
    peds: a.peds,
    authority,
    notice: p.noticeTitle || 'Regulator notice',
    noticeDate: formatDate(p.noticeDate) ?? formatYm(a.alertYm) ?? 'Date not listed',
    noticeOrder: noticeOrder(p.noticeDate, a.alertYm),
    noticeUrl: p.noticeUrl || null,
    mfg: formatYm(a.mfgYm),
    expiry: formatYm(a.expYm) ?? 'Not listed',
    entityKey: a.entityKey,
    txHash: null,
    creator: a.creator,
    sourceSha: p.noticeSha || null,
    method: a.method || null,
    confidence: a.confidence,
    tier: asTier(a.tier),
    explorer: {
      entity: explorerEntity(a.entityKey),
      tx: null,
      creator: a.creator ? explorerAddress(a.creator) : null,
    },
    demo: false,
    ...(a.retraction
      ? { retraction: { date: '', reason: RETRACTION_REASON[a.retraction.reason] ?? 'Withdrawn by the regulator', authority } }
      : {}),
  }
}
