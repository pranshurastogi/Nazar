// Barcode and QR decoding on the device: the browser's BarcodeDetector when it has one, otherwise
// zxing-wasm, loaded only when the scanner first needs it. Pixels never leave the page.

export type DecodedCode = { text: string; format: string }

type NativeDetector = { detect(source: CanvasImageSource | ImageBitmap | ImageData | Blob): Promise<{ rawValue: string; format: string }[]> }
type NativeDetectorCtor = {
  new (opts?: { formats: string[] }): NativeDetector
  getSupportedFormats(): Promise<string[]>
}

const WANTED_NATIVE = ['qr_code', 'data_matrix', 'code_128', 'ean_13', 'ean_8', 'upc_a', 'code_39', 'itf', 'pdf417', 'aztec']
const ZXING_FORMATS = ['QRCode', 'DataMatrix', 'Code128', 'EAN13', 'EAN8', 'UPCA', 'Code39', 'ITF', 'DataBar', 'DataBarExp', 'PDF417', 'Aztec', 'MicroQRCode'] as const
/** Served from /public so decoding works offline and nothing is fetched from a third party. */
const ZXING_WASM_URL = '/scan/zxing_reader-3.1.4.wasm'

let nativeP: Promise<NativeDetector | null> | null = null
let zxingP: Promise<typeof import('zxing-wasm/reader')> | null = null

/** The native detector, only when it can read both QR and Data Matrix (the two codes on Indian packs). */
function native(): Promise<NativeDetector | null> {
  nativeP ??= (async () => {
    const Ctor = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector
    if (!Ctor) return null
    try {
      const supported = await Ctor.getSupportedFormats()
      if (!supported.includes('qr_code') || !supported.includes('data_matrix')) return null
      return new Ctor({ formats: WANTED_NATIVE.filter((f) => supported.includes(f)) })
    } catch {
      return null
    }
  })()
  return nativeP
}

function zxing() {
  zxingP ??= import('zxing-wasm/reader').then((m) => {
    m.prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? ZXING_WASM_URL : prefix + path) },
    })
    return m
  })
  zxingP.catch(() => (zxingP = null))
  return zxingP
}

/** Starts loading the decoders while the camera warms up, so the first frame is not slow. */
export function warmDecoders() {
  void native().then((n) => (n ? null : zxing()))
}

async function readZxing(image: ImageData | Blob, thorough: boolean): Promise<DecodedCode[]> {
  const { readBarcodes } = await zxing()
  const results = await readBarcodes(image, {
    formats: [...ZXING_FORMATS],
    tryHarder: thorough,
    tryRotate: thorough,
    tryInvert: thorough,
    maxNumberOfSymbols: 4,
    textMode: 'HRI',
  })
  return results.filter((r) => r.isValid && r.text).map((r) => ({ text: r.text, format: r.format }))
}

/** One camera frame. Fast settings: the next frame comes in a few hundred milliseconds anyway. */
export async function decodeFrame(canvas: HTMLCanvasElement): Promise<DecodedCode[]> {
  const det = await native()
  if (det) {
    const found = await det.detect(canvas)
    return found.filter((f) => f.rawValue).map((f) => ({ text: f.rawValue, format: f.format }))
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  return readZxing(ctx.getImageData(0, 0, canvas.width, canvas.height), false)
}

/** An uploaded photo: native first, then zxing with every retry on (rotated, inverted, small codes). */
export async function decodePhoto(canvas: HTMLCanvasElement, file: Blob): Promise<DecodedCode[]> {
  const det = await native()
  if (det) {
    try {
      const found = (await det.detect(canvas)).filter((f) => f.rawValue)
      if (found.length) return found.map((f) => ({ text: f.rawValue, format: f.format }))
    } catch {}
  }
  try {
    return await readZxing(file, true)
  } catch {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    return ctx ? readZxing(ctx.getImageData(0, 0, canvas.width, canvas.height), true) : []
  }
}
