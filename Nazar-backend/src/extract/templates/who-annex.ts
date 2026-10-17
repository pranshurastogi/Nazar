import { batchText, flat } from '../grammar.ts'
import { groupLines } from '../layout.ts'
import type { PdfPage, TextItem } from '../pdf.ts'
import type { Candidate, Template, TemplateOutput } from './common.ts'

/**
 * WHO Medical Product Alert annex. The table is transposed: each product is a
 * COLUMN and each field a ROW ("Product", "Stated API", "Manufacturer", "Batch",
 * "Date of manufacture", "Expiry date", "Contamination"). Labels sit vertically
 * centred against multi-line values, so each value line goes to the label whose
 * block it centres on.
 */

type WhoField = 'product' | 'api' | 'manufacturer' | 'batch' | 'mfg' | 'exp' | 'contamination' | 'other'

const LABELS: [WhoField, RegExp][] = [
  ['product', /^product(\s+name)?$/i],
  ['api', /^stated\s+api|^active/i],
  ['manufacturer', /^(stated\s+)?manufacturer/i],
  ['batch', /^batch|^lot/i],
  ['mfg', /^date\s+of\s+manufacture|^manufactur\w*\s+date/i],
  ['exp', /^expiry|^exp\.?\s+date/i],
  ['contamination', /^contamina|^reason|^test\s+result/i],
  ['other', /^photos?|^(stated\s+)?country|^dosage|^strength|^marketing/i],
]

const center = (it: TextItem) => it.y - it.h * 0.35

export const whoAnnex: Template = {
  id: 'who-annex',
  parser: 'who-annex@1',
  expectPin: false,
  parse(pages: PdfPage[]): TemplateOutput {
    const warnings: string[] = []
    const alertNo = /Medical Product Alert\s*N°\s*(\d+\s*\/\s*\d{4})/i.exec(pages.map((p) => groupLines(p.items).map((l) => l.text).join('\n')).join('\n'))?.[1]?.replace(/\s+/g, '')
    const reportedBy = alertNo ? `WHO Medical Product Alert N°${alertNo}` : 'WHO Medical Product Alert'

    const page = pages.find((p) => p.items.some((i) => /^annex\b/i.test(i.str.trim())))
    if (!page) return { candidates: [], warnings: ['WHO annex not found'] }
    const annexY = page.items.find((i) => /^annex\b/i.test(i.str.trim()))!.y
    const items = page.items.filter((i) => i.y > annexY + 2)
    const lines = groupLines(items)

    // Label column: lines whose first item is a known field label, left-aligned with "Product".
    const productLine = lines.find((l) => LABELS[0]![1].test(l.items[0]!.str.trim()))
    if (!productLine) return { candidates: [], warnings: ['WHO annex has no Product row'] }
    const labelX = productLine.items[0]!.x
    const labels: { field: WhoField; y: number; x1: number }[] = []
    for (const l of lines) {
      const first = l.items[0]!
      const hit = LABELS.find(([, re]) => re.test(first.str.trim()))
      if (hit && Math.abs(first.x - labelX) < 12) labels.push({ field: hit[0], y: center(first), x1: first.x + first.w })
    }
    const productRow = labels.find((l) => l.field === 'product')!
    const labelRight = Math.max(...labels.map((l) => l.x1))
    const productItems = items.filter((i) => Math.abs(center(i) - productRow.y) < 3 && i.x > labelRight)
    const starts = productItems.map((i) => i.x).sort((a, b) => a - b)
    if (!starts.length) return { candidates: [], warnings: ['WHO annex lists no products'] }
    const footnote = items.find((i) => /^\*|^photos?/i.test(i.str.trim()) && i.x < labelRight)
    const bottom = labels.find((l) => l.field === 'other')?.y ?? (footnote ? center(footnote) : Infinity)

    const cells = starts.map(() => new Map<WhoField, TextItem[]>())
    const valueItems = items.filter((i) => i.x >= starts[0]! - 5 && center(i) <= bottom + 3)
    const colOf = (it: TextItem) => starts.reduce((best, s, k) => (it.x >= s - 5 ? k : best), 0)
    for (let col = 0; col < starts.length; col++) {
      const colLines = groupLines(valueItems.filter((i) => colOf(i) === col))
      const fields = assignBlocks(colLines.map((l) => center(l.items[0]!)), labels.map((l) => l.y))
      colLines.forEach((l, k) => {
        const field = labels[fields[k]!]?.field
        if (!field || field === 'other') return
        const m = cells[col]!
        m.set(field, [...(m.get(field) ?? []), ...l.items])
      })
    }

    const text = (m: Map<WhoField, TextItem[]>, f: WhoField) =>
      groupLines(m.get(f) ?? [])
        .map((l) => l.text)
        .join('\n')

    const candidates: Candidate[] = cells.map((m, k) => {
      const product = flat(text(m, 'product'))
      const api = flat(text(m, 'api'))
      const contamination = flat(text(m, 'contamination'))
      const raw = (['product', 'api', 'manufacturer', 'batch', 'mfg', 'exp', 'contamination'] as WhoField[])
        .map((f) => `${f}: ${flat(text(m, f))}`)
        .join(' | ')
      return {
        rowNo: k + 1,
        page: page.num,
        product: api ? `${product} (${api})` : product,
        batchCell: batchText(text(m, 'batch')),
        mfgRaw: flat(text(m, 'mfg')) || null,
        expRaw: flat(text(m, 'exp')) || null,
        manufacturer: flat(text(m, 'manufacturer')) || null,
        reason: contamination ? `Contaminated: ${contamination}` : 'Substandard (WHO Medical Product Alert)',
        reportedBy,
        rawText: raw,
      }
    })
    return { candidates, warnings }
  },
}

/**
 * Splits a column's value lines (top to bottom) into contiguous blocks, one per label
 * in order, so that each block is centred on its label. Nearest-label assignment
 * fails here: the last line of a five-line address sits closer to the next label.
 * Small dynamic programme: lines × labels. Returns the label index for each line.
 */
export function assignBlocks(lineYs: number[], labelYs: number[]): number[] {
  const n = lineYs.length
  const m = labelYs.length
  const INF = Number.POSITIVE_INFINITY
  // dp[j][i]: best cost placing the first i lines into the first j labels.
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(INF))
  const cut = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  dp[0]![0] = 0
  for (let j = 1; j <= m; j++) {
    for (let i = 0; i <= n; i++) {
      for (let k = 0; k <= i; k++) {
        const prev = dp[j - 1]![k]!
        if (prev === INF) continue
        const size = i - k
        // Off-centre cost per line, plus half the block height so that one label
        // cannot swallow its neighbours' lines symmetrically.
        const cost = size === 0 ? 0 : Math.abs((lineYs[k]! + lineYs[i - 1]!) / 2 - labelYs[j - 1]!) * size + (lineYs[i - 1]! - lineYs[k]!) / 2
        if (prev + cost < dp[j]![i]!) {
          dp[j]![i] = prev + cost
          cut[j]![i] = k
        }
      }
    }
  }
  const out = new Array<number>(n).fill(-1)
  let i = n
  for (let j = m; j >= 1; j--) {
    const k = cut[j]![i]!
    for (let x = k; x < i; x++) out[x] = j - 1
    i = k
  }
  return out
}
