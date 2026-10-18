import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { dataPath } from '../config/env.ts'
import type { AlertRecord, ExtractedRow, NoticeRecord, RawDoc } from '../domain/types.ts'
import { migrateResolved } from '../resolve/reresolve.ts'

/**
 * Local ledger (SQLite, Node's built-in driver). It is a cache and a work queue,
 * never the source of truth: everything published can be rebuilt from Arkiv.
 * It records what was harvested, what each stage produced, what was published
 * (entity keys + tx hashes, for reconciliation on timeouts) and every run.
 */
export type DocStatus = 'harvested' | 'extracted' | 'resolved' | 'published' | 'failed' | 'skipped'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS documents (
  sha TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  title TEXT NOT NULL,
  authority TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  published_at TEXT,
  notice_ym INTEGER,
  kind TEXT NOT NULL,
  hints TEXT NOT NULL DEFAULT '{}',
  path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'harvested',
  method TEXT,
  parser TEXT,
  row_count INTEGER,
  rejected_count INTEGER,
  error TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS documents_status ON documents(status);
CREATE TABLE IF NOT EXISTS seen_urls (
  url TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  sha TEXT,
  first_seen TEXT NOT NULL,
  last_checked TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rows (
  rid TEXT PRIMARY KEY,
  source_sha TEXT NOT NULL REFERENCES documents(sha) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  method TEXT NOT NULL,
  confidence REAL NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rows_source ON rows(source_sha);
CREATE TABLE IF NOT EXISTS alerts (
  rid TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  batch_key TEXT NOT NULL,
  confusion_key TEXT NOT NULL,
  batch TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  severity INTEGER NOT NULL,
  peds INTEGER NOT NULL,
  state TEXT,
  alert_ym INTEGER NOT NULL,
  exp_ym INTEGER,
  tier TEXT NOT NULL,
  source_id TEXT NOT NULL,
  notice_sha TEXT NOT NULL,
  data TEXT NOT NULL,
  entity_key TEXT,
  tx_hash TEXT,
  published_at TEXT,
  retracted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS alerts_batch ON alerts(batch_key);
CREATE INDEX IF NOT EXISTS alerts_confusion ON alerts(confusion_key);
CREATE INDEX IF NOT EXISTS alerts_ym ON alerts(alert_ym);
CREATE INDEX IF NOT EXISTS alerts_unpublished ON alerts(entity_key) WHERE entity_key IS NULL;
CREATE VIRTUAL TABLE IF NOT EXISTS alerts_fts USING fts5(rid UNINDEXED, batch, brand, product, manufacturer, reason, tokenize = 'unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS notices (
  sha TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  entity_key TEXT,
  tx_hash TEXT,
  published_at TEXT
);
CREATE TABLE IF NOT EXISTS publish_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT,
  entity_keys TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  stats TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

const now = () => new Date().toISOString()

export interface AlertRow {
  rid: string
  record: AlertRecord
  entityKey: string | null
  txHash: string | null
  publishedAt: string | null
  retracted: boolean
}

export class Ledger {
  readonly db: DatabaseSync

  constructor(file = dataPath('nazar.sqlite')) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(SCHEMA)
    this.addColumns()
  }

  /**
   * Columns added after the first deploys. Existing rows get the defaults (dated, medicine) until
   * reresolveLedger() recomputes them from the stored rows; see src/resolve/reresolve.ts.
   */
  private addColumns() {
    const have = new Set((this.db.prepare('PRAGMA table_info(alerts)').all() as { name: string }[]).map((c) => c.name))
    if (!have.has('date_known')) this.db.exec('ALTER TABLE alerts ADD COLUMN date_known INTEGER NOT NULL DEFAULT 1')
    if (!have.has('product_class')) this.db.exec("ALTER TABLE alerts ADD COLUMN product_class TEXT NOT NULL DEFAULT 'medicine'")
  }

  close() {
    this.db.close()
  }

  /** Runs fn in one write transaction; nested calls join the outer one. */
  tx<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // ---- seen URLs (so discovery does not refetch unchanged documents)
  hasSeenUrl(url: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM seen_urls WHERE url = ? AND sha IS NOT NULL').get(url)
  }

  markUrl(url: string, sourceId: string, sha: string | null) {
    this.db
      .prepare(
        `INSERT INTO seen_urls (url, source_id, sha, first_seen, last_checked) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET sha = COALESCE(excluded.sha, seen_urls.sha), last_checked = excluded.last_checked`,
      )
      .run(url, sourceId, sha, now(), now())
  }

  // ---- documents
  upsertDocument(doc: RawDoc) {
    this.db
      .prepare(
        `INSERT INTO documents (sha, source_id, url, final_url, title, authority, jurisdiction, published_at, notice_ym, kind, hints, path, content_type, size, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sha) DO UPDATE SET title = excluded.title, notice_ym = COALESCE(excluded.notice_ym, documents.notice_ym),
           published_at = COALESCE(excluded.published_at, documents.published_at), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .run(
        doc.sha256, doc.sourceId, doc.url, doc.finalUrl, doc.title, doc.authority, doc.jurisdiction, doc.publishedAt,
        doc.noticeYm, doc.kind, JSON.stringify(doc.hints), doc.path, doc.contentType, doc.size, doc.fetchedAt,
      )
  }

  getDocument(sha: string): (RawDoc & { status: DocStatus; error: string | null }) | undefined {
    const r = this.db.prepare('SELECT * FROM documents WHERE sha = ?').get(sha) as Record<string, unknown> | undefined
    return r ? toRawDoc(r) : undefined
  }

  documentsByStatus(status: DocStatus, limit = 100) {
    return (this.db.prepare('SELECT * FROM documents WHERE status = ? ORDER BY fetched_at LIMIT ?').all(status, limit) as Record<string, unknown>[]).map(toRawDoc)
  }

  listDocuments(limit = 50) {
    return (this.db.prepare('SELECT * FROM documents ORDER BY COALESCE(notice_ym, 0) DESC, fetched_at DESC LIMIT ?').all(limit) as Record<string, unknown>[]).map(toRawDoc)
  }

  setDocumentStatus(sha: string, status: DocStatus, extra: { method?: string; parser?: string; rows?: number; rejected?: number; error?: string | null } = {}) {
    this.db
      .prepare(
        `UPDATE documents SET status = ?, method = COALESCE(?, method), parser = COALESCE(?, parser), row_count = COALESCE(?, row_count),
           rejected_count = COALESCE(?, rejected_count), error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE sha = ?`,
      )
      .run(status, extra.method ?? null, extra.parser ?? null, extra.rows ?? null, extra.rejected ?? null, extra.error ?? null, sha)
  }

  // ---- extracted rows
  replaceRows(sourceSha: string, rows: ExtractedRow[]) {
    this.tx(() => {
      this.db.prepare('DELETE FROM rows WHERE source_sha = ?').run(sourceSha)
      const ins = this.db.prepare('INSERT OR REPLACE INTO rows (rid, source_sha, row_no, method, confidence, data) VALUES (?, ?, ?, ?, ?, ?)')
      for (const r of rows) ins.run(r.rid, sourceSha, r.rowNo, r.method, r.confidence, JSON.stringify(r))
    })
  }

  rowsFor(sourceSha: string): ExtractedRow[] {
    return (this.db.prepare('SELECT data FROM rows WHERE source_sha = ? ORDER BY row_no').all(sourceSha) as { data: string }[]).map((r) => JSON.parse(r.data))
  }

  // ---- alerts
  upsertAlerts(records: AlertRecord[], confusionKey: (b: string) => string) {
    this.tx(() => {
      const ins = this.db.prepare(
        `INSERT INTO alerts (rid, case_id, batch_key, confusion_key, batch, brand, category, severity, peds, state, alert_ym, exp_ym, tier, source_id, notice_sha, data, date_known, product_class)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(rid) DO UPDATE SET case_id = excluded.case_id, severity = excluded.severity, tier = excluded.tier,
           -- pages refreshed in place (e.g. Maharashtra) re-list old rows: keep the month we first saw the alert
           data = json_set(excluded.data, '$.alertYm', alerts.alert_ym),
           brand = excluded.brand, category = excluded.category, peds = excluded.peds, state = excluded.state, exp_ym = excluded.exp_ym,
           date_known = excluded.date_known, product_class = excluded.product_class`,
      )
      const delFts = this.db.prepare('DELETE FROM alerts_fts WHERE rid = ?')
      const insFts = this.db.prepare('INSERT INTO alerts_fts (rid, batch, brand, product, manufacturer, reason) VALUES (?, ?, ?, ?, ?, ?)')
      for (const a of records) {
        ins.run(
          a.rid, a.caseId, a.batchKey, confusionKey(a.batch), a.batch, a.brand, a.category, a.severity, a.peds ? 1 : 0, a.state,
          a.alertYm, a.expYm, a.tier, a.sourceId, a.noticeSha, JSON.stringify(a), a.dateKnown === false ? 0 : 1, a.productClass ?? 'medicine',
        )
        delFts.run(a.rid)
        insFts.run(a.rid, a.batch, a.brand, a.product, a.manufacturer ?? '', a.reason)
      }
    })
  }

  alertsByBatchKey(batchKey: string): AlertRow[] {
    return this.alertRows('SELECT * FROM alerts WHERE batch_key = ? ORDER BY alert_ym DESC', [batchKey])
  }

  alertsByConfusionKey(key: string, limit = 5): AlertRow[] {
    return this.alertRows('SELECT * FROM alerts WHERE confusion_key = ? ORDER BY alert_ym DESC LIMIT ?', [key, limit])
  }

  recentAlerts(o: { limit?: number; state?: string; minSeverity?: number; peds?: boolean; sinceYm?: number; offset?: number } = {}): AlertRow[] {
    const where = ['retracted = 0']
    const args: SQLInputValue[] = []
    if (o.state) (where.push('state = ?'), args.push(o.state))
    if (o.minSeverity) (where.push('severity >= ?'), args.push(o.minSeverity))
    if (o.peds !== undefined) (where.push('peds = ?'), args.push(o.peds ? 1 : 0))
    if (o.sinceYm) (where.push('alert_ym >= ?'), args.push(o.sinceYm))
    args.push(o.limit ?? 50, o.offset ?? 0)
    return this.alertRows(`SELECT * FROM alerts WHERE ${where.join(' AND ')} ORDER BY ${FEED_ORDER} LIMIT ? OFFSET ?`, args)
  }

  searchAlerts(q: string, limit = 25): AlertRow[] {
    const terms = q.replace(/["*^():]/g, ' ').trim().split(/\s+/).filter(Boolean).map((t) => `"${t}"*`).join(' ')
    if (!terms) return []
    return this.alertRows(
      'SELECT a.* FROM alerts_fts f JOIN alerts a ON a.rid = f.rid WHERE alerts_fts MATCH ? ORDER BY rank LIMIT ?',
      [terms, limit],
    )
  }

  alertsByCase(caseId: string): AlertRow[] {
    return this.alertRows('SELECT * FROM alerts WHERE case_id = ? ORDER BY alert_ym', [caseId])
  }

  unpublishedAlerts(noticeSha: string): AlertRow[] {
    return this.alertRows("SELECT * FROM alerts WHERE notice_sha = ? AND entity_key IS NULL AND tier IN ('auto', 'machine_read') ORDER BY rid", [noticeSha])
  }

  markAlertPublished(rid: string, entityKey: string, txHash: string) {
    this.db.prepare('UPDATE alerts SET entity_key = ?, tx_hash = ?, published_at = ? WHERE rid = ?').run(entityKey, txHash, now(), rid)
  }

  markRetracted(rid: string) {
    this.db.prepare('UPDATE alerts SET retracted = 1 WHERE rid = ?').run(rid)
  }

  /**
   * Hides a repeat listing that resolve folded into another alert of the same notice. It drops to the
   * curator tier, which every read path, the snapshot and the publisher already leave out. This is
   * Nazar's own de-duplication, not a regulator retraction, so nothing is written on chain. Returns
   * whether a row changed (an unknown rid, or the kept rid itself, is a no-op).
   */
  markSuperseded(rid: string, into: string): boolean {
    if (rid === into) return false
    const r = this.db
      .prepare(
        `UPDATE alerts SET tier = 'curator_only', data = json_set(data, '$.tier', 'curator_only', '$.supersededBy', ?)
         WHERE rid = ? AND (tier != 'curator_only' OR json_extract(data, '$.supersededBy') IS NOT ?)`,
      )
      .run(into, rid, into)
    return Number(r.changes) > 0
  }

  stats() {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n
    return {
      documents: one('SELECT COUNT(*) n FROM documents'),
      alerts: one('SELECT COUNT(*) n FROM alerts'),
      published: one('SELECT COUNT(*) n FROM alerts WHERE entity_key IS NOT NULL'),
      pending: one("SELECT COUNT(*) n FROM alerts WHERE entity_key IS NULL AND tier IN ('auto', 'machine_read')"),
      drugLevel: one("SELECT COUNT(*) n FROM alerts WHERE tier = 'drug_level'"),
      curatorQueue: one("SELECT COUNT(*) n FROM alerts WHERE tier = 'curator_only'"),
      failedDocuments: one("SELECT COUNT(*) n FROM documents WHERE status = 'failed'"),
    }
  }

  // ---- notices
  upsertNotice(n: NoticeRecord) {
    this.db.prepare('INSERT INTO notices (sha, data) VALUES (?, ?) ON CONFLICT(sha) DO UPDATE SET data = excluded.data').run(n.sha, JSON.stringify(n))
  }

  getNotice(sha: string): { record: NoticeRecord; entityKey: string | null; txHash: string | null } | undefined {
    const r = this.db.prepare('SELECT * FROM notices WHERE sha = ?').get(sha) as { data: string; entity_key: string | null; tx_hash: string | null } | undefined
    return r ? { record: JSON.parse(r.data), entityKey: r.entity_key, txHash: r.tx_hash } : undefined
  }

  markNoticePublished(sha: string, entityKey: string, txHash: string) {
    this.db.prepare('UPDATE notices SET entity_key = ?, tx_hash = ?, published_at = ? WHERE sha = ?').run(entityKey, txHash, now(), sha)
  }

  // ---- publish log, runs, kv
  logPublish(e: { kind: string; ref: string; status: 'sent' | 'confirmed' | 'failed' | 'dry-run'; txHash?: string; entityKeys?: string[]; error?: string }) {
    this.db
      .prepare('INSERT INTO publish_log (kind, ref, status, tx_hash, entity_keys, error) VALUES (?, ?, ?, ?, ?, ?)')
      .run(e.kind, e.ref, e.status, e.txHash ?? null, e.entityKeys ? JSON.stringify(e.entityKeys) : null, e.error ?? null)
  }

  recentPublishes(limit = 20) {
    return this.db.prepare('SELECT * FROM publish_log ORDER BY id DESC LIMIT ?').all(limit)
  }

  startRun(job: string): number {
    return Number(this.db.prepare('INSERT INTO runs (job, started_at) VALUES (?, ?)').run(job, now()).lastInsertRowid)
  }

  finishRun(id: number, ok: boolean, stats: unknown, error?: string) {
    this.db.prepare('UPDATE runs SET finished_at = ?, ok = ?, stats = ?, error = ? WHERE id = ?').run(now(), ok ? 1 : 0, JSON.stringify(stats), error ?? null, id)
  }

  recentRuns(limit = 20) {
    return (this.db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[]).map((r) => ({
      ...r,
      stats: r.stats ? JSON.parse(String(r.stats)) : null,
      ok: r.ok === null ? null : r.ok === 1,
    }))
  }

  getKv(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value
  }

  setKv(key: string, value: string) {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  private alertRows(sql: string, args: SQLInputValue[]): AlertRow[] {
    return (this.db.prepare(sql).all(...args) as Record<string, unknown>[]).map((r) => ({
      rid: String(r.rid),
      record: JSON.parse(String(r.data)) as AlertRecord,
      entityKey: (r.entity_key as string | null) ?? null,
      txHash: (r.tx_hash as string | null) ?? null,
      publishedAt: (r.published_at as string | null) ?? null,
      retracted: r.retracted === 1,
    }))
  }
}

function toRawDoc(r: Record<string, unknown>): RawDoc & { status: DocStatus; error: string | null } {
  return {
    sha256: String(r.sha),
    sourceId: String(r.source_id),
    url: String(r.url),
    finalUrl: String(r.final_url),
    title: String(r.title),
    authority: String(r.authority),
    jurisdiction: String(r.jurisdiction),
    publishedAt: (r.published_at as string | null) ?? null,
    noticeYm: (r.notice_ym as number | null) ?? null,
    kind: r.kind as RawDoc['kind'],
    hints: JSON.parse(String(r.hints ?? '{}')),
    path: String(r.path),
    contentType: String(r.content_type),
    size: Number(r.size),
    fetchedAt: String(r.fetched_at),
    status: r.status as DocStatus,
    error: (r.error as string | null) ?? null,
  }
}

/**
 * Feed order: alerts with a regulator date first (newest month first), then undated ones (Maharashtra's
 * running table, by the month first seen); within a month medicines before cosmetics and hygiene
 * products, then the most severe.
 */
export const FEED_ORDER = "date_known DESC, alert_ym DESC, (product_class = 'medicine') DESC, severity DESC, rid"

let shared: Ledger | undefined
/**
 * The process-wide ledger. Opening it brings stored alerts up to the current resolve rules once per
 * RESOLVE_VERSION (idempotent; see src/resolve/reresolve.ts), so a deploy needs no manual step.
 */
export const ledger = () => {
  if (!shared) {
    shared = new Ledger()
    migrateResolved(shared)
  }
  return shared
}
