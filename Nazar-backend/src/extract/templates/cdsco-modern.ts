import { batchText, flat } from '../grammar.ts'
import type { PdfPage } from '../pdf.ts'
import { headerLine, headerTable, type Template } from './common.ts'

/**
 * CDSCO monthly lists from 2024 on (landscape): S.No | Product/Drug Name | Batch No. |
 * Manufacturing Date | Expiry Date | Manufactured By | NSQ Result | Reported by.
 * The same layout serves the central-lab NSQ list, the STATE NSQ list and the
 * SPURIOUS list (which adds Drawn By, Firm's reply and Remarks).
 */
export const cdscoModern: Template = {
  id: 'cdsco-modern',
  parser: 'cdsco-modern@1',
  expectPin: true,
  parse(pages: PdfPage[]) {
    const spurious = pages.slice(0, 1).some((p) => p.items.some((i) => /declared\s+as\s+spurious/i.test(i.str)))
    return headerTable(
      pages,
      {
        isHeader: headerLine(/batch\s*no/i, /product|name\s+of/i, /manufactur|expiry|date\s+of/i),
        stopAt: /^(not of standard quality \(nsq\) drugs:|spurious drugs:|note\s*:)/i,
      },
      ['sno', 'product', 'batch', 'mfg', 'exp', 'manufacturer', 'reason', 'reportedBy', 'drawnBy', 'firmReply'],
      (get, row, raw) => {
        const failure = flat(get('reason'))
        const reply = flat(get('firmReply'))
        // The spurious list's "reason" column names the failed tests; the finding itself
        // is that the batch is spurious, so say so (resolve classifies on this text).
        const reason = spurious ? `Declared spurious${failure ? `: ${failure}` : ''}` : failure
        return {
          rowNo: row.sno,
          page: row.page,
          product: flat(get('product')),
          batchCell: batchText(get('batch')),
          mfgRaw: flat(get('mfg')) || null,
          expRaw: flat(get('exp')) || null,
          manufacturer: flat(get('manufacturer')) || null,
          reason: reason || (reply ? `Declared spurious: ${reply}` : null),
          reportedBy: flat(get('reportedBy')) || flat(get('drawnBy')) || null,
          rawText: raw,
          batchBox: get.box('batch'),
        }
      },
    )
  },
}
