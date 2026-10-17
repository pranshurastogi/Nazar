import type { PoliteHttp } from '../lib/http.ts'
import type { DiscoveredDoc, ExtractedRow, RawDoc } from '../domain/types.ts'

export interface SourceContext {
  http: PoliteHttp
  /** Only return documents newer than this YYYYMM (inclusive), when the adapter can tell. */
  sinceYm?: number
  /** Upper bound on documents per discover() call. */
  limit: number
  signal?: AbortSignal
}

/**
 * One regulator feed. Adapters only know how to find and describe documents;
 * fetching bytes, storing them and extracting rows are shared pipeline stages.
 *
 * Structured feeds (JSON APIs, curated seeds) skip PDF extraction by
 * implementing `rows()`, which turns a stored document straight into rows.
 */
export interface SourceAdapter {
  readonly id: string
  readonly authority: string
  readonly jurisdiction: string
  /** Human description for the CLI and the /v1/sources endpoint. */
  readonly description: string
  /** Home page judges and users can open to see the original listing. */
  readonly homepage: string
  /** Cron expression this source should be polled on. */
  readonly schedule: string
  discover(ctx: SourceContext): Promise<DiscoveredDoc[]>
  /** Optional structured extraction for non-PDF sources. */
  rows?(doc: RawDoc, bytes: Uint8Array): Promise<ExtractedRow[]>
}
