import { batchText, flat, isMissing } from '../grammar.ts'
import type { PdfPage } from '../pdf.ts'
import { headerLine, headerTable, type Template } from './common.ts'

/**
 * Tamil Nadu Drugs Control monthly NSQ list. Columns change from month to month
 * (Aug 2026 has 16, earlier lists fewer), so every field is found by its header.
 */
export const tnNsq: Template = {
  id: 'tn-nsq',
  parser: 'tn-nsq@1',
  expectPin: true,
  parse(pages: PdfPage[]) {
    return headerTable(
      pages,
      { isHeader: headerLine(/batch/i, /product|drug/i, /expiry|nsq|manufactur/i) },
      ['sno', 'product', 'brand', 'batch', 'mfg', 'exp', 'manufacturer', 'reason', 'reportedBy'],
      (get, row, raw) => {
        const name = flat(get('product'))
        const brand = flat(get('brand'))
        const product = brand && !isMissing(brand) && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} (${brand})` : name
        return {
          rowNo: row.sno,
          page: row.page,
          product,
          batchCell: batchText(get('batch')),
          mfgRaw: flat(get('mfg')) || null,
          expRaw: flat(get('exp')) || null,
          manufacturer: flat(get('manufacturer')) || null,
          reason: flat(get('reason')) || null,
          reportedBy: flat(get('reportedBy')) || null,
          rawText: raw,
          batchBox: get.box('batch'),
        }
      },
    )
  },
}
