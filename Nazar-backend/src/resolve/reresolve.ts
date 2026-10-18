import { confusionKey } from '../domain/batch.ts'
import type { AlertRecord } from '../domain/types.ts'
import { classifyProduct } from '../domain/vocab.ts'
import { errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import type { Ledger } from '../storage/ledger.ts'
import { resolveRows } from './index.ts'

const log = child('reresolve')

/**
 * Bump when a change to resolve should reach alerts already in the ledger. Each bump re-resolves
 * every stored document once, from the extracted rows the ledger keeps (no refetch, no OCR, no LLM).
 *   resolve-2026.10.18: dateKnown (undated Maharashtra rows), productClass, manufacturer label words
 *   stripped ("Sresan Pharmaceutical manufacturer"), repeat listings of one batch on one notice merged.
 */
export const RESOLVE_VERSION = 'resolve-2026.10.18'
const KV_KEY = 'migration:resolve'

export interface ReresolveReport {
  version: string
  dryRun: boolean
  documents: number
  /** Alert writes from stored rows (a row listed on several versions of one page counts once per version). */
  alerts: number
  /** Rows that resolve to an alert the ledger never held (left alone; a pipeline run adds them). */
  notInLedger: number
  manufacturerChanged: number
  caseChanged: number
  /** Repeat listings hidden (dropped to the curator tier) in favour of the kept alert. */
  superseded: number
  /** Alerts with no stored rows to re-resolve from that got a productClass from their own fields. */
  classBackfilled: number
  /** Publishable alerts with no regulator date, after the run. */
  undated: number
  /** Publishable alerts per product class, after the run. */
  byClass: Record<string, number>
}

class DryRun extends Error {}

/**
 * Re-runs resolve over every stored document, oldest fetch first (so a page refreshed in place ends
 * on its newest version, as in a pipeline run), and rewrites the alerts the ledger already holds.
 * Idempotent: the same rows give the same records. What it never touches: the first-seen month
 * (upsertAlerts keeps alert_ym), entity keys, tx hashes, retractions, and anything on Arkiv. Alerts
 * already on chain keep their published payload there; the API and snapshot serve the ledger's copy.
 */
export function reresolveLedger(ledger: Ledger, o: { dryRun?: boolean } = {}): ReresolveReport {
  const report: ReresolveReport = {
    version: RESOLVE_VERSION, dryRun: !!o.dryRun, documents: 0, alerts: 0, notInLedger: 0,
    manufacturerChanged: 0, caseChanged: 0, superseded: 0, classBackfilled: 0, undated: 0, byClass: {},
  }
  const docs = ledger.db
    .prepare('SELECT d.sha FROM documents d WHERE EXISTS (SELECT 1 FROM rows r WHERE r.source_sha = d.sha) ORDER BY d.fetched_at, d.sha')
    .all() as { sha: string }[]
  const prevOf = ledger.db.prepare('SELECT data FROM alerts WHERE rid = ?')
  const work = () => {
    for (const { sha } of docs) {
      const raw = ledger.getDocument(sha)
      const rows = ledger.rowsFor(sha)
      if (!raw || !rows.length) continue
      report.documents++
      const { alerts, curator, merged } = resolveRows(raw, rows)
      const keep: AlertRecord[] = []
      for (const a of [...alerts, ...curator]) {
        const prev = prevOf.get(a.rid) as { data: string } | undefined
        if (!prev) {
          report.notInLedger++
          continue
        }
        const p = JSON.parse(prev.data) as AlertRecord
        if (p.manufacturer !== a.manufacturer) report.manufacturerChanged++
        if (p.caseId !== a.caseId) report.caseChanged++
        keep.push(a)
      }
      ledger.upsertAlerts(keep, confusionKey)
      report.alerts += keep.length
      for (const m of merged) if (ledger.markSuperseded(m.rid, m.into)) report.superseded++
    }
    // Alerts whose document has no stored rows (none expected, but a restored ledger might): classify in place.
    const unclassified = ledger.db.prepare("SELECT rid, data FROM alerts WHERE json_extract(data, '$.productClass') IS NULL").all() as { rid: string; data: string }[]
    const setClass = ledger.db.prepare("UPDATE alerts SET product_class = ?, data = json_set(data, '$.productClass', ?) WHERE rid = ?")
    for (const u of unclassified) {
      const a = JSON.parse(u.data) as AlertRecord
      const c = classifyProduct(a.product, a.manufacturer)
      setClass.run(c, c, u.rid)
      report.classBackfilled++
    }
    const totals = ledger.db
      .prepare("SELECT product_class c, COUNT(*) n, SUM(date_known = 0) u FROM alerts WHERE tier IN ('auto','machine_read') GROUP BY product_class")
      .all() as { c: string; n: number; u: number }[]
    for (const t of totals) {
      report.byClass[t.c] = t.n
      report.undated += t.u
    }
    if (o.dryRun) throw new DryRun()
    ledger.setKv(KV_KEY, RESOLVE_VERSION)
  }
  try {
    ledger.tx(work)
  } catch (err) {
    if (!(err instanceof DryRun)) throw err
  }
  return report
}

/**
 * Startup hook (Ledger's shared opener): re-resolves once per RESOLVE_VERSION. Never blocks startup;
 * a failure (e.g. another process holding the write lock) is logged and retried on the next start.
 */
export function migrateResolved(ledger: Ledger): ReresolveReport | null {
  try {
    if (ledger.getKv(KV_KEY) === RESOLVE_VERSION) return null
    const t0 = performance.now()
    const report = reresolveLedger(ledger)
    log.info({ ...report, ms: Math.round(performance.now() - t0) }, 'ledger re-resolved to the current rules')
    return report
  } catch (err) {
    log.error({ err: errorMessage(err) }, 'ledger re-resolve failed; will retry on the next start')
    return null
  }
}
