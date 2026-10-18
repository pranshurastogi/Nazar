import { ApiError, apiCheck, apiLikelyDown } from '@/lib/source/api'
import { isMedicine } from '@/lib/source/map'
import { matchKey, validateBatch } from '@/lib/source/match'
import { currentSnapshot, loadSnapshot, snapshotCheck, type SnapshotIndex } from '@/lib/source/snapshot'
import type { Alert, CheckResult, ResultState } from '@/lib/source/types'

// Shelf sweep: many batches checked at once, for chemists, pharmacies and NGOs. The list is parsed
// and matched on the device against Nazar's snapshot of every published alert; only the flagged
// and look-alike batches are then confirmed one by one against the live API, exactly as a single
// check would send them. Nothing about the list itself (names, quantities, the file) leaves the
// device, and every download is generated in the browser.

/** Most rows a sweep checks at once. */
export const SWEEP_MAX = 500
/** Gentle on the API: at most this many /v1/check requests in flight. */
export const SWEEP_CONCURRENCY = 3
/** Larger files are refused before reading: a 500-row stock sheet is a few tens of kilobytes. */
export const SWEEP_MAX_FILE_BYTES = 2 * 1024 * 1024

// ---- Parsing

export type SweepRow = {
  /** Validated, upper-cased batch (pack label such as "B.No." removed). */
  batch: string
  key: string
  /** The line (or cell) as written, first occurrence. */
  raw: string
  /** 1-based line in the pasted text or file. */
  line: number
  /** How many lines named this batch (duplicates merged into one row). */
  lines: number
  /** Context columns from a CSV/TSV, kept on the device and in the export only. */
  product?: string
  qty?: string
  expiry?: string
}

export type Unreadable = { raw: string; line: number; product?: string; qty?: string; expiry?: string }

export type SweepColumns = { batch: string; product?: string; qty?: string; expiry?: string }

export type ParsedList = {
  rows: SweepRow[]
  unreadable: Unreadable[]
  /** Extra lines merged into an earlier row with the same batch. */
  duplicates: number
  /** Readable batches beyond SWEEP_MAX that will not be checked. */
  overLimit: number
  /** Set when a header row named the columns (CSV, TSV or a pasted sheet with headers). */
  columns: SweepColumns | null
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

const BATCH_HEADERS = ['batch', 'batchno', 'batchnumber', 'batchnum', 'bno', 'bnumber', 'lot', 'lotno', 'lotnumber', 'batchlot', 'batchlotno', 'batchorlot']
const PRODUCT_HEADERS = ['product', 'productname', 'name', 'medicine', 'medicinename', 'item', 'itemname', 'drug', 'drugname', 'brand', 'brandname', 'description', 'particulars']
const QTY_HEADERS = ['qty', 'quantity', 'stock', 'units', 'count', 'pcs', 'nos', 'strips', 'packs']
const EXPIRY_HEADERS = ['expiry', 'exp', 'expirydate', 'expdate', 'expdt', 'expiresat', 'expires', 'bestbefore', 'useby', 'expirymonth']

function findColumn(headers: string[], names: string[], fuzzy?: (h: string) => boolean): number {
  const n = headers.map(norm)
  for (const name of names) {
    const i = n.indexOf(name)
    if (i >= 0) return i
  }
  return fuzzy ? n.findIndex(fuzzy) : -1
}

/** Index of the batch column in a header row, or -1 when the row is not a header. */
export function batchColumn(headers: string[]): number {
  return findColumn(headers, BATCH_HEADERS, (h) => /^[a-z]+$/.test(h) && (h.startsWith('batch') || h.startsWith('lotno')))
}

/** A line that is only a header word ("Batch", "B.No.", "Lot No") in a single-column paste. */
const isHeaderWord = (cell: string) => BATCH_HEADERS.includes(norm(cell))

/** Splits one delimited line, honouring double quotes ("a, b" stays one cell; "" is a quote). */
export function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cell += '"'), i++
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true
      cell = ''
    } else if (ch === delim) {
      out.push(cell.trim())
      cell = ''
    } else cell += ch
  }
  out.push(cell.trim())
  return out
}

/** Splits text into lines, keeping newlines inside quoted CSV cells. */
function splitLines(text: string): string[] {
  const lines: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of text.replace(/^\uFEFF/, '')) {
    if (ch === '"') quoted = !quoted
    if ((ch === '\n' || ch === '\r') && !quoted) {
      lines.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  lines.push(cur)
  // "\r\n" leaves an empty entry between; real blank lines are dropped later anyway.
  return lines
}

function detectDelimiter(header: string): string | null {
  const counts = (['\t', ',', ';', '|'] as const).map((d) => [d, splitDelimited(header, d).length] as const)
  const best = counts.sort((a, b) => b[1] - a[1])[0]!
  return best[1] > 1 ? best[0] : null
}

type Cell = { raw: string; line: number; product?: string; qty?: string; expiry?: string }

/**
 * Reads a pasted list or an uploaded CSV/TSV into rows. A header row naming a batch column
 * ("Batch", "B.No.", "Batch No", "Lot") makes it a table, and the product, quantity and expiry
 * columns are kept as context. Otherwise every line is split on commas, semicolons and tabs, so a
 * column copied from Excel or Sheets, or "SR-13, AB1234", both work. Each value goes through the
 * same validator as a single check (validateBatch), duplicates are merged by matchKey, and at most
 * SWEEP_MAX rows are kept.
 */
export function parseList(text: string): ParsedList {
  const lines = splitLines(text)
  const firstIdx = lines.findIndex((l) => l.trim() !== '')
  const cells: Cell[] = []
  let columns: SweepColumns | null = null

  if (firstIdx >= 0) {
    const header = lines[firstIdx]!
    const delim = detectDelimiter(header)
    const headers = delim ? splitDelimited(header, delim) : [header.trim()]
    const bi = delim ? batchColumn(headers) : -1
    if (delim && bi >= 0) {
      const pi = findColumn(headers, PRODUCT_HEADERS, (h) => h.includes('product') || h.includes('medicine'))
      const qi = findColumn(headers, QTY_HEADERS, (h) => h.startsWith('qty') || h.startsWith('quantity'))
      const ei = findColumn(headers, EXPIRY_HEADERS, (h) => h.startsWith('exp'))
      columns = {
        batch: headers[bi]!,
        ...(pi >= 0 && pi !== bi ? { product: headers[pi]! } : {}),
        ...(qi >= 0 && qi !== bi ? { qty: headers[qi]! } : {}),
        ...(ei >= 0 && ei !== bi ? { expiry: headers[ei]! } : {}),
      }
      for (let i = firstIdx + 1; i < lines.length; i++) {
        const line = lines[i]!
        if (!line.trim()) continue
        const c = splitDelimited(line, delim)
        const raw = c[bi] ?? ''
        const ctx = {
          ...(pi >= 0 && pi !== bi && c[pi] ? { product: c[pi] } : {}),
          ...(qi >= 0 && qi !== bi && c[qi] ? { qty: c[qi] } : {}),
          ...(ei >= 0 && ei !== bi && c[ei] ? { expiry: c[ei] } : {}),
        }
        // A row with no batch is still a row of the sheet: count it as unreadable, unless it is empty.
        if (!raw && !Object.keys(ctx).length) continue
        cells.push({ raw, line: i + 1, ...ctx })
      }
    } else {
      lines.forEach((line, i) => {
        for (const part of line.split(/[,;\t]/)) {
          const raw = part.trim()
          if (!raw) continue
          if (i === firstIdx && isHeaderWord(raw)) continue
          cells.push({ raw, line: i + 1 })
        }
      })
    }
  }

  const rows: SweepRow[] = []
  const byKey = new Map<string, SweepRow>()
  const unreadable: Unreadable[] = []
  let duplicates = 0
  let overLimit = 0
  for (const c of cells) {
    const v = c.raw ? validateBatch(c.raw) : { ok: false as const, batch: '' }
    if (!v.ok) {
      unreadable.push(c)
      continue
    }
    const key = matchKey(v.batch)
    const seen = byKey.get(key)
    if (seen) {
      seen.lines++
      duplicates++
      seen.product ??= c.product
      seen.qty ??= c.qty
      seen.expiry ??= c.expiry
      continue
    }
    if (rows.length >= SWEEP_MAX) {
      overLimit++
      continue
    }
    const row: SweepRow = { batch: v.batch, key, raw: c.raw, line: c.line, lines: 1, ...ctx(c) }
    byKey.set(key, row)
    rows.push(row)
  }
  return { rows, unreadable, duplicates, overLimit, columns }
}

const ctx = (c: Cell) => ({
  ...(c.product ? { product: c.product } : {}),
  ...(c.qty ? { qty: c.qty } : {}),
  ...(c.expiry ? { expiry: c.expiry } : {}),
})

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

/** "143 batches · 3 unreadable · 5 duplicates merged". */
export function previewLine(p: ParsedList): string {
  const parts = [plural(p.rows.length, 'batch', 'batches')]
  if (p.unreadable.length) parts.push(`${p.unreadable.length.toLocaleString('en-IN')} unreadable`)
  if (p.duplicates) parts.push(`${plural(p.duplicates, 'duplicate')} merged`)
  return parts.join(' · ')
}

// ---- Checking

/** Why a row is "Can't tell": a look-alike of an alerted batch, an unreadable line, or one that could not be checked. */
export type CantTell = 'lookalike' | 'unreadable' | 'unchecked'

export type SweepItem = {
  id: string
  batch: string
  raw: string
  line: number
  lines: number
  product?: string
  qty?: string
  expiry?: string
  /** null until the first answer (instant from the snapshot, or from the API). */
  result: CheckResult | null
  /** Set while the live API is confirming an instant answer. */
  confirming: boolean
  /** The live API answered this row (the Arkiv entity key comes with it). */
  confirmed: boolean
  /** When this row was answered. */
  checkedAt: Date | null
}

export type SweepPhase = 'idle' | 'loading' | 'confirming' | 'checking' | 'done'

export type SweepProgress = {
  phase: SweepPhase
  /** Rows sent to the live API in this phase, and how many have answered. */
  total: number
  done: number
  /** How the rows were answered: the on-device snapshot, or (without one) the API row by row. */
  via: 'snapshot' | 'api' | null
  snapshotAt: Date | null
  /** Set while the API is rate limiting and the queue is waiting. */
  waitingMs: number
}

export const itemState = (i: SweepItem): ResultState | null => i.result?.state ?? null

export function cantTell(i: SweepItem): CantTell | null {
  const r = i.result
  if (!r || r.state !== 'unreadable') return null
  if (r.suggestion) return 'lookalike'
  if (!i.batch) return 'unreadable'
  return r.source === 'local' ? 'unchecked' : 'unreadable'
}

export const suggestionOf = (i: SweepItem) => (i.result?.state === 'unreadable' ? i.result.suggestion : undefined)

export const alertOf = (i: SweepItem): Alert | null => (i.result && (i.result.state === 'flagged' || i.result.state === 'retracted') ? i.result.alert : null)

/** Child Shield: a flagged children's medicine (not a kids' shampoo or hand rub). */
export const childShield = (a: Alert | null) => !!a && a.peds && isMedicine(a)

/** Items for a parsed list: readable rows first (in input order), unreadable lines after. */
export function itemsFor(p: ParsedList): SweepItem[] {
  const now = new Date()
  return [
    ...p.rows.map<SweepItem>((r) => ({ id: `b:${r.key}`, ...r, result: null, confirming: false, confirmed: false, checkedAt: null })),
    ...p.unreadable.map<SweepItem>((u, n) => ({
      id: `u:${n}`,
      batch: '',
      raw: u.raw,
      line: u.line,
      lines: 1,
      ...ctx(u),
      // Answered on the device: a garbled line never leaves it.
      result: { state: 'unreadable', batch: u.raw, asOf: now, source: 'local' },
      confirming: false,
      confirmed: false,
      checkedAt: now,
    })),
  ]
}

const RANK: Record<ResultState, number> = { flagged: 0, retracted: 1, unreadable: 2, no_alert: 3 }
const CANT_RANK: Record<CantTell, number> = { lookalike: 0, unchecked: 1, unreadable: 2 }

/** Flagged first (most severe first), then retracted, then Can't tell (look-alikes first), then no alert; input order within each. */
export function sortItems(items: SweepItem[]): SweepItem[] {
  const order = new Map(items.map((it, i) => [it.id, i]))
  return [...items].sort((a, b) => {
    const sa = itemState(a)
    const sb = itemState(b)
    const ra = sa ? RANK[sa] : 4
    const rb = sb ? RANK[sb] : 4
    if (ra !== rb) return ra - rb
    if (sa === 'flagged' || sa === 'retracted') {
      const d = (alertOf(b)?.severity ?? 0) - (alertOf(a)?.severity ?? 0)
      if (d) return d
    }
    if (sa === 'unreadable') {
      const d = CANT_RANK[cantTell(a) ?? 'unreadable'] - CANT_RANK[cantTell(b) ?? 'unreadable']
      if (d) return d
    }
    return order.get(a.id)! - order.get(b.id)!
  })
}

export type Counts = Record<ResultState, number> & { lookalike: number; total: number }

export function countItems(items: SweepItem[]): Counts {
  const c: Counts = { flagged: 0, retracted: 0, unreadable: 0, no_alert: 0, lookalike: 0, total: items.length }
  for (const i of items) {
    const s = itemState(i)
    if (s) c[s]++
    if (cantTell(i) === 'lookalike') c.lookalike++
  }
  return c
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true })
  })

/** Rate limited or briefly unavailable: worth waiting and asking again. */
const retryable = (err: unknown) => err instanceof ApiError && (err.status === 429 || err.status === 503)

/** The loaded snapshot, else one load attempt, bounded in time. */
async function snapshotFor(signal: AbortSignal, ms = 8000): Promise<SnapshotIndex | null> {
  const have = currentSnapshot()
  if (have) return have
  const s = await Promise.race([loadSnapshot(), new Promise<null>((r) => setTimeout(() => r(null), ms))])
  if (signal.aborted) throw signal.reason
  return s
}

/** Marks a snapshot answer as final (the live API did not confirm it), as a single check does. */
function asFinal(r: CheckResult): CheckResult {
  if (r.state !== 'flagged' && r.state !== 'retracted') return r
  return { ...r, alert: { ...r.alert, savedCopyFinal: true }, alerts: r.alerts.map((a) => ({ ...a, savedCopyFinal: true })) }
}

export type SweepHooks = {
  onItems: (items: SweepItem[]) => void
  onProgress: (p: SweepProgress) => void
}

/**
 * Runs a sweep. With the snapshot, every row is answered at once on the device; then only the
 * flagged, retracted and look-alike rows go to the live API (SWEEP_CONCURRENCY at a time) to be
 * confirmed. Without a snapshot every row goes to the API, and any that fail become "Can't tell".
 * A 429 or 503 pauses the whole queue with a growing back-off before the row is asked again.
 * `only` limits the run to some rows (Try again); the rest keep their answers.
 */
export async function runSweep(start: SweepItem[], hooks: SweepHooks, signal: AbortSignal, only?: Set<string>): Promise<void> {
  let items = start.map((i) => ({ ...i }))
  const index = new Map(items.map((it, n) => [it.id, n]))
  const emit = () => hooks.onItems(items.slice())
  const update = (id: string, patch: Partial<SweepItem>) => {
    const n = index.get(id)!
    items[n] = { ...items[n]!, ...patch }
  }
  const progress: SweepProgress = { phase: 'loading', total: 0, done: 0, via: null, snapshotAt: null, waitingMs: 0 }
  const report = () => hooks.onProgress({ ...progress })
  report()

  const todo = items.filter((i) => i.batch && (!only || only.has(i.id)))
  const snap = await snapshotFor(signal)
  let queue: SweepItem[]

  if (snap) {
    progress.via = 'snapshot'
    progress.snapshotAt = snap.generatedAt
    const now = new Date()
    for (const it of todo) {
      const r = snapshotCheck(it.batch, snap)
      if (r) update(it.id, { result: r, checkedAt: now, confirmed: false })
    }
    queue = todo.filter((it) => {
      const r = items[index.get(it.id)!]!.result
      return !!r && (r.state === 'flagged' || r.state === 'retracted' || (r.state === 'unreadable' && !!r.suggestion))
    })
    for (const it of queue) update(it.id, { confirming: true })
    progress.phase = queue.length ? 'confirming' : 'done'
  } else {
    progress.via = 'api'
    queue = todo
    for (const it of queue) update(it.id, { confirming: true, result: null })
    progress.phase = queue.length ? 'checking' : 'done'
  }
  progress.total = queue.length
  emit()
  report()
  if (!queue.length) return

  let backoff = 0
  let pausedUntil = 0
  const BACKOFF = [2000, 5000, 10000, 20000]
  let next = 0

  const finish = (it: SweepItem, r: CheckResult | null) => {
    const prev = items[index.get(it.id)!]!.result
    if (r) update(it.id, { result: r, confirming: false, confirmed: r.source === 'api', checkedAt: new Date() })
    // The API did not answer: keep the snapshot's answer (marked final), or say we can't tell.
    else if (prev) update(it.id, { result: asFinal(prev), confirming: false })
    else update(it.id, { result: { state: 'unreadable', batch: it.batch, asOf: new Date(), source: 'local' }, confirming: false, checkedAt: new Date() })
    progress.done++
    emit()
    report()
  }

  const worker = async () => {
    while (next < queue.length) {
      const it = queue[next++]!
      let result: CheckResult | null = null
      for (let attempt = 0; attempt < 4; attempt++) {
        const wait = pausedUntil - Date.now()
        if (wait > 0) await sleep(wait, signal)
        // A connection failure cools the API off for a while (see api.ts); the rest fail fast instead of piling up.
        if (apiLikelyDown()) break
        try {
          result = await apiCheck(it.batch, { signal, timeoutMs: 8000 })
          backoff = 0
          break
        } catch (err) {
          if (signal.aborted) throw signal.reason
          if (!retryable(err)) break
          const ms = BACKOFF[Math.min(backoff++, BACKOFF.length - 1)]!
          pausedUntil = Math.max(pausedUntil, Date.now() + ms)
          progress.waitingMs = ms
          report()
          await sleep(ms, signal)
          progress.waitingMs = 0
          report()
        }
      }
      finish(it, result)
    }
  }

  await Promise.all(Array.from({ length: Math.min(SWEEP_CONCURRENCY, queue.length) }, worker))
  progress.phase = 'done'
  report()
}

// ---- Export

/** "18 Oct 2026, 5:22 pm IST": Indian time whatever the device's zone. */
export const istText = (d: Date) =>
  `${d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST`

export const STATE_TEXT: Record<ResultState, string> = { flagged: 'Flagged', retracted: 'Retracted', unreadable: "Can't tell", no_alert: 'No alert found' }

/** One-line reason shown under "Can't tell". */
export function cantTellText(i: SweepItem): string {
  const k = cantTell(i)
  if (k === 'lookalike') return `Did you mean ${suggestionOf(i)}? Check the pack again.`
  if (k === 'unchecked') return "Couldn't reach the live record. Try again."
  return "Couldn't read this batch number."
}

/** Neutralises spreadsheet formulas in a cell that came from the list (CSV injection). */
const safeCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v)
const csvCell = (v: string | number | null | undefined) => {
  const s = safeCell(v == null ? '' : String(v))
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const CSV_COLUMNS = [
  'batch', 'as_written', 'line', 'lines_merged', 'your_product', 'qty', 'expiry',
  'state', 'note', 'did_you_mean', 'product', 'manufacturer', 'regulator', 'notice_title', 'notice_date', 'notice_url',
  'severity', 'child_shield', 'arkiv_entity_url', 'answered_by', 'alert_data_as_of', 'view_url', 'checked_at', 'checked_at_ist',
] as const

/** The sweep as CSV (UTF-8 with a BOM so Excel reads it), sorted flagged first. */
export function toCsv(items: SweepItem[], origin: string): string {
  const head = CSV_COLUMNS.join(',')
  const body = sortItems(items).map((i) => {
    const s = itemState(i)
    const a = alertOf(i)
    const note = s === 'unreadable' ? cantTellText(i) : s === 'no_alert' ? 'No official alert found. Not a safety certificate.' : a?.failure ?? ''
    const answered = i.result ? (i.result.source === 'api' ? 'Nazar API (live)' : i.result.source === 'snapshot' ? "Nazar snapshot (on device)" : 'On this device') : ''
    const row: (string | number | null | undefined)[] = [
      i.batch || '', i.raw, i.line, i.lines, i.product, i.qty, i.expiry,
      s ? STATE_TEXT[s] : 'Not checked', note, suggestionOf(i), a?.brand, a?.manufacturer, a?.authority, a?.notice, a?.noticeDate, a?.noticeUrl,
      a?.severity, a ? (childShield(a) ? 'yes' : 'no') : '', a?.explorer.entity ?? '', answered,
      i.result && i.result.source !== 'local' ? i.result.asOf.toISOString() : '', i.batch ? `${origin}/b/${encodeURIComponent(i.batch)}` : '',
      i.checkedAt?.toISOString(), i.checkedAt ? istText(i.checkedAt) : '',
    ]
    return row.map(csvCell).join(',')
  })
  return `\uFEFF${[head, ...body].join('\r\n')}\r\n`
}

/** The flagged rows as plain text, ready to paste into a message or a supplier email. */
export function flaggedText(items: SweepItem[], origin: string, at = new Date()): string {
  const flagged = sortItems(items).filter((i) => itemState(i) === 'flagged')
  if (!flagged.length) return ''
  const lines = flagged.map((i) => {
    const a = alertOf(i)!
    const bits = [i.batch, a.brand, a.authority, a.noticeDate, `severity ${a.severity}/5`]
    if (childShield(a)) bits.push("children's medicine")
    if (i.product) bits.push(`your list: ${i.product}`)
    return `• ${bits.filter(Boolean).join(' · ')}\n  ${origin}/b/${encodeURIComponent(i.batch)}`
  })
  return [`Flagged batches (${flagged.length}) · Nazar shelf sweep, ${istText(at)}`, '', ...lines, '', 'Each batch is named in a regulator alert (CDSCO, a state drug regulator or WHO). Open the link for the notice and proof.'].join('\n')
}

/** Starts a download of text made in the browser; nothing is uploaded. */
export function downloadText(text: string, filename: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** "nazar-shelf-sweep-2026-10-18.csv", dated in India. */
export const csvFilename = (at = new Date()) => `nazar-shelf-sweep-${new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10)}.csv`

export const SAMPLE = ['SR-13', 'TG25-2281A', '5R-13', 'AB1234', 'R01GL2523', 'B.No. SR-13', '??', 'smudged #'].join('\n')
