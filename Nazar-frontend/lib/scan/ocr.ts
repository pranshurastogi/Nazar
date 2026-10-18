// Printed-text reading for packs without a code. tesseract.js runs in a Web Worker on the device; the photo
// stays in the page. The engine and English model are downloaded once and cached by the browser.
import type Tesseract from 'tesseract.js'

export type OcrResult = { text: string; confidence: number; words: { text: string; confidence: number }[] }

/** Letters, digits and the punctuation used on labels (batch, composition, MRP, % w/v). Drops OCR noise like | ~ « ». */
const WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.:-/()#,%&+;' "
const IDLE_MS = 120_000

let workerP: Promise<Tesseract.Worker> | null = null
let idle: ReturnType<typeof setTimeout> | null = null
let queue: Promise<unknown> = Promise.resolve()

function worker(): Promise<Tesseract.Worker> {
  if (idle) clearTimeout(idle)
  workerP ??= import('tesseract.js').then(async (mod) => {
    const createWorker = mod.createWorker ?? mod.default.createWorker
    const w = await createWorker('eng', 1 /* LSTM only */)
    await w.setParameters({ tessedit_char_whitelist: WHITELIST, preserve_interword_spaces: '1', user_defined_dpi: '300' })
    return w
  })
  workerP.catch(() => (workerP = null))
  return workerP
}

/** Starts the engine download early (while the camera looks for a code), without blocking anything. */
export function warmOcr() {
  worker().catch(() => {})
}

/** Frees the worker's memory a while after the scanner closes; the next scan reuses it until then. */
export function releaseOcrSoon() {
  if (idle) clearTimeout(idle)
  idle = setTimeout(() => {
    const p = workerP
    workerP = null
    p?.then((w) => w.terminate()).catch(() => {})
  }, IDLE_MS)
}

/** One recognition at a time; the worker is single-threaded and frames would otherwise pile up. */
export function recognize(canvas: HTMLCanvasElement, layout: 'block' | 'page'): Promise<OcrResult> {
  const job = queue.then(async () => {
    const w = await worker()
    // 6 = a single uniform block (the cropped label area), 3 = automatic page layout (a whole photo).
    await w.setParameters({ tessedit_pageseg_mode: (layout === 'block' ? '6' : '3') as unknown as Tesseract.PSM })
    const { data } = await w.recognize(canvas, {}, { text: true, blocks: true })
    const words = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.map((x) => ({ text: x.text, confidence: x.confidence })))))
    return { text: data.text, confidence: data.confidence, words }
  })
  queue = job.catch(() => {})
  return job
}

/** OCR confidence for one value: the mean of the words that make it up, else the page mean. */
export function confidenceOf(result: OcrResult, value: string): number {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const hits = result.words.filter((w) => {
    const k = w.text.toLowerCase().replace(/[^a-z0-9]/g, '')
    return k.length > 0 && (k.includes(key) || key.includes(k))
  })
  if (!hits.length) return result.confidence
  return hits.reduce((s, w) => s + w.confidence, 0) / hits.length
}

/**
 * Greyscale, contrast-stretched copy of a region, scaled so text is roughly 30px tall for Tesseract.
 * `crop` is a fraction of the source (the viewfinder's label window for camera frames).
 */
export function prepareForOcr(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  crop: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1, h: 1 },
  targetWidth = 1600,
): HTMLCanvasElement {
  const sx = Math.round(sw * crop.x)
  const sy = Math.round(sh * crop.y)
  const cw = Math.max(1, Math.round(sw * crop.w))
  const ch = Math.max(1, Math.round(sh * crop.h))
  const scale = Math.min(3, Math.max(0.25, targetWidth / cw))
  const out = document.createElement('canvas')
  out.width = Math.round(cw * scale)
  out.height = Math.round(ch * scale)
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, cw, ch, 0, 0, out.width, out.height)
  const img = ctx.getImageData(0, 0, out.width, out.height)
  const px = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i]! * 299 + px[i + 1]! * 587 + px[i + 2]! * 114) / 1000
    px[i] = g
    hist[g | 0]!++
  }
  // Stretch between the 2nd and 98th percentiles so faint or glossy print gets full contrast.
  const total = px.length / 4
  let lo = 0
  let hi = 255
  for (let acc = 0; lo < 255 && (acc += hist[lo]!) < total * 0.02; ) lo++
  for (let acc = 0; hi > 0 && (acc += hist[hi]!) < total * 0.02; ) hi--
  const range = Math.max(1, hi - lo)
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i]! - lo) * 255) / range))
    px[i] = px[i + 1] = px[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return out
}

/** A copy of the canvas turned by 90, 180 or 270 degrees, for labels photographed sideways. */
export function rotateCanvas(src: HTMLCanvasElement, deg: 90 | 180 | 270): HTMLCanvasElement {
  const out = document.createElement('canvas')
  const quarter = deg !== 180
  out.width = quarter ? src.height : src.width
  out.height = quarter ? src.width : src.height
  const ctx = out.getContext('2d')!
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return out
}

/** Black-and-white copy using Otsu's threshold: helps faint dot-matrix and foil print that greyscale leaves muddy. */
export function binarize(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, out.width, out.height)
  const px = img.data
  const hist = new Float64Array(256)
  for (let i = 0; i < px.length; i += 4) hist[px[i]!]!++
  const total = px.length / 4
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]!
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]!
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2
    if (between > best) {
      best = between
      threshold = t
    }
  }
  for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = px[i]! > threshold ? 255 : 0
  ctx.putImageData(img, 0, 0)
  return out
}

/**
 * Whole-label read for a photo or a still frame. One pass when the print reads well; when it does
 * not, also tries a thresholded copy and the two sideways rotations, keeping the most confident read.
 * The extra passes only run on poor reads, so a clear label costs a single recognition.
 */
export async function recognizeLabel(prepared: HTMLCanvasElement, opts: { tryHarder?: boolean } = {}): Promise<OcrResult> {
  let best = await recognize(prepared, 'page')
  if (!opts.tryHarder || best.confidence >= 60) return best
  for (const variant of [() => binarize(prepared), () => rotateCanvas(prepared, 90), () => rotateCanvas(prepared, 270)]) {
    const r = await recognize(variant(), 'page').catch(() => null)
    if (r && r.confidence > best.confidence + 5) best = r
    if (best.confidence >= 70) break
  }
  return best
}
