// App-facing shapes. Every source (Nazar API, Arkiv, demo) is mapped onto these,
// so the UI never needs to know which one answered.

export type Category = 'adulterated' | 'spurious' | 'nsq' | 'misbranded'
export type ResultState = 'flagged' | 'retracted' | 'no_alert' | 'unreadable'
export type Tier = 'auto' | 'machine_read' | 'drug_level' | 'curator_only'
export type SourceKind = 'api' | 'arkiv' | 'demo'
/** Who answered a check; 'local' means the input was rejected on the device before any lookup. */
export type Answerer = SourceKind | 'local'

export type Alert = {
  /** Stable id: row id when known, else entity key, else batch. */
  id: string
  batch: string
  brand: string
  drug: string
  form: string
  manufacturer: string
  category: Category
  /** What failed, in the regulator's words when we have them. */
  failure: string
  severity: 1 | 2 | 3 | 4 | 5
  severityRules: string[]
  peds: boolean
  authority: string
  notice: string
  noticeDate: string
  /** Epoch ms used to order the notice timeline; larger is newer. */
  noticeOrder: number
  noticeUrl: string | null
  mfg: string | null
  expiry: string
  entityKey: string | null
  txHash: string | null
  creator: string | null
  sourceSha: string | null
  method: string | null
  confidence: number | null
  tier: Tier
  explorer: { entity: string | null; tx: string | null; creator: string | null }
  /** True for built-in sample records that are not published anywhere. */
  demo: boolean
  retraction?: { date: string; reason: string; authority: string }
}

type Base = { batch: string; asOf: Date; source: Answerer }

export type CheckResult =
  | (Base & { state: 'flagged' | 'retracted'; alert: Alert; alerts: Alert[] })
  | (Base & { state: 'no_alert' })
  | (Base & { state: 'unreadable'; suggestion?: string })

export type PipelineStatus =
  | { kind: 'checking' }
  | { kind: 'api'; lastOkMs: number | null }
  | { kind: 'arkiv'; lastOkMs: number | null }
  | { kind: 'offline' }

export const SOURCE_LABEL: Record<Answerer, string> = {
  api: 'Live · Nazar API',
  arkiv: 'Live · Arkiv',
  demo: 'Demo data',
  local: 'Checked on this device',
}

export const CATEGORY_MEANING: Record<Category, string> = {
  adulterated: 'Contains a substance that should not be there.',
  spurious: 'The named company says it never made this batch.',
  nsq: 'Not of Standard Quality: failed a lab test.',
  misbranded: 'The label is wrong or misleading.',
}

export const TIER_NOTE: Partial<Record<Tier, string>> = {
  machine_read: 'Machine-read, awaiting pharmacist confirmation',
  drug_level: 'Matched at drug level, not batch level',
}
