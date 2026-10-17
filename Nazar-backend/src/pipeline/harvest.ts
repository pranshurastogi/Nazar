import { RawDoc, type DiscoveredDoc } from '../domain/types.ts'
import { PermanentError, errorMessage } from '../lib/errors.ts'
import { decodeText, type FetchResult, type PoliteHttp } from '../lib/http.ts'
import { child } from '../lib/logger.ts'
import { politeOptions } from '../sources/common.ts'
import { loadSeedBytes } from '../sources/curated.ts'
import type { Ledger } from '../storage/ledger.ts'
import type { RawStore } from '../storage/raw-store.ts'

const log = child('harvest')

export interface HarvestDeps {
  http: PoliteHttp
  store: RawStore
  ledger: Ledger
}

export interface Harvested {
  raw: RawDoc
  bytes: Uint8Array
  /** False when these exact bytes were already stored (e.g. a refreshed page that did not change). */
  isNew: boolean
}

const isJsonDoc = (doc: DiscoveredDoc) => doc.hints.format === 'cdsco-json' || doc.hints.format === 'curated-json'

function acceptFor(doc: DiscoveredDoc): string {
  if (isJsonDoc(doc)) return 'application/json, text/javascript, */*; q=0.01'
  if (doc.kind === 'pdf') return 'application/pdf,*/*;q=0.8'
  if (doc.kind === 'image') return 'image/*,*/*;q=0.8'
  return 'text/html,application/xhtml+xml'
}

const PDF_MAGIC = '%PDF-'

function startsLikePdf(bytes: Uint8Array): boolean {
  // The spec allows junk before the header within the first 1024 bytes; some government PDFs have a BOM or blank line.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  return head.includes(PDF_MAGIC)
}

/**
 * Checks the bytes are what the adapter promised and returns the content type to store them under.
 * Government sites answer missing files with "200 OK" HTML error pages, so the status alone proves nothing.
 */
export function validateContent(doc: DiscoveredDoc, bytes: Uint8Array, contentType: string): string {
  if (!bytes.byteLength) throw new PermanentError('empty response', { url: doc.url })
  if (isJsonDoc(doc)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(decodeText(bytes, contentType))
    } catch {
      throw new PermanentError(`expected JSON, got ${contentType || 'unknown content'}`, { url: doc.url })
    }
    if (doc.hints.format === 'cdsco-json' && !Array.isArray((parsed as { aaData?: unknown } | null)?.aaData)) {
      throw new PermanentError('cdscoonline response has no aaData table', { url: doc.url })
    }
    return 'application/json'
  }
  if (doc.kind === 'pdf') {
    if (!startsLikePdf(bytes)) throw new PermanentError(`expected a PDF, got ${contentType || 'unknown content'}`, { url: doc.url })
    return 'application/pdf'
  }
  if (doc.kind === 'image') {
    if (!contentType.startsWith('image/')) throw new PermanentError(`expected an image, got ${contentType}`, { url: doc.url })
    return contentType.split(';')[0]!.trim()
  }
  if (startsLikePdf(bytes) || /^(application\/pdf|image\/)/.test(contentType)) {
    throw new PermanentError(`expected HTML, got ${contentType || 'binary content'}`, { url: doc.url })
  }
  if (contentType && !contentType.includes('html')) return contentType
  const charset = /charset=[^;]+/i.exec(contentType)?.[0]
  return charset ? `text/html; ${charset}` : 'text/html'
}

async function fetchDoc(doc: DiscoveredDoc, http: PoliteHttp): Promise<FetchResult> {
  if (doc.hints.format === 'curated-json') {
    const bytes = await loadSeedBytes(doc.hints.seed ?? '')
    return { url: doc.url, finalUrl: doc.url, status: 200, contentType: 'application/json', bytes, headers: {}, fetchedAt: new Date().toISOString() }
  }
  return http.get(doc.url, politeOptions(doc.url, acceptFor(doc)))
}

/**
 * Fetches one discovered document, stores it content-addressed and records it in the ledger.
 *
 * Returns null when skipped: the URL was already harvested (unless the source marks it
 * `refresh: 'always'`, for pages that change in place) or the server's answer can never succeed
 * (404, wrong content). Transient failures propagate so the run can retry later.
 */
export async function harvest(doc: DiscoveredDoc, deps: HarvestDeps): Promise<Harvested | null> {
  const refresh = doc.hints.refresh === 'always'
  if (!refresh && deps.ledger.hasSeenUrl(doc.url)) {
    log.debug({ url: doc.url }, 'already harvested')
    return null
  }

  let fetched: FetchResult
  let contentType: string
  try {
    fetched = await fetchDoc(doc, deps.http)
    contentType = validateContent(doc, fetched.bytes, fetched.contentType)
  } catch (err) {
    if (!(err instanceof PermanentError)) throw err
    log.warn({ url: doc.url, source: doc.sourceId, err: errorMessage(err) }, 'harvest rejected')
    deps.ledger.markUrl(doc.url, doc.sourceId, null)
    return null
  }

  const put = await deps.store.put(fetched.bytes, contentType, fetched.finalUrl)
  const isNew = !deps.ledger.getDocument(put.sha256)
  const raw = RawDoc.parse({
    ...doc,
    sha256: put.sha256,
    path: put.path,
    contentType,
    size: fetched.bytes.byteLength,
    fetchedAt: fetched.fetchedAt,
    finalUrl: fetched.finalUrl,
  })
  deps.ledger.tx(() => {
    deps.ledger.upsertDocument(raw)
    deps.ledger.markUrl(doc.url, doc.sourceId, put.sha256)
  })
  log.info({ url: doc.url, sha: put.sha256.slice(0, 12), bytes: raw.size, isNew }, isNew ? 'harvested' : 'unchanged')
  return { raw, bytes: fetched.bytes, isNew }
}
