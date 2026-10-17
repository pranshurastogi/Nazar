import { cleanBatch, matchKey } from '../domain/batch.ts'
import { findYmInText, parseYm, ymOf } from '../domain/dates.ts'
import { scoreSeverity } from '../domain/severity.ts'
import type { AlertRecord, ExtractedRow, NoticeRecord, RawDoc } from '../domain/types.ts'
import { classifyCategory, classifyFailures, detectForm, isPaediatric, type Category } from '../domain/vocab.ts'
import { batchUncertain, caseIdFor, isPublishableTier, tierFor } from './case.ts'
import { slugify, splitDrug } from './drug.ts'
import { parseManufacturer } from './manufacturer.ts'

export { caseIdFor, isPublishableTier, tierFor } from './case.ts'
export { splitDrug } from './drug.ts'
export { parseManufacturer, stateFromPin } from './manufacturer.ts'

/**
 * Resolve: extracted rows → typed alert records + the notice they came from.
 * Pure and deterministic, so re-running it on the same rows yields the same records
 * (and the same rids and case ids), which is what makes publishing idempotent.
 */

/** Which month the notice covers: listing hint, then title, then the publish date, then fetch date. */
export function noticeYmOf(doc: RawDoc): number {
  return (
    doc.noticeYm ??
    findYmInText(doc.title) ??
    (doc.publishedAt ? parseYm(doc.publishedAt.slice(0, 7)) ?? ymOf(new Date(doc.publishedAt)) : null) ??
    ymOf(new Date(doc.fetchedAt))
  )
}

const isSpuriousDoc = (doc: RawDoc) =>
  doc.hints.category === 'spurious' || doc.hints.tab === 'spurious' || /spurious/i.test(doc.title)

export function resolveRow(doc: RawDoc, row: ExtractedRow, alertYm = noticeYmOf(doc)): AlertRecord {
  const batch = cleanBatch(row.batch) ?? row.batch.trim().toUpperCase()
  const batchKey = matchKey(batch)
  const spuriousDoc = isSpuriousDoc(doc)
  const reason = (row.reason ?? '').replace(/\s+/g, ' ').trim() || (spuriousDoc ? 'Spurious drug' : 'Not of standard quality')
  const failures0 = classifyFailures(reason)
  const failures = spuriousDoc && !failures0.includes('spurious') ? (['spurious', ...failures0.filter((f) => f !== 'other')] as typeof failures0) : failures0
  const category: Category = spuriousDoc ? 'spurious' : classifyCategory(reason, failures)
  const drug = splitDrug(row.product, row.rawText)
  const form = detectForm(row.product)
  // Reviewed seeds can state paediatric use explicitly when the cited source says so.
  const peds = isPaediatric(row.product) || (doc.hints.pedsBatches ?? '').split(',').includes(batchKey)
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
    alertYm,
    sourceId: doc.sourceId,
    authority: doc.authority,
    jurisdiction: doc.jurisdiction,
    noticeSha: doc.sha256,
    noticeTitle: doc.title,
    noticeUrl: doc.url,
    noticeDate: doc.publishedAt,
    method: row.method,
    confidence: row.confidence,
    tier: tierFor(row.confidence, batchUncertain(batch, row.issues)),
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

export function resolveRows(doc: RawDoc, rows: ExtractedRow[]): { notice: NoticeRecord; alerts: AlertRecord[]; curator: AlertRecord[] } {
  const alertYm = noticeYmOf(doc)
  const alerts: AlertRecord[] = []
  const curator: AlertRecord[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.rid)) continue
    seen.add(row.rid)
    const rec = resolveRow(doc, row, alertYm)
    if (!rec.batchKey) continue
    ;(isPublishableTier(rec.tier) ? alerts : curator).push(rec)
  }
  return { notice: noticeFor(doc, rows), alerts, curator }
}
