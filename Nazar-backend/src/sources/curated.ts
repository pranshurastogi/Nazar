import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { z } from 'zod'

import { parseYm } from '../domain/dates.ts'
import { matchKey } from '../domain/batch.ts'
import { Jurisdiction, type DiscoveredDoc, type ExtractedRow } from '../domain/types.ts'
import { ConfigError, ExtractionError } from '../lib/errors.ts'
import { stableId } from '../lib/hash.ts'
import { decodeText } from '../lib/http.ts'
import { docBase, newestFirst, type ManagedSource } from './common.ts'

export const CURATED_PARSER = 'curated@1'
export const CURATED_DIR = fileURLToPath(new URL('./curated/', import.meta.url))

/**
 * A reviewed seed: rows a person copied from an official notice and checked, for cases too
 * important to wait for a parser (or published only as images or press notes).
 */
export const CuratedSeed = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  authority: z.string().min(1),
  jurisdiction: Jurisdiction,
  url: z.url(),
  publishedAt: z.string().nullable(),
  noticeYm: z.number().int(),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string(),
  sources: z.array(z.object({ label: z.string(), url: z.url() })).min(1),
  notes: z.string().optional(),
  rows: z
    .array(
      z.object({
        product: z.string().min(1),
        batch: z.string().min(1),
        mfg: z.string().nullable(),
        exp: z.string().nullable(),
        manufacturer: z.string().nullable(),
        reason: z.string().min(1),
        reportedBy: z.string().nullable(),
        note: z.string().optional(),
        /** Set only when the cited source says the product was used by children (drives Child Shield). */
        paediatricUse: z.boolean().optional(),
      }),
    )
    .min(1),
})
export type CuratedSeed = z.infer<typeof CuratedSeed>

const SEED_FILE = /^[a-z0-9-]+\.json$/

/** Seeds are read from the repo, never from a URL: the stored bytes are the reviewed file itself. */
export async function loadSeedBytes(file: string): Promise<Uint8Array> {
  if (!SEED_FILE.test(file)) throw new ConfigError(`invalid curated seed name: ${file}`)
  return new Uint8Array(await readFile(path.join(CURATED_DIR, file)))
}

export function parseSeed(bytes: Uint8Array): CuratedSeed {
  try {
    return CuratedSeed.parse(JSON.parse(decodeText(bytes)))
  } catch (err) {
    throw new ExtractionError('curated seed is not valid', {}, { cause: err })
  }
}

export function curatedRows(seed: CuratedSeed, sourceSha: string): ExtractedRow[] {
  return seed.rows.map((r, i) => ({
    rid: stableId(sourceSha, i + 1, CURATED_PARSER),
    sourceSha,
    rowNo: i + 1,
    page: null,
    product: r.product,
    batch: r.batch,
    mfgYm: parseYm(r.mfg),
    expYm: parseYm(r.exp),
    manufacturer: r.manufacturer,
    reason: r.reason,
    reportedBy: r.reportedBy,
    method: 'curated',
    parser: CURATED_PARSER,
    confidence: 1,
    issues: [],
    rawText: [r.product, r.batch, r.mfg, r.exp, r.manufacturer, r.reason, r.note].filter(Boolean).join(' | '),
  }))
}

export const curated: ManagedSource = {
  id: 'curated',
  authority: 'Nazar curators',
  jurisdiction: 'IN',
  description: 'Reviewed seed rows copied from official notices (WHO, CDSCO, state regulators) for high-severity cases, each with its source links.',
  homepage: 'https://www.who.int/news/item/13-10-2025-medical-product-alert-n5-2025',
  schedule: '0 5 * * *',

  async discover(ctx) {
    const files = (await readdir(CURATED_DIR)).filter((f) => SEED_FILE.test(f)).sort()
    const docs: DiscoveredDoc[] = []
    for (const file of files) {
      const seed = parseSeed(await loadSeedBytes(file))
      docs.push({
        ...docBase(curated),
        authority: seed.authority,
        jurisdiction: seed.jurisdiction,
        url: seed.url,
        title: seed.title,
        publishedAt: seed.publishedAt,
        noticeYm: seed.noticeYm,
        kind: 'html',
        // Local and cheap to re-read; harvest dedupes by content, so an edited seed becomes a new document.
        hints: {
          format: 'curated-json',
          seed: file,
          refresh: 'always',
          pedsBatches: seed.rows.filter((r) => r.paediatricUse).map((r) => matchKey(r.batch)).join(','),
        },
      })
    }
    return newestFirst(docs, ctx)
  },

  async rows(doc, bytes) {
    return curatedRows(parseSeed(bytes), doc.sha256)
  },
}
