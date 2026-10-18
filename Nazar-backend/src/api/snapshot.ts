import { promisify } from 'node:util'
import { brotliCompress, constants as zlib, gzip } from 'node:zlib'

import type { Context } from 'hono'

import { sha256 } from '../lib/hash.ts'
import { child } from '../lib/logger.ts'
import type { AlertRecord } from '../domain/types.ts'
import { classifyProduct, type ProductClass } from '../domain/vocab.ts'
import type { Ledger } from '../storage/ledger.ts'

const log = child('snapshot')
const br = promisify(brotliCompress)
const gz = promisify(gzip)

/**
 * The whole publishable alert set in one small, cacheable file, so the web app can answer a
 * check on the device (instantly, and offline) and confirm with the live API afterwards.
 *
 * Shape (v1), arrays instead of objects to keep it small:
 *   notices: [authority, title, url, date|null, sourceId][]   – shared by many alerts
 *   alerts:  { [batchKey]: Row[] }                              – exact-match index
 *   Row = [batch|null (same as the key), notice#, brand, product|null (same as brand),
 *          generic|null (same as product), form, category, failure, reason, severity, peds 0|1,
 *          manufacturer|null, labelClaim 0|1, state|null, mfgYm|null, expYm|null, alertYm,
 *          machineRead 0|1, onArkiv 0|1, retracted 0|1, dateKnown 0|1, productClass]
 * The last two were appended later (still v1): readers that predate them see the first 20 fields
 * unchanged. dateKnown 0 means the regulator gave no date and alertYm is the month Nazar first saw
 * the row; productClass is 'medicine', 'cosmetic' or 'hygiene'.
 * Entity keys and row ids are left out on purpose: they are random hex (~50 incompressible bytes
 * per alert, more than everything else combined). The verdict needs none of it; the live check
 * that follows brings the proof. The "did you mean" index is derived on the device with the same
 * confusionKey() the API uses, so it costs nothing on the wire. `version` hashes the content.
 */

export const SNAPSHOT_FORMAT = 1
export const SNAPSHOT_CACHE = 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400'

export type SnapshotRow = [
  string | null, number, string, string | null, string | null,
  string, string, string, string, number, 0 | 1, string | null,
  0 | 1, string | null, number | null, number | null, number, 0 | 1,
  0 | 1, 0 | 1, 0 | 1, ProductClass,
]

export interface Snapshot {
  v: typeof SNAPSHOT_FORMAT
  version: string
  generatedAt: string
  count: number
  notices: [string, string, string, string | null, string][]
  alerts: Record<string, SnapshotRow[]>
}

/**
 * Cheap change check over the alerts table (well under a millisecond for a few thousand rows):
 * any insert, publish, retraction, tier or severity change moves it. Works across processes,
 * so an API-only container notices what a separate worker wrote to the shared ledger.
 */
export function ledgerFingerprint(ledger: Ledger): string {
  const r = ledger.db
    .prepare(
      `SELECT COUNT(*) n, TOTAL(retracted) r, COUNT(entity_key) p, TOTAL(severity) s, TOTAL(peds) k,
              TOTAL(length(data)) d, SUM(tier IN ('auto','machine_read')) t, MAX(published_at) m, MAX(rowid) i
       FROM alerts`,
    )
    .get() as Record<string, unknown>
  return Object.values(r).join(':')
}

const PUBLISHABLE = "tier IN ('auto','machine_read')"

export function buildSnapshot(ledger: Ledger, now = new Date()): Snapshot {
  const rows = ledger.db
    .prepare(`SELECT data, entity_key, retracted FROM alerts WHERE ${PUBLISHABLE} ORDER BY batch_key, alert_ym DESC, rid`)
    .all() as { data: string; entity_key: string | null; retracted: number }[]

  const notices: Snapshot['notices'] = []
  const noticeIdx = new Map<string, number>()
  const alerts: Snapshot['alerts'] = {}
  for (const r of rows) {
    const a = JSON.parse(r.data) as AlertRecord
    const nKey = `${a.noticeSha}|${a.noticeUrl}`
    let n = noticeIdx.get(nKey)
    if (n === undefined) {
      n = notices.push([a.authority, a.noticeTitle, a.noticeUrl, a.noticeDate ?? null, a.sourceId]) - 1
      noticeIdx.set(nKey, n)
    }
    const product = a.product && a.product !== a.brand ? a.product : null
    const generic = a.generic && a.generic !== (a.product || a.brand) ? a.generic : null
    const row: SnapshotRow = [
      a.batch.toLowerCase() === a.batchKey ? null : a.batch, n, a.brand, product, generic,
      a.form, a.category, a.failures[0] ?? 'other', a.reason, a.severity, a.peds ? 1 : 0, a.manufacturer ?? null,
      a.manufacturerRole === 'label_claim' ? 1 : 0, a.state ?? null, a.mfgYm ?? null, a.expYm ?? null, a.alertYm, a.tier === 'machine_read' ? 1 : 0,
      r.entity_key ? 1 : 0, r.retracted === 1 ? 1 : 0, a.dateKnown === false ? 0 : 1, a.productClass ?? classifyProduct(a.product, a.manufacturer),
    ]
    ;(alerts[a.batchKey] ??= []).push(row)
  }
  const version = sha256(JSON.stringify([SNAPSHOT_FORMAT, notices, alerts])).slice(0, 16)
  return { v: SNAPSHOT_FORMAT, version, generatedAt: now.toISOString(), count: rows.length, notices, alerts }
}

export interface BuiltSnapshot {
  version: string
  fingerprint: string
  count: number
  identity: Buffer
  gzip: Buffer
  brotli: Buffer
  builtAt: number
}

/**
 * Keeps one built, pre-compressed snapshot in memory and rebuilds it only when the ledger
 * fingerprint moves (checked at most every `checkMs`). Concurrent requests share one build.
 */
export class SnapshotService {
  private built: BuiltSnapshot | null = null
  private building: Promise<BuiltSnapshot> | null = null
  private checkedAt = 0

  constructor(
    private readonly ledger: Ledger,
    private readonly o: { checkMs?: number; now?: () => number } = {},
  ) {}

  private now = () => (this.o.now ?? Date.now)()

  async get(): Promise<BuiltSnapshot> {
    const t = this.now()
    if (this.built && t - this.checkedAt < (this.o.checkMs ?? 5000)) return this.built
    this.checkedAt = t
    const fp = ledgerFingerprint(this.ledger)
    if (this.built && this.built.fingerprint === fp) return this.built
    this.building ??= this.build(fp).finally(() => (this.building = null))
    return this.building
  }

  private async build(fingerprint: string): Promise<BuiltSnapshot> {
    const t0 = performance.now()
    const snap = buildSnapshot(this.ledger, new Date(this.now()))
    // Same content, same bytes: keep the old buffers so caches and ETags stay valid.
    if (this.built?.version === snap.version) return (this.built = { ...this.built, fingerprint })
    const identity = Buffer.from(JSON.stringify(snap))
    const [brotli, gzipped] = await Promise.all([
      br(identity, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_MODE]: zlib.BROTLI_MODE_TEXT, [zlib.BROTLI_PARAM_SIZE_HINT]: identity.length } }),
      gz(identity, { level: 9 }),
    ])
    this.built = { version: snap.version, fingerprint, count: snap.count, identity, gzip: gzipped, brotli, builtAt: this.now() }
    log.info({ version: snap.version, alerts: snap.count, bytes: identity.length, br: brotli.length, gzip: gzipped.length, ms: Math.round(performance.now() - t0) }, 'snapshot built')
    return this.built
  }
}

/** Picks the best encoding the client accepts; brotli first, it is ~15% smaller here. */
export function pickEncoding(accept: string | undefined): 'br' | 'gzip' | 'identity' {
  const q = new Map(
    (accept ?? '').toLowerCase().split(',').map((part) => {
      const [name = '', ...params] = part.split(';').map((x) => x.trim())
      const qv = params.find((p) => p.startsWith('q='))
      return [name, qv ? Number(qv.slice(2)) : 1] as const
    }),
  )
  const ok = (enc: string) => (q.get(enc) ?? q.get('*') ?? 0) > 0
  if (ok('br')) return 'br'
  if (ok('gzip')) return 'gzip'
  return 'identity'
}

/** Serves the pre-compressed bytes with a strong ETag per encoding (the etag middleware answers 304s). */
export async function serveSnapshot(c: Context, service: SnapshotService) {
  const s = await service.get()
  const enc = pickEncoding(c.req.header('Accept-Encoding'))
  const body = enc === 'br' ? s.brotli : enc === 'gzip' ? s.gzip : s.identity
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': SNAPSHOT_CACHE,
    'CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400',
    ETag: `"${s.version}${enc === 'identity' ? '' : `-${enc}`}"`,
    Vary: 'Accept-Encoding',
    'X-Nazar-Snapshot': s.version,
    'Content-Length': String(body.length),
  }
  if (enc !== 'identity') headers['Content-Encoding'] = enc
  // Hono answers HEAD from this GET handler and drops the body itself.
  return c.body(new Uint8Array(body), 200, headers)
}
