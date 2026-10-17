import { afterAll, describe, expect, it } from 'vitest'

import { getWorker, readCell, recognizeItems, renderPage, terminateOcr } from '../../../src/extract/ocr.ts'
import { openPdf } from '../../../src/extract/pdf.ts'
import { fixture } from './helpers.ts'

/**
 * Renders a real fixture page to an image and reads it back with tesseract. The first
 * run downloads eng.traineddata (cached under data/tessdata); offline, the test skips.
 */
describe('ocr', () => {
  afterAll(async () => {
    await terminateOcr()
  })

  it('renders a PDF page to PNG', async () => {
    const pdf = await openPdf(fixture('tn-2026-06-nsq-recall.pdf').bytes)
    const r = await renderPage(pdf, 1, 2)
    expect(r.png.subarray(1, 4).toString()).toBe('PNG')
    expect(r.width).toBe(Math.ceil(792 * 2))
    await pdf.loadingTask.destroy()
  })

  it('recognises words with positions in page points', { timeout: 180_000 }, async (ctx) => {
    try {
      await getWorker()
    } catch {
      ctx.skip() // no network for the trained-data download
    }
    const pdf = await openPdf(fixture('tn-2026-06-nsq-recall.pdf').bytes)
    const r = await renderPage(pdf, 1, 3)
    const items = await recognizeItems(r.png, r.scale)
    const text = items.map((i) => i.str).join(' ')
    expect(text).toMatch(/RECALL/i)
    expect(text).toMatch(/MMPT9348/)
    const batch = items.find((i) => i.str.includes('MMPT9348'))!
    // Text-layer position of MMPT9348 is x≈271 (top-down y≈162 on a 612 pt page).
    expect(Math.abs(batch.x - 271)).toBeLessThan(6)
    expect(Math.abs(batch.y - (612 - 450))).toBeLessThan(8)

    // Re-reading just the batch cell with the batch-only character set.
    const cell = await readCell(r, { x0: batch.x, y0: batch.y - batch.h, x1: batch.x + batch.w, y1: batch.y + 1 })
    expect(cell).toBe('MMPT9348')
    await pdf.loadingTask.destroy()
  })
})
