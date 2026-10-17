import { env } from '../config/env.ts'
import { matchKey, splitBatches } from '../domain/batch.ts'
import { ymOf } from '../domain/dates.ts'
import type { ExtractedRow, RawDoc } from '../domain/types.ts'
import { stableId } from '../lib/hash.ts'
import { decodeText } from '../lib/http.ts'
import { clean, docBase, loadHtml, type ManagedSource } from './common.ts'

export const MH_URL = 'https://fda.maharashtra.gov.in/nsq-alerts/'
export const MH_PARSER = 'mh-html@1'

export interface MhTableRow {
  srNo: string
  product: string
  manufacturer: string
  batch: string
  mfg: string
  exp: string
  reason: string
}

/** Every data row of the single NSQ table, header skipped. */
export function parseMhTable(html: string): MhTableRow[] {
  const $ = loadHtml(html)
  const out: MhTableRow[] = []
  $('table tr').each((_, tr) => {
    const c = $(tr)
      .find('td,th')
      .toArray()
      .map((td) => clean($(td).text()))
    if (c.length < 7 || /^sr\.?\s*no/i.test(c[0]!)) return
    out.push({ srNo: c[0]!, product: c[1]!, manufacturer: c[2]!, batch: c[3]!, mfg: c[4]!, exp: c[5]!, reason: c[6]! })
  })
  return out
}

type Reading = 'mdy' | 'dmy' | 'yy'
interface Candidate {
  ym: number
  reading: Reading
  /** The site records month-years, so a genuine day field is always "01". */
  plausible: boolean
}

function candidates(raw: string): Candidate[] {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(clean(raw))
  if (!m) return []
  const a = Number(m[1])
  const b = Number(m[2])
  const y = Number(m[3])
  const out: Candidate[] = []
  if (a >= 1 && a <= 12) out.push({ ym: y * 100 + a, reading: 'mdy', plausible: b === 1 })
  if (b >= 1 && b <= 12) {
    out.push({ ym: y * 100 + b, reading: 'dmy', plausible: a === 1 })
    // A spreadsheet turned "Mar-25" into 25-03-<year of import>: the "day" is really the year.
    if (a >= 15 && a <= 40) out.push({ ym: (2000 + a) * 100 + b, reading: 'yy', plausible: true })
  }
  return out
}

const monthsBetween = (from: number, to: number) => (Math.floor(to / 100) - Math.floor(from / 100)) * 12 + (to % 100) - (from % 100)

/**
 * The table mixes MM-DD-YYYY, DD-MM-YYYY and spreadsheet-mangled dates. Pick the reading of the
 * pair (both dates read the same way) where manufacture precedes expiry by at most 6 years and is
 * not in the future; ties go to readings whose day field is the "01" the site always uses.
 */
export function readMhDates(mfgRaw: string, expRaw: string, nowYm: number): { mfgYm: number | null; expYm: number | null; ambiguous: boolean } {
  const ms = candidates(mfgRaw)
  const es = candidates(expRaw)
  if (!ms.length && !es.length) return { mfgYm: null, expYm: null, ambiguous: false }
  if (!ms.length || !es.length) {
    const only = [...(ms.length ? ms : es)].sort((x, y) => Number(y.plausible) - Number(x.plausible))[0]!
    return ms.length ? { mfgYm: only.ym, expYm: null, ambiguous: true } : { mfgYm: null, expYm: only.ym, ambiguous: true }
  }
  let best: { score: number; mfg: Candidate; exp: Candidate; valid: boolean } | undefined
  for (const mfg of ms) {
    for (const exp of es) {
      const span = monthsBetween(mfg.ym, exp.ym)
      // One row was typed (or mangled) one way, so both dates must share a reading to count as valid.
      const valid = mfg.reading === exp.reading && span > 0 && span <= 72 && mfg.ym <= nowYm
      const score = (valid ? 10 : 0) + Number(mfg.plausible) + Number(exp.plausible)
      if (!best || score > best.score) best = { score, mfg, exp, valid }
    }
  }
  return { mfgYm: best!.mfg.ym, expYm: best!.exp.ym, ambiguous: !best!.valid }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Sr. No. shifts whenever new rows are added at the top, so a row is identified by what it says:
 * hash(product, batch, manufacturer). That key also makes the row id stable across page versions.
 */
export function mhRows(html: string, doc: Pick<RawDoc, 'sha256' | 'fetchedAt'>): ExtractedRow[] {
  const nowYm = ymOf(new Date(doc.fetchedAt || Date.now()))
  const rows: ExtractedRow[] = []
  const seen = new Map<string, number>()
  for (const r of parseMhTable(html)) {
    const batches = splitBatches(r.batch.replace(/^[#*]+/, ''))
    if (!r.product || !batches.length) continue
    const { mfgYm, expYm, ambiguous } = readMhDates(r.mfg, r.exp, nowYm)
    const issues: string[] = []
    if (ambiguous) issues.push(`dates ambiguous: mfg "${r.mfg}", exp "${r.exp}"`)
    if (mfgYm === null || expYm === null) issues.push('manufacturing or expiry date missing')
    if (batches.length > 1) issues.push(`cell listed ${batches.length} batches`)
    const manufacturer = r.manufacturer && !/^not\s+mention/i.test(r.manufacturer) ? r.manufacturer : null
    for (const batch of batches) {
      const base = stableId(norm(r.product), matchKey(batch), norm(r.manufacturer))
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      const key = n === 1 ? base : `${base}-${n}`
      rows.push({
        rid: stableId(MH_PARSER, key),
        sourceSha: doc.sha256,
        rowNo: rows.length + 1,
        page: null,
        product: r.product,
        batch,
        mfgYm,
        expYm,
        manufacturer,
        reason: r.reason || null,
        reportedBy: 'FDA Maharashtra',
        method: 'html',
        parser: MH_PARSER,
        confidence: issues.length ? 0.8 : 0.92,
        issues,
        rawText: `key:${key} | ${r.srNo} | ${r.product} | ${r.manufacturer} | ${r.batch} | ${r.mfg} | ${r.exp} | ${r.reason}`,
      })
    }
  }
  return rows
}

export const mhFda: ManagedSource = {
  id: 'mh-fda',
  authority: 'Food and Drug Administration, Maharashtra',
  jurisdiction: 'IN-MH',
  description: 'Maharashtra FDA NSQ alerts page: a running table of drugs and cosmetics found Not of Standard Quality in the state.',
  homepage: MH_URL,
  schedule: env().NAZAR_CRON_STATES,

  async discover() {
    const now = new Date()
    return [
      {
        ...docBase(mhFda),
        url: MH_URL,
        title: `Maharashtra FDA NSQ alerts (as of ${now.toISOString().slice(0, 10)})`,
        publishedAt: null,
        // The page has no per-row dates; the month we saw a row is the best alert month we have.
        noticeYm: ymOf(now),
        kind: 'html',
        hints: { format: 'mh-html', refresh: 'always' },
      },
    ]
  },

  async rows(doc, bytes) {
    return mhRows(decodeText(bytes, doc.contentType), doc)
  },
}
