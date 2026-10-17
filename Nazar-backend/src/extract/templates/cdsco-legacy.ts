import { batchText, flat, parseCombined } from '../grammar.ts'
import type { PdfPage } from '../pdf.ts'
import { headerLine, headerTable, type Candidate, type Template } from './common.ts'

/**
 * CDSCO monthly lists 2013 to about 2023 (portrait): Sl. No | Name of Drugs |
 * "Batch No./Date of Manufacture/Date of Expiry/Manufactured By" in one cell |
 * Reason for failure | Drawn By | From. A kit row can hold several "B. No." blocks.
 */
export const cdscoLegacy: Template = {
  id: 'cdsco-legacy',
  parser: 'cdsco-legacy@1',
  expectPin: true,
  parse(pages: PdfPage[]) {
    return headerTable(
      pages,
      {
        isHeader: headerLine(/batch\s*no/i, /reason/i, /drawn|from/i),
        stopAt: /^(note\s*:|spurious drugs:|not of standard quality \(nsq\) drugs:)/i,
      },
      ['sno', 'combined', 'product', 'batch', 'mfg', 'exp', 'manufacturer', 'reason', 'drawnBy', 'lab'],
      (get, row, raw) => {
        const base = {
          rowNo: row.sno,
          page: row.page,
          product: flat(get('product')),
          reason: flat(get('reason')) || null,
          reportedBy: flat(get('drawnBy')) || flat(get('lab')) || null,
          rawText: raw,
        }
        const combined = get('combined')
        if (!combined) {
          return { ...base, batchCell: batchText(get('batch')), mfgRaw: flat(get('mfg')) || null, expRaw: flat(get('exp')) || null, manufacturer: flat(get('manufacturer')) || null }
        }
        const blocks = parseCombined(combined)
        if (!blocks.length) return { ...base, batchCell: '', mfgRaw: null, expRaw: null, manufacturer: null, issues: ['no "B. No." in batch cell'] }
        return blocks.map(
          (b): Candidate => ({
            ...base,
            batchCell: batchText(b.batch),
            mfgRaw: b.mfg,
            expRaw: b.exp,
            manufacturer: b.manufacturer,
            issues: blocks.length > 1 ? ['one of several batches listed in a single row'] : [],
          }),
        )
      },
    )
  },
}
