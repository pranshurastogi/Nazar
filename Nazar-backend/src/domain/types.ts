import { z } from 'zod'

import { CATEGORIES, DOSAGE_FORMS, FAILURES, PRODUCT_CLASSES } from './vocab.ts'

/**
 * Stage contracts. Every stage reads and writes these shapes, so each one can be
 * re-run on its own and its output checked in tests.
 *
 *   discover → DiscoveredDoc → harvest → RawDoc → extract → ExtractedRow[]
 *            → resolve → AlertRecord[] + NoticeRecord → publish → Arkiv entities
 */

export const Jurisdiction = z.string().regex(/^IN(-[A-Z]{2})?$/) // ISO 3166-2:IN, e.g. IN, IN-TN, IN-KL
export type Jurisdiction = z.infer<typeof Jurisdiction>

export const DiscoveredDoc = z.object({
  sourceId: z.string(),
  url: z.url(),
  title: z.string(),
  authority: z.string(),
  jurisdiction: Jurisdiction,
  /** ISO date the notice was published, when the listing shows one. */
  publishedAt: z.string().nullable().default(null),
  /** YYYYMM the alert list covers, when known. */
  noticeYm: z.number().int().nullable().default(null),
  kind: z.enum(['pdf', 'html', 'image']),
  /** Extra hints for the extractor (e.g. which parser profile to use). */
  hints: z.record(z.string(), z.string()).default({}),
})
export type DiscoveredDoc = z.infer<typeof DiscoveredDoc>

export const RawDoc = DiscoveredDoc.extend({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  path: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  fetchedAt: z.string(),
  finalUrl: z.url(),
})
export type RawDoc = z.infer<typeof RawDoc>

export const ExtractMethod = z.enum(['api', 'text', 'ocr', 'llm', 'html', 'curated'])
export type ExtractMethod = z.infer<typeof ExtractMethod>

export const ExtractedRow = z.object({
  /** hash(source sha, row number, parser version): stable across re-runs, used for idempotent publishing. */
  rid: z.string(),
  sourceSha: z.string(),
  rowNo: z.number().int().positive(),
  page: z.number().int().positive().nullable(),
  product: z.string().min(1),
  batch: z.string().min(1),
  mfgYm: z.number().int().nullable(),
  expYm: z.number().int().nullable(),
  manufacturer: z.string().nullable(),
  reason: z.string().nullable(),
  /** The regulator or lab that drew/tested the sample, if listed. */
  reportedBy: z.string().nullable(),
  method: ExtractMethod,
  parser: z.string(),
  confidence: z.number().min(0).max(1),
  /** Why confidence is below 1, for the curator queue. */
  issues: z.array(z.string()).default([]),
  rawText: z.string(),
})
export type ExtractedRow = z.infer<typeof ExtractedRow>

export const ExtractionResult = z.object({
  sourceSha: z.string(),
  parser: z.string(),
  method: ExtractMethod,
  pages: z.number().int().nonnegative(),
  rows: z.array(ExtractedRow),
  rejected: z.array(z.object({ rowNo: z.number().int(), page: z.number().int().nullable(), rawText: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
})
export type ExtractionResult = z.infer<typeof ExtractionResult>

export const PublishTier = z.enum(['auto', 'machine_read', 'drug_level', 'curator_only'])
export type PublishTier = z.infer<typeof PublishTier>

export const AlertRecord = z.object({
  rid: z.string(),
  caseId: z.string(),
  batch: z.string(),
  batchKey: z.string(),
  brand: z.string(),
  product: z.string(),
  generic: z.string().nullable(),
  form: z.enum(DOSAGE_FORMS),
  category: z.enum(CATEGORIES),
  failures: z.array(z.enum(FAILURES)).min(1),
  reason: z.string(),
  severity: z.number().int().min(1).max(5),
  severityRules: z.array(z.string()),
  ruleVersion: z.string(),
  peds: z.boolean(),
  manufacturer: z.string().nullable(),
  /** "label_claim" for spurious batches: the named maker is the forged one, not the culprit. */
  manufacturerRole: z.enum(['maker', 'label_claim']),
  plantId: z.string().nullable(),
  state: z.string().nullable(),
  mfgYm: z.number().int().nullable(),
  expYm: z.number().int().nullable(),
  /** Month of the notice, or for undated lists the month Nazar first saw the row (see dateKnown). */
  alertYm: z.number().int(),
  /**
   * False when the regulator gave no date for this row (Maharashtra's running table): alertYm is
   * then only the month Nazar first saw it. Absent on records resolved before this field existed.
   */
  dateKnown: z.boolean().optional(),
  /** Medicine, cosmetic or household hygiene product (see classifyProduct). Absent = medicine. */
  productClass: z.enum(PRODUCT_CLASSES).optional(),
  /** Set by the ledger when a repeat listing of the same batch on the same notice was merged into this rid. */
  supersededBy: z.string().optional(),
  sourceId: z.string(),
  authority: z.string(),
  jurisdiction: Jurisdiction,
  noticeSha: z.string(),
  noticeTitle: z.string(),
  noticeUrl: z.string(),
  noticeDate: z.string().nullable(),
  method: ExtractMethod,
  confidence: z.number().min(0).max(1),
  tier: PublishTier,
})
export type AlertRecord = z.infer<typeof AlertRecord>

export const NoticeRecord = z.object({
  sha: z.string(),
  sourceId: z.string(),
  authority: z.string(),
  jurisdiction: Jurisdiction,
  title: z.string(),
  url: z.string(),
  publishedAt: z.string().nullable(),
  noticeYm: z.number().int(),
  rows: z.number().int().nonnegative(),
  parser: z.string(),
  method: ExtractMethod,
})
export type NoticeRecord = z.infer<typeof NoticeRecord>
