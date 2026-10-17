import { batchText, flat } from '../grammar.ts'
import type { PdfPage } from '../pdf.ts'
import { headerLine, headerTable, type Template } from './common.ts'

/**
 * Tamil Nadu NSQ recall list: ZONE | NAME OF THE DRUG | BATCH NO | MFG DATE | EXP DATE |
 * MFG BY | MKT BY | QTY RECALLED. No serial numbers, so each bordered band is a row.
 */
export const tnRecall: Template = {
  id: 'tn-recall',
  parser: 'tn-recall@1',
  expectPin: true,
  parse(pages: PdfPage[]) {
    return headerTable(
      pages,
      { isHeader: headerLine(/batch/i, /drug|product/i, /zone|mfg|exp/i), anchorColumn: () => -1, align: 'center' },
      ['zone', 'product', 'batch', 'mfg', 'exp', 'manufacturer', 'marketer'],
      (get, row, raw) => {
        const zone = flat(get('zone'))
        return {
          rowNo: null,
          page: row.page,
          product: flat(get('product')),
          batchCell: batchText(get('batch')),
          mfgRaw: flat(get('mfg')) || null,
          expRaw: flat(get('exp')) || null,
          manufacturer: flat(get('manufacturer')) || null,
          // The list itself is the finding: every batch on it is recalled as NSQ.
          reason: 'Recalled as Not of Standard Quality (NSQ)',
          reportedBy: zone ? `Drugs Control Department, Tamil Nadu (${zone} zone)` : 'Drugs Control Department, Tamil Nadu',
          rawText: raw,
          batchBox: get.box('batch'),
        }
      },
    )
  },
}
