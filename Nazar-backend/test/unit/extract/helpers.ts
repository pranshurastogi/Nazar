import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { RawDoc } from '../../../src/domain/types.ts'
import { sha256 } from '../../../src/lib/hash.ts'

export const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures/pdf')

export function fixture(name: string): { doc: RawDoc; bytes: Uint8Array } {
  const bytes = new Uint8Array(readFileSync(path.join(FIXTURES, name)))
  const sha = sha256(bytes)
  const url = `https://example.org/${name}`
  return {
    bytes,
    doc: {
      sourceId: 'test',
      url,
      title: name,
      authority: 'Test',
      jurisdiction: 'IN',
      publishedAt: null,
      noticeYm: null,
      kind: 'pdf',
      hints: {},
      sha256: sha,
      path: name,
      contentType: 'application/pdf',
      size: bytes.byteLength,
      fetchedAt: '2026-10-17T00:00:00.000Z',
      finalUrl: url,
    },
  }
}
