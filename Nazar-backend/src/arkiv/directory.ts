import type { Entity } from '@arkiv-network/sdk'
import { addr, i32, key, str } from '@arkiv-network/sdk/attr'
import { eq, gte, lte, type Expression } from '@arkiv-network/sdk/query'
import type { Hex } from 'viem'
import { z } from 'zod'

import { matchKey } from '../domain/batch.ts'
import { CATEGORIES, DOSAGE_FORMS, FAILURES } from '../domain/vocab.ts'
import { NazarError, errorMessage, redactSecrets } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { MAX_PAGE, type ArkivRead } from './reader.ts'
import { PROJECT } from './schema.ts'

/**
 * The Arkiv directory: a structured, read-only explorer of everything Nazar has published.
 * Two questions, both answered from Arkiv itself (never from the local ledger):
 *   summary()  – live counts by entity type and by the alert attributes people filter on;
 *   entities() – one page of entities for a validated filter set, plus the exact Arkiv query
 *                string and a copyable SDK snippet, so anyone can reproduce it without Nazar.
 * Every query is pinned to our project tag, the entity type and `.createdBy(publisher)`.
 */

const log = child('arkiv-directory')

export const DIRECTORY_TYPES = ['alert', 'notice', 'retraction', 'heartbeat'] as const
export type DirectoryType = (typeof DIRECTORY_TYPES)[number]

/** Arkiv produces a block every two seconds; used to turn an expiry block into an estimated date. */
export const BLOCK_MS = 2000

export class DirectoryError extends NazarError {
  constructor(
    message: string,
    code: 'ARKIV_THROTTLED' | 'ARKIV_UNAVAILABLE' | 'CURSOR_EXPIRED' | 'SUMMARY_WARMING',
    readonly retryAfterSec?: number,
    options?: { cause?: unknown },
  ) {
    super(message, code, undefined, options)
  }
}

// ---- input

const ym = z.coerce.number().int().min(199001).max(209912).refine((v) => v % 100 >= 1 && v % 100 <= 12, 'must be YYYYMM')
const sev = z.coerce.number().int().min(1).max(5)
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')
const slug = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, 'must be a source id like cdsco-online')
const hexKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte entity key (0x + 64 hex)')

/** Filters each entity type accepts; anything else for that type is a 400, never silently ignored. */
const ALERT_FILTERS = ['src', 'state', 'cat', 'fail', 'form', 'sevMin', 'sevMax', 'peds', 'expFrom', 'expTo', 'alertFrom', 'alertTo', 'batch', 'notice'] as const
const ALLOWED: Record<DirectoryType, readonly string[]> = {
  alert: ALERT_FILTERS,
  notice: ['src', 'noticeYm'],
  retraction: ['src', 'alert'],
  heartbeat: [],
}

export const EntitiesQuery = z
  .object({
    type: z.enum(DIRECTORY_TYPES).default('alert'),
    src: slug.optional(),
    state: z.string().regex(/^IN-[A-Z]{2}$/, 'must be an ISO 3166-2:IN code like IN-TN').optional(),
    cat: z.enum(CATEGORIES).optional(),
    fail: z.enum(FAILURES).optional(),
    form: z.enum(DOSAGE_FORMS).optional(),
    sevMin: sev.optional(),
    sevMax: sev.optional(),
    peds: bool.optional(),
    expFrom: ym.optional(),
    expTo: ym.optional(),
    alertFrom: ym.optional(),
    alertTo: ym.optional(),
    batch: z.string().trim().min(1).max(64).refine((b) => matchKey(b).length >= 2, 'batch needs at least two letters or digits').optional(),
    notice: hexKey.optional(),
    noticeYm: ym.optional(),
    alert: hexKey.optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(25),
    cursor: z.string().min(1).max(4096).optional(),
    block: z.string().regex(/^\d{1,20}$/, 'must be a block number').optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    const allowed = ALLOWED[q.type]
    for (const f of [...ALERT_FILTERS, 'noticeYm', 'alert'] as const) {
      if (q[f] !== undefined && !allowed.includes(f)) ctx.addIssue({ code: 'custom', path: [f], message: `not a filter for type=${q.type}` })
    }
    const order = (lo: number | undefined, hi: number | undefined, path: string) => {
      if (lo !== undefined && hi !== undefined && lo > hi) ctx.addIssue({ code: 'custom', path: [path], message: 'range is reversed' })
    }
    order(q.sevMin, q.sevMax, 'sevMax')
    order(q.expFrom, q.expTo, 'expTo')
    order(q.alertFrom, q.alertTo, 'alertTo')
    // A cursor is bound to the block its first page was read at; without the block the node rejects it.
    if (q.cursor && !q.block) ctx.addIssue({ code: 'custom', path: ['block'], message: 'a cursor needs the block of its first page' })
  })
export type EntitiesQuery = z.infer<typeof EntitiesQuery>

// ---- filter → Arkiv predicates

/** Predicates after the base three (project, t, creator), in a fixed order so the query string is stable. */
export function filterExpressions(q: EntitiesQuery): Expression[] {
  const f: Expression[] = []
  if (q.batch) f.push(eq('batch', str(matchKey(q.batch))))
  if (q.src) f.push(eq('src', str(q.src)))
  if (q.state) f.push(eq('state', str(q.state)))
  if (q.cat) f.push(eq('cat', str(q.cat)))
  if (q.fail) f.push(eq('fail', str(q.fail)))
  if (q.form) f.push(eq('form', str(q.form)))
  if (q.sevMin !== undefined && q.sevMin === q.sevMax) f.push(eq('sev', i32(q.sevMin)))
  else {
    if (q.sevMin !== undefined && q.sevMin > 1) f.push(gte('sev', i32(q.sevMin)))
    if (q.sevMax !== undefined && q.sevMax < 5) f.push(lte('sev', i32(q.sevMax)))
  }
  if (q.peds !== undefined) f.push(eq('peds', i32(q.peds ? 1 : 0)))
  if (q.expFrom) f.push(gte('exp_ym', i32(q.expFrom)))
  if (q.expTo) f.push(lte('exp_ym', i32(q.expTo)))
  if (q.alertFrom) f.push(gte('alert_ym', i32(q.alertFrom)))
  if (q.alertTo) f.push(lte('alert_ym', i32(q.alertTo)))
  if (q.notice) f.push(eq('notice', key(q.notice as Hex)))
  if (q.noticeYm) f.push(eq('notice_ym', i32(q.noticeYm)))
  if (q.alert) f.push(eq('alert', key(q.alert as Hex)))
  return f
}

export const baseExpressions = (t: string): Expression[] => [eq('project', str(PROJECT)), eq('t', str(t))]

/** The text the node parses, identical to the SDK builder's toString() for the same query. */
export function queryString(t: string, filters: Expression[], publisher: Hex): string {
  return [...baseExpressions(t), ...filters, eq('$creator', addr(publisher))].map(String).join(' AND ')
}

const OP_FN: Record<string, string> = { '=': 'eq', '!=': 'ne', '>=': 'gte', '<=': 'lte', '>': 'gt', '<': 'lt' }

function exprCode(e: Expression): string {
  if (e.kind !== 'comparison') return `/* ${String(e)} */`
  const v = e.value as { type: string; value: unknown }
  const lit = typeof v.value === 'string' ? `'${v.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(v.value)
  return `${OP_FN[e.operator] ?? 'eq'}('${e.name}', ${v.type}(${lit}))`
}

/** A copyable TypeScript program that runs the same query against Arkiv with nothing but the SDK. */
export function sdkSnippet(t: string, filters: Expression[], publisher: Hex, limit: number): string {
  const all = [...baseExpressions(t), ...filters]
  const fns = [...new Set(all.map((e) => (e.kind === 'comparison' ? (OP_FN[e.operator] ?? 'eq') : 'eq')))].sort()
  const types = [...new Set(all.map((e) => (e.kind === 'comparison' ? (e.value as { type: string }).type : 'str')))].sort()
  return `import { createPublicClient } from '@arkiv-network/sdk'
import { ${types.join(', ')} } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { ${fns.join(', ')} } from '@arkiv-network/sdk/query'
import { http } from 'viem'

const client = createPublicClient({ chain: tiramisu, transport: http() })

const query = () =>
  client
    .select({ key: true, attributes: true, payload: true, creator: true, expiresAt: true, creationFlags: true })
    .where([
${all.map((e) => `      ${exprCode(e)},`).join('\n')}
    ])
    .createdBy('${publisher}')
    .limit(${limit})

const page = await query().fetch()
console.log(page.entities.map((e) => ({ key: e.key, attributes: e.attributes, payload: e.toJson() })))

// Next page: pin the first page's block, or the cursor stops working once a new block arrives.
if (page.cursor) {
  const next = await query().atBlock(page.blockNumber).cursor(page.cursor).fetch()
}`
}

// ---- output

export type TypedAttribute = { name: string; type: string; value: string | number }

export interface DirectoryEntity {
  key: string
  type: string
  creator: string | null
  owner: string | null
  /** True when the creator is the Nazar publisher wallet (always, given the query, but stated per row). */
  official: boolean
  createdAtBlock: string | null
  expiresAtBlock: string | null
  /** Expiry block turned into a date at two seconds per block, from the block the page was read at. */
  expiresAtEstimate: string | null
  flags: { readonly: boolean; permissionlessExtension: boolean } | null
  attributes: TypedAttribute[]
  payload: unknown
}

export interface EntitiesResponse {
  items: DirectoryEntity[]
  cursor: string | null
  block: string
  query: { string: string; sdk: string }
  cached: boolean
}

type Raw = Partial<Pick<Entity, 'key' | 'creator' | 'owner' | 'createdAt' | 'expiresAt' | 'creationFlags' | 'attributes' | 'payload'>> & { toJson?: () => unknown }
type Tagged = { type: string; value: unknown }

const big = (v: unknown) => (v === undefined || v === null ? null : String(v))
const attrsOf = (e: Raw) => (e.attributes ?? {}) as unknown as Record<string, Tagged | undefined>

function payloadOf(e: Raw): unknown {
  if (!e.payload?.length) return null
  try {
    return e.toJson ? e.toJson() : JSON.parse(new TextDecoder().decode(e.payload))
  } catch {
    return { _text: new TextDecoder().decode(e.payload).slice(0, 2000) }
  }
}

export function toDirectoryEntity(e: Raw, publisher: Hex, block: bigint, now: number): DirectoryEntity {
  const a = attrsOf(e)
  const attributes = Object.entries(a)
    .filter((x): x is [string, Tagged] => !!x[1])
    .map(([name, t]) => ({ name, type: t.type, value: typeof t.value === 'number' ? t.value : String(t.value) }))
    .sort((x, y) => x.name.localeCompare(y.name))
  const exp = e.expiresAt !== undefined && e.expiresAt !== null ? BigInt(e.expiresAt) : null
  return {
    key: String(e.key ?? ''),
    type: String(a.t?.value ?? ''),
    creator: e.creator ?? null,
    owner: e.owner ?? null,
    official: !!e.creator && e.creator.toLowerCase() === publisher.toLowerCase(),
    createdAtBlock: big(e.createdAt),
    expiresAtBlock: big(exp),
    expiresAtEstimate: exp !== null ? new Date(now + Number(exp - block) * BLOCK_MS).toISOString() : null,
    flags: e.creationFlags ? { readonly: !!e.creationFlags.readonly, permissionlessExtension: !!e.creationFlags.permissionlessExtension } : null,
    attributes,
    payload: payloadOf(e),
  }
}

// ---- summary

export type Counts = Record<string, number>

export interface SummaryNotice {
  key: string
  src: string
  noticeYm: number | null
  rows: number
  sha: string
  title: string | null
  url: string | null
  expiresAtBlock: string | null
}

export interface ArkivSummary {
  publisher: string
  project: string
  generatedAt: string
  generatedAtBlock: string
  latestBlock: string
  stale: boolean
  /** Why the snapshot is stale (last refresh error), when it is. */
  error: string | null
  entities: Counts
  alerts: {
    total: number
    bySrc: Counts
    byState: Counts
    byCat: Counts
    bySev: Counts
    byForm: Counts
    byFail: Counts
    peds: number
    /** Alerts whose batch has not expired yet (exp_ym ≥ the current month). */
    inDate: number
  }
  notices: SummaryNotice[]
  heartbeat: { key: string; lastOkMs: number | null; expiresAtBlock: string | null; expiresAtEstimate: string | null } | null
}

const bump = (c: Counts, k: string | null | undefined) => {
  const key = k === null || k === undefined || k === '' ? 'unknown' : k
  c[key] = (c[key] ?? 0) + 1
}

export const currentYm = (d = new Date()) => d.getUTCFullYear() * 100 + d.getUTCMonth() + 1

// ---- the service

function classify(err: unknown): DirectoryError {
  if (err instanceof DirectoryError) return err
  const msg = errorMessage(err)
  let status: number | undefined
  for (let e = err as { status?: number; cause?: unknown } | undefined, i = 0; e && i < 6; e = e.cause as typeof e, i++) {
    if (typeof e.status === 'number') status = e.status
  }
  if (status === 429 || /429|rate.?limit|ANON_COST_LIMITED|too many requests/i.test(msg)) {
    return new DirectoryError('Arkiv RPC is rate limiting this server; try again shortly', 'ARKIV_THROTTLED', 30, { cause: err })
  }
  if (/cursor/i.test(msg) && /block|query|select|expired|invalid/i.test(msg)) {
    return new DirectoryError('the cursor expired or no longer matches its block; start from the first page', 'CURSOR_EXPIRED', undefined, { cause: err })
  }
  return new DirectoryError(`Arkiv read failed: ${msg}`, 'ARKIV_UNAVAILABLE', 10, { cause: err })
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms).unref?.())])

export interface DirectoryOptions {
  publisher: Hex
  client: ArkivRead | (() => ArkivRead)
  now?: () => number
  summaryTtlMs?: number
  /** Longest a request waits for a summary refresh before answering with what it has. */
  coldWaitMs?: number
  entitiesTtlMs?: number
  entitiesCacheSize?: number
  queryTimeoutMs?: number
  /** Ceiling on alerts walked for the summary, as a guard against a runaway dataset. */
  maxAlerts?: number
}

export class ArkivDirectory {
  readonly publisher: Hex
  private readonly getClient: () => ArkivRead
  private readonly now: () => number
  private readonly o: Required<Omit<DirectoryOptions, 'publisher' | 'client' | 'now'>>
  private snapshot: { at: number; data: ArkivSummary } | null = null
  private refreshing: Promise<ArkivSummary> | null = null
  private lastError: { at: number; message: string } | null = null
  private readonly lru = new Map<string, { at: number; value: Omit<EntitiesResponse, 'cached'> }>()

  constructor(o: DirectoryOptions) {
    this.publisher = o.publisher
    this.getClient = typeof o.client === 'function' ? o.client : () => o.client as ArkivRead
    this.now = o.now ?? Date.now
    this.o = {
      summaryTtlMs: o.summaryTtlMs ?? 5 * 60_000,
      coldWaitMs: o.coldWaitMs ?? 20_000,
      entitiesTtlMs: o.entitiesTtlMs ?? 60_000,
      entitiesCacheSize: o.entitiesCacheSize ?? 200,
      queryTimeoutMs: o.queryTimeoutMs ?? 15_000,
      maxAlerts: o.maxAlerts ?? 20_000,
    }
  }

  private select(t: string, filters: Expression[], fields?: Record<string, true>) {
    const c = this.getClient()
    return (fields ? c.select(fields as never) : c.select()).where([...baseExpressions(t), ...filters]).createdBy(this.publisher)
  }

  // ---- entities

  /** Cache key: the validated query with keys sorted, so `?a=1&b=2` and `?b=2&a=1` share an entry. */
  static cacheKey(q: EntitiesQuery) {
    return JSON.stringify(Object.entries(q).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
  }

  describe(q: EntitiesQuery) {
    const filters = filterExpressions(q)
    return { filters, string: queryString(q.type, filters, this.publisher), sdk: sdkSnippet(q.type, filters, this.publisher, q.limit) }
  }

  async entities(q: EntitiesQuery): Promise<EntitiesResponse> {
    const ck = ArkivDirectory.cacheKey(q)
    const hit = this.lru.get(ck)
    if (hit && this.now() - hit.at < this.o.entitiesTtlMs) {
      this.lru.delete(ck)
      this.lru.set(ck, hit)
      return { ...hit.value, cached: true }
    }
    const { filters, string, sdk } = this.describe(q)
    let b = this.select(q.type, filters).limit(q.limit)
    // Pinned pagination: the cursor only means something at the block its first page was read at.
    if (q.cursor && q.block) b = b.atBlock(BigInt(q.block)).cursor(q.cursor)
    let res
    try {
      res = await withTimeout(b.fetch(), this.o.queryTimeoutMs, 'Arkiv query')
    } catch (err) {
      const e = classify(err)
      log.warn({ err: errorMessage(err), code: e.code, query: string }, 'directory query failed')
      throw e
    }
    const now = this.now()
    const value = {
      items: res.entities.map((e) => toDirectoryEntity(e as unknown as Raw, this.publisher, res.blockNumber, now)),
      cursor: res.cursor ?? null,
      block: res.blockNumber.toString(),
      query: { string, sdk },
    }
    this.lru.set(ck, { at: now, value })
    while (this.lru.size > this.o.entitiesCacheSize) this.lru.delete(this.lru.keys().next().value as string)
    return { ...value, cached: false }
  }

  // ---- summary

  /** Every entity of one type at one block, walking cursors with the block pinned. */
  private async walk(t: string, fields: Record<string, true> | undefined, block: bigint | null, max: number) {
    const first = this.select(t, [], fields).limit(MAX_PAGE)
    let res = await withTimeout((block !== null ? first.atBlock(block) : first).fetch(), this.o.queryTimeoutMs, `Arkiv ${t} walk`)
    const at = res.blockNumber
    const out = [...res.entities] as unknown as Raw[]
    while (res.cursor && out.length < max) {
      res = await withTimeout(this.select(t, [], fields).limit(MAX_PAGE).atBlock(at).cursor(res.cursor).fetch(), this.o.queryTimeoutMs, `Arkiv ${t} walk`)
      out.push(...(res.entities as unknown as Raw[]))
    }
    return { items: out, block: at }
  }

  /** Reads everything once, at a single block, and folds it into counts. */
  async compute(): Promise<ArkivSummary> {
    const alerts = await this.walk('alert', { key: true, attributes: true }, null, this.o.maxAlerts)
    const block = alerts.block
    const notices = await this.walk('notice', undefined, block, 1000)
    const retractions = await this.walk('retraction', { key: true }, block, 5000)
    const beats = await this.walk('heartbeat', undefined, block, 50)
    const snapshots = await this.walk('snapshot', { key: true }, block, 100)
    const now = this.now()
    const ymNow = currentYm(new Date(now))

    const s: ArkivSummary['alerts'] = { total: alerts.items.length, bySrc: {}, byState: {}, byCat: {}, bySev: {}, byForm: {}, byFail: {}, peds: 0, inDate: 0 }
    for (const e of alerts.items) {
      const a = attrsOf(e)
      const v = (n: string) => (a[n] ? String(a[n]!.value) : null)
      bump(s.bySrc, v('src'))
      bump(s.byState, v('state'))
      bump(s.byCat, v('cat'))
      bump(s.bySev, v('sev'))
      bump(s.byForm, v('form'))
      bump(s.byFail, v('fail'))
      if (v('peds') === '1') s.peds++
      const exp = Number(v('exp_ym') ?? 0)
      if (exp >= ymNow) s.inDate++
    }

    const noticeList: SummaryNotice[] = notices.items
      .map((e) => {
        const a = attrsOf(e)
        const p = payloadOf(e) as { title?: string; url?: string } | null
        return {
          key: String(e.key ?? ''),
          src: String(a.src?.value ?? ''),
          noticeYm: a.notice_ym ? Number(a.notice_ym.value) : null,
          rows: Number(a.rows?.value ?? 0),
          sha: String(a.sha?.value ?? ''),
          title: p?.title ?? null,
          url: p?.url ?? null,
          expiresAtBlock: big(e.expiresAt),
        }
      })
      .sort((x, y) => (y.noticeYm ?? 0) - (x.noticeYm ?? 0) || x.src.localeCompare(y.src))

    const beat = beats.items
      .map((e) => {
        const last = attrsOf(e).last_ok?.value
        const exp = e.expiresAt !== undefined && e.expiresAt !== null ? BigInt(e.expiresAt) : null
        return {
          key: String(e.key ?? ''),
          lastOkMs: last === undefined ? null : Number(last),
          expiresAtBlock: big(exp),
          expiresAtEstimate: exp !== null ? new Date(now + Number(exp - block) * BLOCK_MS).toISOString() : null,
        }
      })
      .sort((x, y) => (y.lastOkMs ?? 0) - (x.lastOkMs ?? 0))[0] ?? null

    return {
      publisher: this.publisher,
      project: PROJECT,
      generatedAt: new Date(now).toISOString(),
      generatedAtBlock: block.toString(),
      latestBlock: block.toString(),
      stale: false,
      error: null,
      entities: {
        alert: alerts.items.length,
        notice: notices.items.length,
        retraction: retractions.items.length,
        heartbeat: beats.items.length,
        snapshot: snapshots.items.length,
      },
      alerts: s,
      notices: noticeList,
      heartbeat: beat,
    }
  }

  /** Starts one refresh at a time; failures keep the previous snapshot and are retried no sooner than 30 s later. */
  refresh(): Promise<ArkivSummary> {
    this.refreshing ??= this.compute()
      .then((data) => {
        this.snapshot = { at: this.now(), data }
        this.lastError = null
        log.info({ block: data.generatedAtBlock, alerts: data.alerts.total, notices: data.entities.notice }, 'arkiv summary refreshed')
        return data
      })
      .catch((err) => {
        const e = classify(err)
        this.lastError = { at: this.now(), message: redactSecrets(e.message) }
        log.warn({ err: errorMessage(err), code: e.code }, 'arkiv summary refresh failed')
        throw e
      })
      .finally(() => {
        this.refreshing = null
      })
    return this.refreshing
  }

  /**
   * Stale-while-revalidate: a fresh snapshot is returned as is; an old one is returned at once with
   * `stale: true` while a refresh runs; with no snapshot at all, the request waits up to coldWaitMs.
   */
  async summary(): Promise<ArkivSummary> {
    const snap = this.snapshot
    const age = snap ? this.now() - snap.at : Infinity
    if (snap && age < this.o.summaryTtlMs) return snap.data
    const backingOff = !!this.lastError && this.now() - this.lastError.at < 30_000
    if (snap) {
      if (!backingOff) this.refresh().catch(() => {})
      return { ...snap.data, stale: true, error: this.lastError?.message ?? null }
    }
    if (backingOff && !this.refreshing) throw new DirectoryError(this.lastError!.message, 'ARKIV_THROTTLED', 30)
    const pending = this.refresh()
    pending.catch(() => {})
    const timer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), this.o.coldWaitMs).unref?.())
    const won = await Promise.race([pending, timer])
    if (won === 'timeout') {
      throw new DirectoryError('the Arkiv summary is still being computed; try again in a few seconds', 'SUMMARY_WARMING', 5)
    }
    return won
  }
}
