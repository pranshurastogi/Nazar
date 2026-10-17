import { env } from '../config/env.ts'
import { matchKey, splitBatches } from '../domain/batch.ts'
import { parseYm } from '../domain/dates.ts'
import type { DiscoveredDoc, ExtractedRow, RawDoc } from '../domain/types.ts'
import { ExtractionError } from '../lib/errors.ts'
import { stableId } from '../lib/hash.ts'
import { decodeText } from '../lib/http.ts'
import { child } from '../lib/logger.ts'
import { CDSCO_ONLINE_BASE, MONTH_ABBR, clean, docBase, fetchJson, monthIndex, type ManagedSource } from './common.ts'
import type { SourceContext } from './types.ts'

const log = child('source:cdsco-online')

export const CDSCO_JSON_PARSER = 'cdsco-json@1'
export type CdscoTab = 'nsq' | 'spurious'
const TABS: CdscoTab[] = ['nsq', 'spurious']

export interface CdscoRow {
  str_product_name?: string
  product_name_from_dtl?: string
  str_batch_no?: string
  dt_manufacturing_date?: string
  dt_expiry_date?: string
  str_manufactured_by?: string
  str_nsq_result?: string
  str_reporting_source?: string
  str_reported_by_lab_or_state?: string
  dt_reporting_month_year?: string
  str_nsq_remarks?: string
  str_firm_reply?: string
  str_spurious_manufactured_by?: string
  str_spurious_manufacturer_name?: string
}

export interface CdscoTable {
  iTotalRecords?: number
  aaData: CdscoRow[]
}

export const tableUrl = (tab: CdscoTab, month: string) =>
  tab === 'nsq'
    ? `${CDSCO_ONLINE_BASE}/filteredNsqDrugTable?month=${month}&source=All&tab=nsq`
    : `${CDSCO_ONLINE_BASE}/filteredSpuriousDrugTable?month=${month}&source=All&tab=spurious`

/** "Aug-2026" → 202608. */
const ymOfMonth = (month: string) => {
  const [mon, year] = month.split('-')
  const m = monthIndex(mon ?? '')
  return m && year ? Number(year) * 100 + m : null
}

/** Placeholders the portal uses when the maker is unknown (common for spurious samples). */
const UNKNOWN_MAKER = /^(under\s+investigation|not\s+(known|mentioned|available)|n\.?\s*a\.?|-+)$/i

const orNull = (s: string | undefined) => {
  const c = clean(s)
  return c && !UNKNOWN_MAKER.test(c) ? c : null
}

/**
 * Turns one stored month × tab table into rows. One row per batch, because a cell can list several.
 *
 * Row ids are derived from the row's content (tab, month, batch, product, occurrence), not from the
 * document hash: the newest month is re-fetched while it fills up, and a growing table must not
 * re-mint ids for rows that were already published.
 */
export function cdscoRows(table: CdscoTable, doc: Pick<RawDoc, 'sha256' | 'hints'>): ExtractedRow[] {
  if (!Array.isArray(table.aaData)) throw new ExtractionError('cdscoonline table has no aaData array', { sha: doc.sha256 })
  const tab: CdscoTab = doc.hints.tab === 'spurious' ? 'spurious' : 'nsq'
  const month = doc.hints.month ?? ''
  const rows: ExtractedRow[] = []
  const occurrences = new Map<string, number>()
  for (const item of table.aaData) {
    const product = clean(item.str_product_name ?? item.product_name_from_dtl)
    const batches = splitBatches(item.str_batch_no ?? '')
    if (!product || !batches.length) {
      log.debug({ product, batch: item.str_batch_no }, 'skipping row without a usable product or batch')
      continue
    }
    const reason =
      tab === 'spurious'
        ? [item.str_nsq_result, item.str_nsq_remarks, item.str_firm_reply].map(clean).filter(Boolean).join(' | ')
        : clean(item.str_nsq_result)
    const mfgYm = parseYm(item.dt_manufacturing_date)
    const expYm = parseYm(item.dt_expiry_date)
    const issues: string[] = []
    if (mfgYm === null) issues.push('manufacturing date missing or unreadable')
    if (expYm === null) issues.push('expiry date missing or unreadable')
    if (batches.length > 1) issues.push(`cell listed ${batches.length} batches`)
    for (const batch of batches) {
      const key = [tab, month, matchKey(batch), product.toLowerCase()].join('|')
      const n = (occurrences.get(key) ?? 0) + 1
      occurrences.set(key, n)
      rows.push({
        rid: stableId(CDSCO_JSON_PARSER, key, n),
        sourceSha: doc.sha256,
        rowNo: rows.length + 1,
        page: null,
        product,
        batch,
        mfgYm,
        expYm,
        manufacturer: orNull(item.str_manufactured_by),
        reason: reason || null,
        reportedBy: orNull(item.str_reported_by_lab_or_state) ?? orNull(item.str_reporting_source),
        method: 'api',
        parser: CDSCO_JSON_PARSER,
        confidence: issues.length ? 0.9 : 0.97,
        issues,
        rawText: JSON.stringify(item),
      })
    }
  }
  return rows
}

async function months(ctx: SourceContext, tab: CdscoTab): Promise<string[]> {
  const years = (await fetchJson<string[]>(ctx.http, `${CDSCO_ONLINE_BASE}/reportingYears?tab=${tab}`))
    .map(Number)
    .filter((y) => Number.isInteger(y) && y > 2000)
    .sort((a, b) => b - a)
  const out: string[] = []
  for (const y of years) {
    if (ctx.signal?.aborted || out.length >= ctx.limit) break
    if (ctx.sinceYm && y * 100 + 12 < ctx.sinceYm) break
    const ms = await fetchJson<string[]>(ctx.http, `${CDSCO_ONLINE_BASE}/publicReportingMonths?year=${y}&tab=${tab}`)
    const sorted = ms.filter((m) => monthIndex(m)).sort((a, b) => monthIndex(b)! - monthIndex(a)!)
    out.push(...sorted.map((m) => `${MONTH_ABBR[monthIndex(m)! - 1]}-${y}`))
  }
  return out
}

export const cdscoOnline: ManagedSource = {
  id: 'cdsco-online',
  authority: 'CDSCO',
  jurisdiction: 'IN',
  description:
    "CDSCO's public NSQ and spurious drug portal (cdscoonline.gov.in): structured monthly tables from CDSCO and state laboratories since 2019.",
  homepage: `${CDSCO_ONLINE_BASE}/viewPublicNSQDrug`,
  schedule: env().NAZAR_CRON_CDSCO,

  async discover(ctx) {
    const docs: DiscoveredDoc[] = []
    for (const tab of TABS) {
      const list = await months(ctx, tab)
      list.forEach((month, i) => {
        const noticeYm = ymOfMonth(month)
        docs.push({
          ...docBase(cdscoOnline),
          url: tableUrl(tab, month),
          title: `CDSCO ${tab === 'nsq' ? 'Not of Standard Quality' : 'spurious'} drugs reported in ${month.replace('-', ' ')}`,
          publishedAt: null,
          noticeYm,
          kind: 'html',
          // The newest month keeps growing as labs report, so it is re-fetched every run.
          hints: { format: 'cdsco-json', tab, month, ...(i === 0 ? { refresh: 'always' } : {}) },
        })
      })
    }
    return docs
      .filter((d) => !ctx.sinceYm || (d.noticeYm ?? 0) >= ctx.sinceYm)
      .sort((a, b) => (b.noticeYm ?? 0) - (a.noticeYm ?? 0) || a.hints.tab!.localeCompare(b.hints.tab!))
      .slice(0, ctx.limit)
  },

  async rows(doc, bytes) {
    let table: CdscoTable
    try {
      table = JSON.parse(decodeText(bytes, doc.contentType)) as CdscoTable
    } catch (err) {
      throw new ExtractionError('stored cdscoonline document is not JSON', { sha: doc.sha256 }, { cause: err })
    }
    return cdscoRows(table, doc)
  },
}
