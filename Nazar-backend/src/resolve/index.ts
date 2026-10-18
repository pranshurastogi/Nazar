import { cleanBatch, isUnspecifiedBatch, matchKey, unspecifiedBatchKey } from '../domain/batch.ts'
import { findYmInText, isFirstSeenIssue, parseYm, ymOf } from '../domain/dates.ts'
import { scoreSeverity } from '../domain/severity.ts'
import type { AlertRecord, ExtractedRow, NoticeRecord, RawDoc } from '../domain/types.ts'
import { classifyCategory, classifyFailures, classifyProduct, detectForm, isPaediatric, type Category } from '../domain/vocab.ts'
import { PUBLISHABLE_TIERS, batchUncertain, caseIdFor, isPublishableTier, tierFor } from './case.ts'
import { productKey, slugify, splitDrug } from './drug.ts'
import { parseManufacturer } from './manufacturer.ts'

export { caseIdFor, isPublishableTier, tierFor } from './case.ts'
export { productKey, splitDrug } from './drug.ts'
export { parseManufacturer, stateFromPin } from './manufacturer.ts'

/**
 * Resolve: extracted rows → typed alert records + the notice they came from.
 * Pure and deterministic, so re-running it on the same rows yields the same records
 * (and the same rids and case ids), which is what makes publishing idempotent.
 */

/**
 * Which month the notice covers: listing hint, then title, then the publish date, then fetch date.
 * `known` is false only for the last resort: the fetch month is when we looked, not a notice date.
 */
export function noticeMonthOf(doc: RawDoc): { ym: number; known: boolean } {
  const ym =
    doc.noticeYm ??
    findYmInText(doc.title) ??
    (doc.publishedAt ? parseYm(doc.publishedAt.slice(0, 7)) ?? ymOf(new Date(doc.publishedAt)) : null)
  return ym ? { ym, known: true } : { ym: ymOf(new Date(doc.fetchedAt)), known: false }
}

export const noticeYmOf = (doc: RawDoc): number => noticeMonthOf(doc).ym

const isSpuriousDoc = (doc: RawDoc) =>
  doc.hints.category === 'spurious' || doc.hints.tab === 'spurious' || /spurious/i.test(doc.title)

export function resolveRow(doc: RawDoc, row: ExtractedRow, month = noticeMonthOf(doc)): AlertRecord {
  const batch = cleanBatch(row.batch) ?? row.batch.trim().toUpperCase()
  // A notice row with no batch is a drug-level record: visible in the ledger, never a batch match.
  const unspecified = isUnspecifiedBatch(batch)
  const batchKey = unspecified ? unspecifiedBatchKey(batch) : matchKey(batch)
  const spuriousDoc = isSpuriousDoc(doc)
  const reason = (row.reason ?? '').replace(/\s+/g, ' ').trim() || (spuriousDoc ? 'Spurious drug' : 'Not of standard quality')
  const failures0 = classifyFailures(reason)
  const failures = spuriousDoc && !failures0.includes('spurious') ? (['spurious', ...failures0.filter((f) => f !== 'other')] as typeof failures0) : failures0
  const category: Category = spuriousDoc ? 'spurious' : classifyCategory(reason, failures)
  const drug = splitDrug(row.product, row.rawText)
  const form = detectForm(row.product)
  // Reviewed seeds can state paediatric use explicitly when the cited source says so.
  const pedsHint = (doc.hints.pedsBatches ?? '').split(',')
  const peds = isPaediatric(row.product) || pedsHint.includes('*') || pedsHint.includes(batchKey)
  const sev = scoreSeverity({ failures, category, form, peds, product: row.product })
  const mfr = parseManufacturer(row.manufacturer)
  const discriminator = drug.hasBrand ? `b:${slugify(drug.brand)}` : mfr ? `m:${mfr.key}` : `p:${slugify(drug.generic ?? row.product, 40)}`
  return {
    rid: row.rid,
    caseId: caseIdFor(batchKey, discriminator),
    batch,
    batchKey,
    brand: drug.brand,
    product: row.product.replace(/\s+/g, ' ').trim(),
    generic: drug.generic,
    form,
    category,
    failures,
    reason,
    severity: sev.severity,
    severityRules: sev.rules,
    ruleVersion: sev.version,
    peds,
    manufacturer: mfr?.name ?? null,
    // On a spurious batch the named maker is the one being impersonated, not the culprit.
    manufacturerRole: category === 'spurious' ? 'label_claim' : 'maker',
    plantId: mfr?.plantId ?? null,
    state: mfr?.state ?? null,
    mfgYm: row.mfgYm,
    expYm: row.expYm,
    alertYm: month.ym,
    // Rows from undated pages carry the "first seen" issue: their month is ours, not the regulator's.
    dateKnown: month.known && !row.issues.some(isFirstSeenIssue),
    productClass: classifyProduct(row.product, row.manufacturer),
    sourceId: doc.sourceId,
    authority: doc.authority,
    jurisdiction: doc.jurisdiction,
    noticeSha: doc.sha256,
    noticeTitle: doc.title,
    noticeUrl: doc.url,
    noticeDate: doc.publishedAt,
    method: row.method,
    confidence: row.confidence,
    tier: unspecified ? 'drug_level' : tierFor(row.confidence, batchUncertain(batch, row.issues)),
  }
}

export function noticeFor(doc: RawDoc, rows: ExtractedRow[]): NoticeRecord {
  return {
    sha: doc.sha256,
    sourceId: doc.sourceId,
    authority: doc.authority,
    jurisdiction: doc.jurisdiction,
    title: doc.title,
    url: doc.url,
    publishedAt: doc.publishedAt,
    noticeYm: noticeYmOf(doc),
    rows: rows.length,
    parser: rows[0]?.parser ?? doc.hints.parser ?? 'unknown',
    method: rows[0]?.method ?? (doc.kind === 'html' ? 'html' : 'text'),
  }
}

/** Same notice, same batch, same maker, same product once case, spacing, punctuation and form words are folded. */
export function duplicateKey(rec: AlertRecord, row: ExtractedRow): string {
  return [rec.noticeSha, rec.batchKey, parseManufacturer(row.manufacturer)?.key ?? '', productKey(row.product)].join('|')
}

const tierRank = (t: AlertRecord['tier']) => {
  const i = PUBLISHABLE_TIERS.indexOf(t)
  return i < 0 ? PUBLISHABLE_TIERS.length + (t === 'drug_level' ? 0 : 1) : i
}
/** Which of two listings of one batch to keep: the better tier, then the higher severity, then the first listed. */
const better = (a: AlertRecord, b: AlertRecord) => tierRank(b.tier) < tierRank(a.tier) || (tierRank(b.tier) === tierRank(a.tier) && b.severity > a.severity)

/**
 * `skipped`, when given, counts rows dropped here by reason (duplicate row id, empty batch key,
 * repeat listing). A notice that lists the same batch twice ("DIABETIES-ALL POWDER" and
 * "Diabeties -ALL", both A-1 from one maker) yields one alert; `merged` names the rids folded
 * away and the rid they were folded into, so the ledger can hide a copy it already holds.
 */
export function resolveRows(
  doc: RawDoc,
  rows: ExtractedRow[],
  skipped?: Record<string, number>,
): { notice: NoticeRecord; alerts: AlertRecord[]; curator: AlertRecord[]; merged: { rid: string; into: string }[] } {
  const skip = (reason: string) => skipped && (skipped[reason] = (skipped[reason] ?? 0) + 1)
  const month = noticeMonthOf(doc)
  const kept = new Map<string, AlertRecord>()
  const merged: { rid: string; into: string }[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.rid)) {
      skip('duplicate row id')
      continue
    }
    seen.add(row.rid)
    const rec = resolveRow(doc, row, month)
    if (!rec.batchKey) {
      skip('empty batch key')
      continue
    }
    const key = duplicateKey(rec, row)
    const prev = kept.get(key)
    if (!prev) {
      kept.set(key, rec)
      continue
    }
    skip('repeat listing of the same batch')
    const [keep, drop] = better(prev, rec) ? [rec, prev] : [prev, rec]
    kept.set(key, keep)
    for (const m of merged) if (m.into === drop.rid) m.into = keep.rid
    merged.push({ rid: drop.rid, into: keep.rid })
  }
  const alerts: AlertRecord[] = []
  const curator: AlertRecord[] = []
  for (const rec of kept.values()) (isPublishableTier(rec.tier) ? alerts : curator).push(rec)
  return { notice: noticeFor(doc, rows), alerts, curator, merged }
}
