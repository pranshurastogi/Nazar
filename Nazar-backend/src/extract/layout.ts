import type { PdfPage, Segment, TextItem } from './pdf.ts'

/**
 * Turns positioned text into table rows. Regulator PDFs are Word/Excel exports, so
 * the drawn borders are the most reliable structure: when a page has ruling lines,
 * columns come from the vertical rules and rows from the horizontal ones. Pages
 * without borders fall back to header-label columns and S.No-anchored rows.
 */

export interface Line {
  y: number
  items: TextItem[]
  text: string
}

export interface Column {
  left: number
  right: number
  /** Header text as printed, lines joined with spaces. */
  header: string
  /** Header lowercased with all whitespace removed: "Manufacturi ng Date" becomes "manufacturingdate". */
  key: string
}

export interface TableRow {
  page: number
  /** Printed serial number, when the table has an S.No column. */
  sno: number | null
  /** One string per column; wrapped lines are kept as "\n" so grammar rules can see them. */
  cells: string[]
  /** Pages this row spans (a row can continue onto the next page). */
  pages: number[]
  /** Bounding box of each cell on the row's first page (for re-reading a cell with OCR). */
  boxes: (Box | null)[]
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface TableSpec {
  /** True for the line that carries the column headings. */
  isHeader: (lineText: string) => boolean
  /** Index of the S.No column, or -1 if rows have no serial number. Defaults to the first column. */
  anchorColumn?: (cols: Column[]) => number
  /** How cells sit inside a row when there are no borders to go by. */
  align?: 'top' | 'center'
  /** A line matching this ends the table on that page (definitions and notes below the table). */
  stopAt?: RegExp
}

export interface Table {
  columns: Column[]
  rows: TableRow[]
  warnings: string[]
}

const center = (it: TextItem) => it.y - it.h * 0.35
const right = (it: TextItem) => it.x + it.w
const ANCHOR = /^\s*(\d{1,4})\s*\.?\s*$/

export const despace = (s: string) => s.toLowerCase().replace(/\s+/g, '')

export function groupLines(items: TextItem[], tol = 2.5): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: TextItem[][] = []
  for (const it of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last[0]!.y - it.y) <= tol) last.push(it)
    else lines.push([it])
  }
  return lines.map((ls) => {
    const items = ls.sort((a, b) => a.x - b.x)
    return { y: items[0]!.y, items, text: joinLine(items) }
  })
}

/** Joins items on one line, inserting a space only where there is a visible gap. */
export function joinLine(items: TextItem[]): string {
  let out = ''
  let prev: TextItem | undefined
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    if (prev) {
      const gap = it.x - right(prev)
      if (gap > Math.max(0.8, prev.h * 0.12)) out += ' '
    }
    out += it.str
    prev = it
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Multi-line cell text: lines top to bottom, joined with "\n". */
export function cellText(items: TextItem[]): string {
  return groupLines(items)
    .map((l) => l.text)
    .filter(Boolean)
    .join('\n')
}

export function extractTable(pages: PdfPage[], spec: TableSpec): Table {
  const warnings: string[] = []
  const rows: TableRow[] = []
  let columns: Column[] | null = null

  for (const page of pages) {
    const lines = groupLines(page.items)
    const headerIdx = lines.findIndex((l) => spec.isHeader(l.text))
    let regionTop = -Infinity
    if (headerIdx >= 0) {
      const header = findHeaderBlock(page, lines, headerIdx)
      const cols = columnsFromRules(page, header) ?? columnsFromLabels(page, header)
      if (cols.length >= 2) columns = cols
      regionTop = header.bottom
    }
    if (!columns) continue

    const tableLeft = columns[0]!.left
    const tableRight = columns[columns.length - 1]!.right
    // Notes and definitions start at the left margin; a cell that happens to begin
    // with "Note:" (inside the table) must not end it.
    const marginX = tableLeft + (tableRight - tableLeft) * 0.2
    const stop = spec.stopAt ? lines.find((l) => l.y > regionTop && l.items[0]!.x < marginX && spec.stopAt!.test(l.text)) : undefined
    const regionBottom = stop ? stop.y - stop.items[0]!.h : Infinity
    const inRegion = page.items.filter((it) => {
      const c = center(it)
      const cx = it.x + it.w / 2
      return c > regionTop && c < regionBottom && cx >= tableLeft - 2 && cx <= tableRight + 2
    })
    if (!inRegion.length) continue

    const anchorCol = spec.anchorColumn ? spec.anchorColumn(columns) : 0
    const align = spec.align ?? 'top'
    const ruled = bandsFromRules(page, inRegion, columns, regionTop, regionBottom)
    // A band holding two serial numbers means a border is missing: split it by anchors.
    const bands = ruled
      ? ruled.flatMap((b) => (countAnchors(b, columns!, anchorCol) > 1 ? bandsFromAnchors(b, columns!, anchorCol, align) : [b]))
      : bandsFromAnchors(inRegion, columns, anchorCol, align)

    for (const band of bands) {
      const cells = columns.map(() => [] as TextItem[])
      for (const it of band) cells[columnOf(columns, it)]!.push(it)
      const texts = cells.map(cellText)
      const boxes = cells.map(boxOf)
      if (!texts.some(Boolean)) continue
      const sno = anchorCol >= 0 ? ANCHOR.exec(texts[anchorCol] ?? '')?.[1] : undefined
      if (sno === undefined && groupLines(band).some((l) => spec.isHeader(l.text))) continue // header repeated on a later page
      const prev = rows[rows.length - 1]
      if (anchorCol >= 0 && sno === undefined) {
        // No serial number: the rest of the previous row (wrapped past a border or a page break).
        if (prev) {
          prev.cells = prev.cells.map((c, i) => [c, texts[i]].filter(Boolean).join('\n'))
          if (!prev.pages.includes(page.num)) prev.pages.push(page.num)
        } else warnings.push(`p${page.num}: text before the first row ignored`)
        continue
      }
      rows.push({ page: page.num, sno: sno === undefined ? null : Number(sno), cells: texts, pages: [page.num], boxes })
    }
  }
  if (!columns) warnings.push('no table header found')
  return { columns: columns ?? [], rows, warnings }
}

interface HeaderBlock {
  top: number
  bottom: number
  items: TextItem[]
  left: number
  right: number
}

/** The header line plus any wrapped heading lines below it, up to the first border or first data line. */
function findHeaderBlock(page: PdfPage, lines: Line[], idx: number): HeaderBlock {
  const first = lines[idx]!
  const top = Math.min(...first.items.map((i) => i.y - i.h)) - 1
  const left = Math.min(...first.items.map((i) => i.x))
  const rightEdge = Math.max(...first.items.map(right))
  const width = rightEdge - left
  const below = page.rules.h
    .filter((r) => r.at > first.y + 1 && r.to - r.from >= width * 0.6)
    .sort((a, b) => a.at - b.at)[0]
  let bottom: number
  if (below) bottom = below.at
  else {
    // No border: heading lines continue while they are close and carry no serial numbers.
    let last = first
    for (const l of lines.slice(idx + 1)) {
      if (l.y - last.y > last.items[0]!.h * 1.9) break
      if (l.items.some((i) => ANCHOR.test(i.str) && i.x < left + width * 0.08)) break
      if (/\d{3,}/.test(l.text)) break
      last = l
    }
    bottom = last.y + 2
  }
  const items = page.items.filter((i) => center(i) > top && center(i) < bottom)
  return { top, bottom, items, left, right: rightEdge }
}

function columnsFromRules(page: PdfPage, header: HeaderBlock): Column[] | null {
  const mid = (header.top + header.bottom) / 2
  const xs = page.rules.v
    .filter((r) => r.from <= mid + 2 && r.to >= mid - 2)
    .map((r) => r.at)
    .sort((a, b) => a - b)
  const edges: number[] = []
  for (const x of xs) if (!edges.length || x - edges[edges.length - 1]! > 3) edges.push(x)
  if (edges.length < 3) return null
  const cols: Column[] = []
  for (let i = 0; i + 1 < edges.length; i++) {
    const l = edges[i]!
    const r = edges[i + 1]!
    if (r - l < 4) continue
    const its = header.items.filter((it) => it.x + it.w / 2 >= l && it.x + it.w / 2 < r)
    const header_ = groupLines(its).map((x) => x.text).join(' ')
    cols.push({ left: l, right: r, header: header_, key: despace(header_) })
  }
  return cols
}

/**
 * Borderless tables: each heading cluster is a column, and the boundary between two
 * neighbours is placed where the fewest data items straddle it, preferring the x
 * where many items start (cells are usually left-aligned).
 */
export function columnsFromLabels(page: PdfPage, header: HeaderBlock): Column[] {
  const groups: { l: number; r: number; items: TextItem[] }[] = []
  for (const it of [...header.items].sort((a, b) => a.x - b.x)) {
    const g = groups.find((x) => it.x <= x.r + 2 && right(it) >= x.l - 2)
    if (g) {
      g.l = Math.min(g.l, it.x)
      g.r = Math.max(g.r, right(it))
      g.items.push(it)
    } else groups.push({ l: it.x, r: right(it), items: [it] })
  }
  groups.sort((a, b) => a.l - b.l)
  const data = page.items.filter((i) => center(i) > header.bottom)
  const bounds: number[] = []
  for (let i = 0; i + 1 < groups.length; i++) {
    const a = groups[i]!
    const b = groups[i + 1]!
    const lo = (a.l + a.r) / 2
    const hi = (b.l + b.r) / 2
    const cands = new Set<number>([Math.round((a.r + b.l) / 2), Math.round(b.l - 1)])
    for (const d of data) if (d.x > lo && d.x < hi) cands.add(Math.round(d.x - 1))
    let best = (a.r + b.l) / 2
    let bestScore = Infinity
    for (const c of cands) {
      const cross = data.filter((d) => d.x < c - 1 && right(d) > c + 1).length
      const starts = data.filter((d) => Math.abs(d.x - 1 - c) <= 2).length
      const score = cross * 1000 - starts + Math.abs(c - (a.r + b.l) / 2) / 1000
      if (score < bestScore) {
        bestScore = score
        best = c
      }
    }
    bounds.push(best)
  }
  return groups.map((g, i) => {
    const text = groupLines(g.items).map((x) => x.text).join(' ')
    return { left: i === 0 ? 0 : bounds[i - 1]!, right: i === groups.length - 1 ? page.width : bounds[i]!, header: text, key: despace(text) }
  })
}

function columnOf(cols: Column[], it: TextItem): number {
  const cx = it.x + it.w / 2
  const i = cols.findIndex((c) => cx >= c.left && cx < c.right)
  if (i >= 0) return i
  return cx < cols[0]!.left ? 0 : cols.length - 1
}

/** Row bands between consecutive horizontal borders that span most of the table. */
function bandsFromRules(page: PdfPage, items: TextItem[], cols: Column[], top: number, bottom: number): TextItem[][] | null {
  const left = cols[0]!.left
  const width = cols[cols.length - 1]!.right - left
  const ys = page.rules.h
    .filter((r: Segment) => r.to - r.from >= width * 0.6 && r.at >= top - 2 && r.at <= bottom + 2)
    .map((r) => r.at)
    .sort((a, b) => a - b)
  const lines: number[] = []
  for (const y of ys) if (!lines.length || y - lines[lines.length - 1]! > 2) lines.push(y)
  if (lines.length < 2) return null
  // Text above the first border belongs to the row continuing from the previous page.
  const edges = items.some((i) => center(i) < lines[0]!) ? [top, ...lines] : lines
  const bands: TextItem[][] = []
  for (let i = 0; i + 1 < edges.length; i++) {
    const t = edges[i]!
    const b = edges[i + 1]!
    const band = items.filter((it) => center(it) > t && center(it) <= b)
    if (band.length) bands.push(band)
  }
  return bands
}

function boxOf(items: TextItem[]): Box | null {
  if (!items.length) return null
  return {
    x0: Math.min(...items.map((i) => i.x)),
    y0: Math.min(...items.map((i) => i.y - i.h)),
    x1: Math.max(...items.map(right)),
    y1: Math.max(...items.map((i) => i.y + i.h * 0.25)),
  }
}

const countAnchors = (items: TextItem[], cols: Column[], anchorCol: number) =>
  anchorCol < 0 ? 0 : items.filter((it) => columnOf(cols, it) === anchorCol && ANCHOR.test(it.str)).length

/** Without borders, a row starts at its serial number and runs to the next one. */
function bandsFromAnchors(items: TextItem[], cols: Column[], anchorCol: number, align: 'top' | 'center'): TextItem[][] {
  if (anchorCol < 0) return [items]
  const anchors = items
    .filter((it) => columnOf(cols, it) === anchorCol && ANCHOR.test(it.str))
    .sort((a, b) => a.y - b.y)
  if (!anchors.length) return [items]
  const starts = anchors.map((a, i) => {
    if (align === 'center') return i === 0 ? -Infinity : (anchors[i - 1]!.y + a.y) / 2 - a.h * 0.35
    return a.y - a.h - 3
  })
  const bands: TextItem[][] = []
  const head = items.filter((it) => center(it) <= starts[0]!)
  if (head.length) bands.push(head)
  for (let i = 0; i < anchors.length; i++) {
    const t = starts[i]!
    const b = i + 1 < starts.length ? starts[i + 1]! : Infinity
    bands.push(items.filter((it) => center(it) > t && center(it) <= b))
  }
  return bands
}
