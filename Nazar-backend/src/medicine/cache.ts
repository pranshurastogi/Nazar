import type { DatabaseSync } from 'node:sqlite'

import { sha256 } from '../lib/hash.ts'
import type { ExplainInput, MedicineInfo } from './schema.ts'

/**
 * Answers keyed by what was asked (composition + form + product), never by who asked. Stored in the
 * ledger's SQLite file so a repeat lookup costs nothing, for 30 days.
 */

export const CACHE_TTL_MS = 30 * 86_400_000

const norm = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/\b(?:i\.?p|b\.?p|u\.?s\.?p|ph\.?\s?eur)\b\.?/g, ' ')
    .replace(/[^a-z0-9%./+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Same medicine, same key: case, spacing, pharmacopoeia suffixes and ingredient order do not matter. */
export function cacheKey(input: ExplainInput): string {
  const composition = [...new Set((input.composition ?? []).map(norm).filter(Boolean))].sort()
  return sha256(JSON.stringify({ c: composition, f: norm(input.form), p: norm(input.product || input.brand) }))
}

/** Same label text, same key: case, spacing and Unicode width do not matter. The text itself is never stored. */
export function identifyCacheKey(text: string): string {
  return sha256(`identify␟${text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()}`)
}

/** One table per answer kind: medicine_cache (explainer cards), medicine_identify_cache (pack identification). */
export class MedicineCache<T = MedicineInfo> {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ttlMs = CACHE_TTL_MS,
    private readonly table = 'medicine_cache',
  ) {
    if (!/^[a-z_]+$/.test(table)) throw new Error(`bad cache table name: ${table}`)
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, data TEXT NOT NULL, model TEXT NOT NULL, created_ms INTEGER NOT NULL)`)
  }

  get(key: string, now: number): { info: T; model: string; createdMs: number } | null {
    const r = this.db.prepare(`SELECT data, model, created_ms FROM ${this.table} WHERE key = ?`).get(key) as { data: string; model: string; created_ms: number } | undefined
    if (!r) return null
    if (now - r.created_ms > this.ttlMs) {
      this.db.prepare(`DELETE FROM ${this.table} WHERE key = ?`).run(key)
      return null
    }
    try {
      return { info: JSON.parse(r.data) as T, model: r.model, createdMs: r.created_ms }
    } catch {
      return null
    }
  }

  put(key: string, info: T, model: string, now: number) {
    this.db.prepare(`INSERT OR REPLACE INTO ${this.table} (key, data, model, created_ms) VALUES (?, ?, ?, ?)`).run(key, JSON.stringify(info), model, now)
  }

  size(): number {
    return (this.db.prepare(`SELECT COUNT(*) n FROM ${this.table}`).get() as { n: number }).n
  }
}
