import { batchText, flat } from '../grammar.ts'
import type { PdfPage } from '../pdf.ts'
import { headerTable, mapColumns, type Template } from './common.ts'

const HEADER_WORDS = [/batch|lot\s*no/i, /product|drug|name\s+of/i, /manufactur|mfg|mfd/i, /exp/i, /reason|result|remarks|failure/i, /s\.?\s*no|sl\.|sr\./i]

/**
 * Fallback for table PDFs no template knows: the header is the first line naming a
 * batch column plus at least two other familiar headings; fields map by header text.
 */
export const generic: Template = {
  id: 'generic',
  parser: 'generic@1',
  expectPin: false,
  parse(pages: PdfPage[]) {
    return headerTable(
      pages,
      {
        isHeader: (t) => HEADER_WORDS[0]!.test(t) && HEADER_WORDS.slice(1).filter((re) => re.test(t)).length >= 2,
        anchorColumn: (cols) => mapColumns(cols, ['sno']).sno ?? -1,
      },
      ['sno', 'combined', 'product', 'brand', 'batch', 'mfg', 'exp', 'manufacturer', 'reason', 'reportedBy', 'drawnBy'],
      (get, row, raw) => ({
        rowNo: row.sno,
        page: row.page,
        product: flat(get('product')),
        batchCell: batchText(get('batch')),
        mfgRaw: flat(get('mfg')) || null,
        expRaw: flat(get('exp')) || null,
        manufacturer: flat(get('manufacturer')) || null,
        reason: flat(get('reason')) || null,
        reportedBy: flat(get('reportedBy')) || flat(get('drawnBy')) || null,
        rawText: raw,
        batchBox: get.box('batch'),
        issues: ['parsed by the generic table reader'],
      }),
    )
  },
}
