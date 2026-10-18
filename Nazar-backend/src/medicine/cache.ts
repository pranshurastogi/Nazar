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

export class MedicineCache {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ttlMs = CACHE_TTL_MS,
  ) {
    db.exec('CREATE TABLE IF NOT EXISTS medicine_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, model TEXT NOT NULL, created_ms INTEGER NOT NULL)')
  }

  get(key: string, now: number): { info: MedicineInfo; model: string; createdMs: number } | null {
    const r = this.db.prepare('SELECT data, model, created_ms FROM medicine_cache WHERE key = ?').get(key) as { data: string; model: string; created_ms: number } | undefined
    if (!r) return null
    if (now - r.created_ms > this.ttlMs) {
      this.db.prepare('DELETE FROM medicine_cache WHERE key = ?').run(key)
      return null
    }
    try {
      return { info: JSON.parse(r.data) as MedicineInfo, model: r.model, createdMs: r.created_ms }
    } catch {
      return null
    }
  }

  put(key: string, info: MedicineInfo, model: string, now: number) {
    this.db.prepare('INSERT OR REPLACE INTO medicine_cache (key, data, model, created_ms) VALUES (?, ?, ?, ?)').run(key, JSON.stringify(info), model, now)
  }

  size(): number {
    return (this.db.prepare('SELECT COUNT(*) n FROM medicine_cache').get() as { n: number }).n
  }
}
