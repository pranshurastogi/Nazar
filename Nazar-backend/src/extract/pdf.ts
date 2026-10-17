import { getDocument, OPS, Util, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { ExtractionError } from '../lib/errors.ts'

/**
 * Loads a PDF into plain geometry: positioned text items plus the ruling lines the
 * table was drawn with. Coordinates are top-down page points (viewport scale 1), so
 * "y grows downwards" everywhere in the extractor, whatever the page rotation.
 */

export interface TextItem {
  str: string
  /** Left edge. */
  x: number
  /** Baseline, measured from the top of the page. */
  y: number
  w: number
  /** Font height. */
  h: number
}

/** A horizontal (y fixed, x0..x1) or vertical (x fixed, y0..y1) ruling segment. */
export interface Segment {
  at: number
  from: number
  to: number
}

export interface PdfPage {
  num: number
  width: number
  height: number
  items: TextItem[]
  rules: { h: Segment[]; v: Segment[] }
  /** True when the page paints an image and carries (almost) no text: a scan that needs OCR. */
  imageOnly: boolean
  /** Set when items came from OCR rather than the text layer. */
  ocr?: boolean
}

export interface LoadedPdf {
  pages: PdfPage[]
  doc: PDFDocumentProxy
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  try {
    // pdfjs takes ownership of the buffer it is given, so hand it a copy. (pdfjs v6 no
    // longer evaluates font code at all, so the old isEvalSupported switch is gone.)
    return await getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: false }).promise
  } catch (err) {
    throw new ExtractionError('Could not open PDF', { size: bytes.byteLength }, { cause: err })
  }
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const doc = await openPdf(bytes)
  const pages: PdfPage[] = []
  for (let n = 1; n <= doc.numPages; n++) pages.push(await readPage(await doc.getPage(n)))
  return { pages, doc }
}

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const mul = (m: Matrix, n: readonly number[]): Matrix => Util.transform(m, n) as Matrix
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

async function readPage(page: PDFPageProxy): Promise<PdfPage> {
  const viewport = page.getViewport({ scale: 1 })
  const vt = viewport.transform as Matrix
  const content = await page.getTextContent()
  const items: TextItem[] = []
  for (const it of content.items) {
    if (!('str' in it) || !it.str.trim()) continue
    const t = mul(vt, it.transform as number[])
    const h = Math.hypot(t[2], t[3]) || Math.abs(it.height) || 8
    items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h })
  }
  const { rules, images } = await readGraphics(page, vt)
  const textChars = items.reduce((n, i) => n + i.str.trim().length, 0)
  return {
    num: page.pageNumber,
    width: viewport.width,
    height: viewport.height,
    items,
    rules,
    imageOnly: images > 0 && textChars < 40,
  }
}

const IMAGE_OPS = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject])
const FILL_OPS = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke])
const STROKE_OPS = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])

/**
 * Walks the operator list tracking the transform matrix, and keeps the thin filled
 * rectangles and straight stroked segments that make up table borders. Word and
 * Excel exports draw borders both ways.
 */
async function readGraphics(page: PDFPageProxy, vt: Matrix): Promise<{ rules: PdfPage['rules']; images: number }> {
  const ops = await page.getOperatorList()
  const h: Segment[] = []
  const v: Segment[] = []
  let ctm: Matrix = IDENTITY
  const stack: Matrix[] = []
  let images = 0

  const addBox = (x0: number, y0: number, x1: number, y1: number) => {
    const w = x1 - x0
    const ht = y1 - y0
    if (ht <= 2.5 && w >= 8) h.push({ at: (y0 + y1) / 2, from: x0, to: x1 })
    else if (w <= 2.5 && ht >= 6) v.push({ at: (x0 + x1) / 2, from: y0, to: y1 })
  }

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]!
    const args = ops.argsArray[i] as unknown[]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = mul(ctm, args as number[])
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm)
      const m = args[0] as number[] | null
      if (m) ctm = mul(ctm, m)
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
    else if (IMAGE_OPS.has(fn)) images++
    else if (fn === OPS.constructPath) {
      const paint = args[0] as number
      const fill = FILL_OPS.has(paint)
      const stroke = STROKE_OPS.has(paint)
      if (!fill && !stroke) continue // clip paths
      const m = mul(vt, ctm)
      for (const sub of subpaths(args[1])) {
        const pts = sub.map(([x, y]) => apply(m, x, y))
        if (fill) {
          const xs = pts.map((p) => p[0])
          const ys = pts.map((p) => p[1])
          addBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
        }
        if (stroke) {
          for (let k = 1; k < pts.length; k++) {
            const [ax, ay] = pts[k - 1]!
            const [bx, by] = pts[k]!
            if (Math.abs(ay - by) < 1 && Math.abs(ax - bx) >= 8) h.push({ at: (ay + by) / 2, from: Math.min(ax, bx), to: Math.max(ax, bx) })
            else if (Math.abs(ax - bx) < 1 && Math.abs(ay - by) >= 6) v.push({ at: (ax + bx) / 2, from: Math.min(ay, by), to: Math.max(ay, by) })
          }
        }
      }
    }
  }
  return { rules: { h: mergeSegments(h), v: mergeSegments(v) }, images }
}

/** Decodes pdfjs path data (moveTo 0, lineTo 1, curveTo 2, quadraticCurveTo 3, closePath 4) into point lists. */
function subpaths(raw: unknown): [number, number][][] {
  const data = (Array.isArray(raw) ? raw[0] : raw) as ArrayLike<number> | undefined
  if (!data || typeof data.length !== 'number') return []
  const out: [number, number][][] = []
  let cur: [number, number][] = []
  for (let k = 0; k < data.length; ) {
    const op = data[k]!
    if (op === 0) {
      if (cur.length) out.push(cur)
      cur = [[data[k + 1]!, data[k + 2]!]]
      k += 3
    } else if (op === 1) {
      cur.push([data[k + 1]!, data[k + 2]!])
      k += 3
    } else if (op === 2) {
      cur.push([data[k + 5]!, data[k + 6]!])
      k += 7
    } else if (op === 3) {
      cur.push([data[k + 3]!, data[k + 4]!])
      k += 5
    } else if (op === 4) {
      if (cur.length) cur.push(cur[0]!)
      k += 1
    } else break // unknown encoding: stop rather than misread
  }
  if (cur.length) out.push(cur)
  return out
}

/** Joins collinear, touching segments so a row border split per cell becomes one line. */
export function mergeSegments(segs: Segment[], tol = 1.5, gap = 3): Segment[] {
  const sorted = [...segs].sort((a, b) => a.at - b.at || a.from - b.from)
  const rows: Segment[][] = []
  for (const s of sorted) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(last[0]!.at - s.at) <= tol) last.push(s)
    else rows.push([s])
  }
  const out: Segment[] = []
  for (const row of rows) {
    const at = row.reduce((n, s) => n + s.at, 0) / row.length
    const spans = row.sort((a, b) => a.from - b.from)
    let cur = { at, from: spans[0]!.from, to: spans[0]!.to }
    for (const s of spans.slice(1)) {
      if (s.from <= cur.to + gap) cur.to = Math.max(cur.to, s.to)
      else {
        out.push(cur)
        cur = { at, from: s.from, to: s.to }
      }
    }
    out.push(cur)
  }
  return out
}

/** All page text in reading order, for fingerprinting and LLM grounding. */
export function pageText(page: PdfPage): string {
  const sorted = [...page.items].sort((a, b) => (Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x))
  let out = ''
  let prev: TextItem | undefined
  for (const it of sorted) {
    if (prev) out += Math.abs(prev.y - it.y) > 2 ? '\n' : ' '
    out += it.str
    prev = it
  }
  return out
}
