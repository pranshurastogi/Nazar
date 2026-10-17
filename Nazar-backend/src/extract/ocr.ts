import { mkdirSync } from 'node:fs'

import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'

import { dataPath, env } from '../config/env.ts'
import { isPlausibleBatch, splitBatches } from '../domain/batch.ts'
import { ExtractionError, errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import type { Box } from './layout.ts'
import type { PdfPage, TextItem } from './pdf.ts'
import type { Candidate } from './templates/common.ts'

/**
 * OCR fallback for scanned pages. Pages are rendered with pdfjs onto @napi-rs/canvas
 * and read by tesseract.js; words come back as TextItems in page points, so the
 * same table engine handles scans and text PDFs. One worker is reused for the
 * process; trained data is cached under data/tessdata.
 */

const log = child('ocr')

/** Characters a batch number can contain; used when re-reading a single cell. */
export const BATCH_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/.'
const DEFAULT_SCALE = 3 // about 216 dpi for a 72 pt/in page

let workerPromise: Promise<Worker> | null = null
let queue: Promise<unknown> = Promise.resolve()

/** Runs jobs one at a time: setParameters is worker-global, so a cell re-read must not interleave with a page. */
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

export async function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const cachePath = dataPath('tessdata')
    mkdirSync(cachePath, { recursive: true })
    const w = await createWorker(env().NAZAR_OCR_LANG, OEM.LSTM_ONLY, { cachePath, logger: () => {} })
    await w.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: String(72 * DEFAULT_SCALE) })
    return w
  })().catch((err) => {
    workerPromise = null
    throw new ExtractionError('Could not start OCR worker (trained data download may have failed)', {}, { cause: err })
  })
  return workerPromise
}

export async function terminateOcr(): Promise<void> {
  const w = workerPromise
  workerPromise = null
  if (w) await (await w.catch(() => null))?.terminate()
}

export interface RenderedPage {
  png: Buffer
  scale: number
  width: number
  height: number
}

export async function renderPage(pdf: PDFDocumentProxy, pageNum: number, scale = DEFAULT_SCALE): Promise<RenderedPage> {
  const page = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise
  return { png: await canvas.encode('png'), scale, width: canvas.width, height: canvas.height }
}

/** Recognises an image and returns its words as TextItems, scaled back to page points. */
export async function recognizeItems(png: Buffer, scale: number): Promise<TextItem[]> {
  const w = await getWorker()
  return exclusive(async () => {
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' })
    const { data } = await w.recognize(png, {}, { blocks: true, text: true })
    const items: TextItem[] = []
    for (const block of data.blocks ?? [])
      for (const para of block.paragraphs)
        for (const line of para.lines)
          for (const word of line.words) {
            const str = word.text.trim()
            if (!str || word.confidence < 20) continue
            const { x0, y0, x1, y1 } = word.bbox
            items.push({ str, x: x0 / scale, y: y1 / scale, w: (x1 - x0) / scale, h: (y1 - y0) / scale })
          }
    return items
  })
}

/** OCRs scanned pages in place: their items are replaced and they are marked `ocr`. */
export async function ocrPages(pdf: PDFDocumentProxy, pages: PdfPage[]): Promise<void> {
  for (const page of pages) {
    const r = await renderPage(pdf, page.num)
    page.items = await recognizeItems(r.png, r.scale)
    page.ocr = true
    log.info({ page: page.num, words: page.items.length }, 'ocr page')
  }
}

/** An image document (photo or scan) as a single OCR'd page; coordinates are pixels. */
export async function ocrImageBytes(bytes: Uint8Array): Promise<PdfPage> {
  const img = await loadImage(Buffer.from(bytes))
  const items = await recognizeItems(Buffer.from(bytes), 1)
  return { num: 1, width: img.width, height: img.height, items, rules: { h: [], v: [] }, imageOnly: true, ocr: true }
}

/** Re-reads one cell with the batch whitelist and single-line layout. Box is in page points. */
export async function readCell(rendered: RenderedPage, box: Box): Promise<string> {
  const w = await getWorker()
  const pad = 2 * rendered.scale
  const left = Math.max(0, Math.floor(box.x0 * rendered.scale - pad))
  const top = Math.max(0, Math.floor(box.y0 * rendered.scale - pad))
  const rectangle = {
    left,
    top,
    width: Math.min(rendered.width - left, Math.ceil((box.x1 - box.x0) * rendered.scale + 2 * pad)),
    height: Math.min(rendered.height - top, Math.ceil((box.y1 - box.y0) * rendered.scale + 2 * pad)),
  }
  return exclusive(async () => {
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: BATCH_WHITELIST })
    try {
      const { data } = await w.recognize(rendered.png, { rectangle })
      return data.text.replace(/\s*\n\s*/g, '').trim()
    } finally {
      await w.setParameters({ tessedit_char_whitelist: '' })
    }
  })
}

/**
 * For rows on OCR'd pages whose batch cell did not read as a plausible batch, re-read
 * just that cell with the batch whitelist. A successful re-read is flagged in issues.
 */
export async function rereadBatches(
  pdf: PDFDocumentProxy,
  candidates: Candidate[],
  ocrPageNums: Set<number>,
  warnings: string[],
): Promise<Candidate[]> {
  const renders = new Map<number, RenderedPage>()
  const out: Candidate[] = []
  for (const c of candidates) {
    if (!ocrPageNums.has(c.page) || !c.batchBox || splitBatches(c.batchCell).length) {
      out.push(c)
      continue
    }
    try {
      let r = renders.get(c.page)
      if (!r) {
        r = await renderPage(pdf, c.page)
        renders.set(c.page, r)
      }
      const text = await readCell(r, c.batchBox)
      if (text && isPlausibleBatch(text)) out.push({ ...c, batchCell: text, issues: [...(c.issues ?? []), 'batch re-read by OCR with batch character set'] })
      else out.push(c)
    } catch (err) {
      warnings.push(`batch re-read failed on page ${c.page}: ${errorMessage(err)}`)
      out.push(c)
    }
  }
  return out
}
