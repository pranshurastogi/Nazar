// One photo of a pack, read entirely on the device: QR / Data Matrix / GS1 codes first, then the whole
// printed label with the Pack Reader (Tesseract in a worker). Used by the Cabinet's "add from a photo";
// the Check page's scanner keeps its own flow. The image is drawn to a canvas in this page and never sent.

import { decodePhoto, warmDecoders, type DecodedCode } from './decode'
import { prepareForOcr, recognizeLabel, releaseOcrSoon, warmOcr } from './ocr'
import type { PackLabel } from './pack'
import { interpretCode, interpretOcr, readPack, readsDisagree, type ScanRead } from './read'

export type PhotoStage = 'opening' | 'code' | 'text'

export type PhotoRead = {
  /** The best code found: one with a batch, then one with dates. */
  code: ScanRead | null
  /** The whole printed label, when any text was read. */
  pack: PackLabel | null
  /** Raw OCR text ('' when nothing was read). Only this text (never the image) may be sent for an AI guess. */
  text: string
  /** Batch printed after a B.No. label, when the code also carries one and they disagree. */
  mismatch?: { code: string; printed: string }
}

/** The best read among several codes in a photo: one with a batch, then one with dates. */
export function bestCodeRead(codes: DecodedCode[]): ScanRead | null {
  const reads = codes.map((c) => interpretCode(c.text, c.format)).filter((r): r is ScanRead => !!r)
  return reads.find((r) => r.batch) ?? reads.find((r) => r.expiry) ?? reads[0] ?? null
}

/** Starts downloading the decoders and the OCR engine, e.g. when the person reaches for the camera. */
export function warmPhotoReader() {
  warmDecoders()
  warmOcr()
}

/**
 * Reads a photo of a pack. Codes are error-corrected, so a code's batch and expiry win; the printed
 * label still gives the product name, composition and maker, and is a second opinion on the batch.
 */
export async function readPackPhoto(file: Blob, onStage?: (s: PhotoStage) => void): Promise<PhotoRead> {
  onStage?.('opening')
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  onStage?.('code')
  const code = bestCodeRead(await decodePhoto(canvas, file).catch(() => []))

  onStage?.('text')
  const ocrInput = prepareForOcr(canvas, canvas.width, canvas.height, undefined, 2000)
  try {
    const r = await recognizeLabel(ocrInput, { tryHarder: !code?.batch })
    const text = r.text.trim()
    if (!text) return { code, pack: null, text: '' }
    const pack = readPack(r)
    const printed = interpretOcr(r.text)?.batch
    const mismatch = code?.batch && printed && readsDisagree(code.batch, printed) ? { code: code.batch, printed } : undefined
    return { code, pack, text, ...(mismatch ? { mismatch } : {}) }
  } catch {
    // The text reader could not load (offline on first use): a code read still counts.
    if (code) return { code, pack: null, text: '' }
    throw new Error('ocr-unavailable')
  } finally {
    releaseOcrSoon()
  }
}
