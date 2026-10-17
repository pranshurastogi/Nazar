import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { dataPath } from '../config/env.ts'
import { sha256 } from '../lib/hash.ts'

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/html': 'html',
  'text/plain': 'txt',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

export const extFor = (contentType: string, url = '') => {
  const base = contentType.split(';')[0]!.trim()
  return EXT[base] ?? (/\.([a-z0-9]{2,4})(?:$|\?)/i.exec(url)?.[1]?.toLowerCase() ?? 'bin')
}

/**
 * Content-addressed store: raw/sha256/<first 2 hex>/<hash>.<ext>.
 * The same bytes always land at the same path, so harvesting is idempotent and
 * every alert can be traced to the exact document it came from.
 */
export class RawStore {
  constructor(private readonly root = dataPath('raw', 'sha256')) {}

  pathFor(hash: string, ext: string) {
    return path.join(this.root, hash.slice(0, 2), `${hash}.${ext}`)
  }

  async put(bytes: Uint8Array, contentType: string, url = ''): Promise<{ sha256: string; path: string; existed: boolean }> {
    const hash = sha256(bytes)
    const file = this.pathFor(hash, extFor(contentType, url))
    try {
      await stat(file)
      return { sha256: hash, path: file, existed: true }
    } catch {}
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, bytes)
    await rename(tmp, file) // atomic on the same filesystem
    return { sha256: hash, path: file, existed: false }
  }

  async get(file: string): Promise<Uint8Array> {
    const bytes = new Uint8Array(await readFile(file))
    const expected = path.basename(file).split('.')[0]
    if (expected && /^[0-9a-f]{64}$/.test(expected) && sha256(bytes) !== expected) {
      throw new Error(`raw store corruption: ${file} does not match its hash`)
    }
    return bytes
  }
}
