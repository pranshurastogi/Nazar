import { extractTable, type Box, type Column, type TableRow, type TableSpec } from '../layout.ts'
import { flat } from '../grammar.ts'
import type { PdfPage } from '../pdf.ts'

/** A row as a template reads it, before batch splitting, date parsing and scoring. */
export interface Candidate {
  /** Printed serial number (or position for tables without one). */
  rowNo: number | null
  page: number
  product: string
  /** Batch cell text, possibly listing several batches. */
  batchCell: string
  mfgRaw: string | null
  expRaw: string | null
  manufacturer: string | null
  reason: string | null
  reportedBy: string | null
  rawText: string
  /** Where the batch cell sits, so an OCR'd page can re-read just that cell. */
  batchBox?: Box | null
  /** Template-level doubts, each a small confidence penalty. */
  issues?: string[]
}

export interface TemplateOutput {
  candidates: Candidate[]
  warnings: string[]
}

export const TEMPLATE_IDS = ['cdsco-modern', 'cdsco-legacy', 'tn-nsq', 'tn-recall', 'who-annex', 'generic'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export interface Template {
  id: TemplateId
  /** Parser id with version, part of every row id: bump it when output changes. */
  parser: string
  /** The table prints full manufacturer addresses (so a missing PIN is suspicious). */
  expectPin: boolean
  parse(pages: PdfPage[]): TemplateOutput
}

export type Field =
  | 'sno'
  | 'combined'
  | 'product'
  | 'brand'
  | 'batch'
  | 'mfg'
  | 'exp'
  | 'manufacturer'
  | 'reason'
  | 'reportedBy'
  | 'drawnBy'
  | 'lab'
  | 'firmReply'
  | 'zone'
  | 'marketer'

/** Header patterns, matched against the despaced lowercase header. Earlier patterns win. */
export const FIELD_PATTERNS: Record<Field, RegExp[]> = {
  combined: [/batch.*(expiry|manufactur|mfg)/],
  sno: [/^(s|sl|sr)\.?(no|n|number)?\.?$/, /^(s|sl|sr)\.?no/],
  product: [/^product(name)?$/, /nameof(the)?(product|drug)/, /product\/?drug/, /drugname|productname/, /^(item|name)$/],
  brand: [/brandname/],
  batch: [/batch|lot(no|number)/],
  mfg: [/^(mfg|mfd|dom)\.?(date)?$/, /(manufactur\w*|mfg|mfd)\.?date|dateofmanufactur/],
  exp: [/^(exp|doe)\.?(date)?$/, /expiry|exp\.?date|dateofexp/],
  manufacturer: [/manufacturedby|mfgby|mfdby/, /^manufacturer(name)?$/, /manufacturer|firm/],
  reason: [/nsqresult|reasonfor|failure|testresult|defect/, /result/],
  reportedBy: [/reportedby|reportingsource|testinglab/],
  drawnBy: [/drawnby/],
  lab: [/^from$/],
  firmReply: [/firm.?s?reply/],
  zone: [/^zone$/],
  marketer: [/mktby|marketedby/],
}

/** Assigns each wanted field to one column, field by field, best pattern first. */
export function mapColumns(cols: Column[], fields: Field[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {}
  const taken = new Set<number>()
  for (const f of fields) {
    for (const re of FIELD_PATTERNS[f]) {
      const i = cols.findIndex((c, k) => !taken.has(k) && re.test(c.key))
      if (i >= 0) {
        out[f] = i
        taken.add(i)
        break
      }
    }
  }
  return out
}

/** Audit text for a row: "Header: value | Header: value". Also the grounding source for the LLM. */
export function rowRaw(row: TableRow, cols: Column[]): string {
  return cols
    .map((c, i) => {
      const v = flat(row.cells[i])
      return v ? `${c.header || `col${i + 1}`}: ${v}` : ''
    })
    .filter(Boolean)
    .join(' | ')
}

export interface Getter {
  (f: Field): string
  box(f: Field): Box | null
}

/**
 * Shared driver for header-mapped tables: extract the table, map headers to fields,
 * and hand each row to the template's builder.
 */
export function headerTable(
  pages: PdfPage[],
  spec: TableSpec,
  fields: Field[],
  build: (get: Getter, row: TableRow, raw: string) => Candidate | Candidate[] | null,
  required: Field[] = ['batch', 'product'],
): TemplateOutput {
  const table = extractTable(pages, spec)
  const warnings = [...table.warnings]
  const map = mapColumns(table.columns, fields)
  const missing = required.filter((f) => map[f] === undefined && !(f === 'batch' && map.combined !== undefined))
  if (table.columns.length && missing.length) {
    warnings.push(`columns not found: ${missing.join(', ')} (headers: ${table.columns.map((c) => c.header).join(' / ')})`)
    return { candidates: [], warnings }
  }
  const candidates: Candidate[] = []
  for (const row of table.rows) {
    const get = ((f: Field) => (map[f] === undefined ? '' : (row.cells[map[f]!] ?? ''))) as Getter
    get.box = (f: Field) => (map[f] === undefined ? null : (row.boxes[map[f]!] ?? null))
    const c = build(get, row, rowRaw(row, table.columns))
    if (c) candidates.push(...(Array.isArray(c) ? c : [c]))
  }
  warnings.push(...serialGaps(table.rows))
  return { candidates, warnings }
}

/** Warns when printed serial numbers skip or repeat, a sign a row was lost or split. */
function serialGaps(rows: TableRow[]): string[] {
  const nums = rows.map((r) => r.sno).filter((n): n is number => n !== null)
  const out: string[] = []
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1]! + 1) out.push(`serial number ${nums[i]} follows ${nums[i - 1]}`)
  }
  return out
}

/** Header-line test from required words: every group must match somewhere on the line. */
export const headerLine =
  (...groups: RegExp[]) =>
  (text: string) =>
    groups.every((g) => g.test(text))

