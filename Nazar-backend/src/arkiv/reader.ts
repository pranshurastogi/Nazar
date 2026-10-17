import type { Entity, PublicArkivClient } from '@arkiv-network/sdk'
import { i32, key, str } from '@arkiv-network/sdk/attr'
import { eq, gte, lte, or, type Expression } from '@arkiv-network/sdk/query'
import type { Hex } from 'viem'

import { matchKey } from '../domain/batch.ts'
import { publicClient } from './client.ts'
import { PROJECT, decodeAlert, type AlertView, type HeartbeatPayload, type NoticePayload } from './schema.ts'

/**
 * Read side of the Arkiv data contract (Q1–Q7). Every query is pinned to our project tag AND to
 * the publisher wallet with `.createdBy()`, so nobody can inject look-alike alerts just by
 * writing entities with the same attributes.
 */

export type ArkivRead = Pick<PublicArkivClient, 'select'>

export interface Page<T> {
  items: T[]
  /** Opaque cursor for the next page, or null at the end. */
  cursor: string | null
  /** Block the page was read at, so callers can say "as of block N". */
  blockNumber: string
}

export interface NoticeView {
  entityKey: Hex
  creator: Hex | null
  sha: string
  sourceId: string
  jurisdiction: string
  noticeYm: number | null
  rows: number
  parser: string
  payload: NoticePayload | null
}

export interface RetractionView {
  entityKey: Hex
  alertKey: Hex
  caseId: string
  reason: string
  note: string | null
}

export interface HeartbeatView {
  entityKey: Hex
  lastOkMs: number
  payload: HeartbeatPayload | null
  expiresAtBlock: string | null
}

type Tagged = { type: string; value: unknown }
const attr = (e: Pick<Entity, 'attributes'>, name: string) => ((e.attributes ?? {}) as Record<string, Tagged | undefined>)[name]?.value
const json = <T>(e: Entity): T | null => {
  try {
    return e.payload && e.payload.length ? (e.toJson() as T) : null
  } catch {
    return null
  }
}

export function decodeNotice(e: Entity): NoticeView {
  const ym = attr(e, 'notice_ym')
  return {
    entityKey: e.key as Hex,
    creator: (e.creator as Hex | undefined) ?? null,
    sha: String(attr(e, 'sha') ?? ''),
    sourceId: String(attr(e, 'src') ?? ''),
    jurisdiction: String(attr(e, 'juris') ?? 'IN'),
    noticeYm: ym === undefined ? null : Number(ym),
    rows: Number(attr(e, 'rows') ?? 0),
    parser: String(attr(e, 'parser') ?? ''),
    payload: json<NoticePayload>(e),
  }
}

export function decodeRetraction(e: Entity): RetractionView {
  return {
    entityKey: e.key as Hex,
    alertKey: String(attr(e, 'alert') ?? '') as Hex,
    caseId: String(attr(e, 'case') ?? ''),
    reason: String(attr(e, 'reason') ?? ''),
    note: json<{ note?: string }>(e)?.note ?? null,
  }
}

export const MAX_PAGE = 200

export class ArkivReader {
  readonly publisher: Hex
  private readonly clientOverride: ArkivRead | undefined

  constructor(o: { publisher: Hex; client?: ArkivRead }) {
    this.publisher = o.publisher
    this.clientOverride = o.client
  }

  private get client(): ArkivRead {
    return this.clientOverride ?? publicClient()
  }

  /** Base query: our project, one entity type, created by our publisher. */
  private query(t: string, ...filters: Expression[]) {
    return this.client
      .select()
      .where(eq('project', str(PROJECT)), eq('t', str(t)), ...filters)
      .createdBy(this.publisher)
  }

  /** Cursor pagination helper shared by every list query. */
  async page<T>(t: string, filters: Expression[], decode: (e: Entity) => T, o: { limit?: number; cursor?: string | null } = {}): Promise<Page<T>> {
    let q = this.query(t, ...filters).limit(Math.min(Math.max(o.limit ?? 50, 1), MAX_PAGE))
    if (o.cursor) q = q.cursor(o.cursor)
    const res = await q.fetch()
    return {
      items: res.entities.map((e) => decode(e as unknown as Entity)),
      cursor: res.cursor ?? null,
      blockNumber: res.blockNumber.toString(),
    }
  }

  /** Walks every page up to `max` items (the node caps a page at 200). */
  async all<T>(t: string, filters: Expression[], decode: (e: Entity) => T, max = 1000): Promise<T[]> {
    let res = await this.query(t, ...filters).limit(Math.min(max, MAX_PAGE)).fetch()
    const out: T[] = res.entities.map((e) => decode(e as unknown as Entity))
    while (res.hasNextPage() && out.length < max) {
      res = await res.next()
      out.push(...res.entities.map((e) => decode(e as unknown as Entity)))
    }
    return out.slice(0, max)
  }

  /** Q1: every alert for a batch, by its match key ("SR-13" → "sr13"). */
  byBatch(batch: string): Promise<AlertView[]> {
    return this.all('alert', [eq('batch', str(matchKey(batch)))], decodeAlert, 200)
  }

  /** Q2: alerts still on shelves (batch expiry within a YYYYMM range), optionally for one brand slug. */
  active(o: { minExpYm: number; maxExpYm?: number; brand?: string; limit?: number; cursor?: string | null }): Promise<Page<AlertView>> {
    const f: Expression[] = [gte('exp_ym', i32(o.minExpYm))]
    if (o.maxExpYm) f.push(lte('exp_ym', i32(o.maxExpYm)))
    if (o.brand) f.push(eq('brand', str(o.brand)))
    return this.page('alert', f, decodeAlert, o)
  }

  /** Q3: the feed: alerts announced since a month, optionally for one state (ISO code, e.g. IN-TN). */
  feed(o: { sinceYm: number; state?: string; limit?: number; cursor?: string | null }): Promise<Page<AlertView>> {
    const f: Expression[] = [gte('alert_ym', i32(o.sinceYm))]
    if (o.state) f.push(eq('state', str(o.state)))
    return this.page('alert', f, decodeAlert, o)
  }

  /** Q4: Child Shield: paediatric products at severity 4 or above. */
  childShield(o: { minSeverity?: number; limit?: number; cursor?: string | null } = {}): Promise<Page<AlertView>> {
    return this.page('alert', [eq('peds', i32(1)), gte('sev', i32(o.minSeverity ?? 4))], decodeAlert, o)
  }

  /** Q5: Batch Passport: every alert in one case, across notices and regulators. */
  byCase(caseId: string): Promise<AlertView[]> {
    return this.all('alert', [eq('case', str(caseId))], decodeAlert, 200)
  }

  /** Q6: the newest live heartbeat of our worker; null when the pipeline has gone quiet. */
  async heartbeat(): Promise<HeartbeatView | null> {
    const beats = await this.all(
      'heartbeat',
      [],
      (e) => {
        const p = json<HeartbeatPayload>(e)
        return {
          entityKey: e.key as Hex,
          lastOkMs: p?.lastOkMs ?? Number(attr(e, 'last_ok') ?? 0),
          payload: p,
          expiresAtBlock: e.expiresAt !== undefined ? String(e.expiresAt) : null,
        }
      },
      20,
    )
    return beats.sort((a, b) => b.lastOkMs - a.lastOkMs)[0] ?? null
  }

  /** Q7: source notices, optionally from a month onwards. */
  notices(o: { sinceYm?: number; sourceId?: string; limit?: number; cursor?: string | null } = {}): Promise<Page<NoticeView>> {
    const f: Expression[] = []
    if (o.sinceYm) f.push(gte('notice_ym', i32(o.sinceYm)))
    if (o.sourceId) f.push(eq('src', str(o.sourceId)))
    return this.page('notice', f, decodeNotice, o)
  }

  /** Retractions that point at any of these alerts. */
  async retractionsFor(alertKeys: string[]): Promise<Map<string, RetractionView>> {
    const out = new Map<string, RetractionView>()
    for (let i = 0; i < alertKeys.length; i += 20) {
      const keys = alertKeys.slice(i, i + 20)
      const filter = keys.length === 1 ? eq('alert', key(keys[0] as Hex)) : or(...keys.map((k) => eq('alert', key(k as Hex))))
      for (const r of await this.all('retraction', [filter], decodeRetraction, 200)) out.set(r.alertKey.toLowerCase(), r)
    }
    return out
  }
}

export type { AlertView }
