import { API_URL, PROJECT, PUBLISHER } from './config'

// The Arkiv directory: a structured explorer of everything Nazar has published on Arkiv.
// Filters are turned into Arkiv predicates here, once, and used three ways: shown as the
// exact query string the node parses, shown as a copyable SDK program, and run either by
// the Nazar API (GET /v1/arkiv/entities) or straight from the browser. The mapping mirrors
// Nazar-backend/src/arkiv/directory.ts.

export const DIRECTORY_TYPES = ['alert', 'notice', 'heartbeat'] as const
export type DirectoryType = (typeof DIRECTORY_TYPES)[number]

export type DirectoryFilters = {
  type: DirectoryType
  src: string
  state: string
  cat: string
  fail: string
  form: string
  /** Severity bounds, 1–5; 0 means unbounded. */
  sevMin: number
  sevMax: number
  /** '1' Child Shield only, '0' not paediatric, '' either. */
  peds: '' | '1' | '0'
  /** Batch not expired yet: exp_ym ≥ the current month. */
  inDate: boolean
  /** Alert month range, YYYYMM; 0 means open. */
  alertFrom: number
  alertTo: number
  batch: string
  notice: string
  /** Notices only: the month of the notice, YYYYMM. */
  noticeYm: number
}

export const EMPTY_FILTERS: DirectoryFilters = {
  type: 'alert',
  src: '',
  state: '',
  cat: '',
  fail: '',
  form: '',
  sevMin: 0,
  sevMax: 0,
  peds: '',
  inDate: false,
  alertFrom: 0,
  alertTo: 0,
  batch: '',
  notice: '',
  noticeYm: 0,
}

export const PAGE_SIZE = 25

export const CATEGORIES = ['nsq', 'spurious', 'adulterated', 'misbranded'] as const
export const FAILURES = ['assay', 'dissolution', 'description', 'identification', 'labelling', 'sterility', 'particulate', 'disintegration', 'uniformity', 'spurious', 'ph', 'microbial', 'related_substances', 'glycol', 'endotoxin', 'other'] as const
export const FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'injection', 'infusion', 'drops', 'solution', 'cream', 'ointment', 'gel', 'lotion', 'powder', 'inhaler', 'spray', 'suppository', 'device', 'other'] as const

export const currentYm = (d = new Date()) => d.getUTCFullYear() * 100 + d.getUTCMonth() + 1
const isYm = (n: number) => Number.isInteger(n) && n >= 199001 && n <= 209912 && n % 100 >= 1 && n % 100 <= 12
const isKey = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s)
export const matchKey = (batch: string) => batch.toLowerCase().replace(/[^a-z0-9]/g, '')

// ---- URL <-> filters

export function filtersFromSearch(search: string): DirectoryFilters {
  const p = new URLSearchParams(search)
  const num = (k: string, ok: (n: number) => boolean) => {
    const n = Number(p.get(k) ?? '')
    return ok(n) ? n : 0
  }
  const pick = (k: string, list: readonly string[]) => (list.includes(p.get(k) ?? '') ? (p.get(k) as string) : '')
  const type = (DIRECTORY_TYPES as readonly string[]).includes(p.get('type') ?? '') ? (p.get('type') as DirectoryType) : 'alert'
  const sev = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5
  const peds = p.get('peds')
  return {
    type,
    src: /^[a-z][a-z0-9-]{1,31}$/.test(p.get('src') ?? '') ? (p.get('src') as string) : '',
    state: /^IN-[A-Z]{2}$/.test(p.get('state') ?? '') ? (p.get('state') as string) : '',
    cat: pick('cat', CATEGORIES),
    fail: pick('fail', FAILURES),
    form: pick('form', FORMS),
    sevMin: num('sevMin', sev),
    sevMax: num('sevMax', sev),
    peds: peds === '1' || peds === '0' ? peds : '',
    inDate: p.get('inDate') === '1',
    alertFrom: num('alertFrom', isYm),
    alertTo: num('alertTo', isYm),
    batch: (p.get('batch') ?? '').slice(0, 64),
    notice: isKey(p.get('notice') ?? '') ? (p.get('notice') as string) : '',
    noticeYm: num('noticeYm', isYm),
  }
}

/** Only the filters that apply to the chosen type, so switching tabs never carries stale predicates. */
export function activeFilters(f: DirectoryFilters): DirectoryFilters {
  if (f.type === 'heartbeat') return { ...EMPTY_FILTERS, type: 'heartbeat' }
  if (f.type === 'notice') return { ...EMPTY_FILTERS, type: 'notice', src: f.src, noticeYm: f.noticeYm }
  // A reversed month range is read the way it was meant, never sent as an impossible query.
  const [alertFrom, alertTo] = f.alertFrom && f.alertTo && f.alertFrom > f.alertTo ? [f.alertTo, f.alertFrom] : [f.alertFrom, f.alertTo]
  return { ...f, alertFrom, alertTo, noticeYm: 0 }
}

export function filtersToSearch(f: DirectoryFilters, extra: Record<string, string> = {}): string {
  const a = activeFilters(f)
  const p = new URLSearchParams()
  if (a.type !== 'alert') p.set('type', a.type)
  for (const k of ['src', 'state', 'cat', 'fail', 'form', 'batch', 'notice'] as const) if (a[k]) p.set(k, a[k])
  for (const k of ['sevMin', 'sevMax', 'alertFrom', 'alertTo', 'noticeYm'] as const) if (a[k]) p.set(k, String(a[k]))
  if (a.peds) p.set('peds', a.peds)
  if (a.inDate) p.set('inDate', '1')
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
  return p.toString()
}

/** Number of filters set beyond the entity type. */
export const filterCount = (f: DirectoryFilters) => (filtersToSearch({ ...activeFilters(f), type: 'alert' }).match(/=/g) ?? []).length

// ---- filters -> Arkiv predicates

export type Pred = { name: string; op: '=' | '>=' | '<='; type: 'str' | 'i32' | 'key'; value: string | number }

/** Predicates after project, t and creator, in the same fixed order as the backend. */
export function predicates(input: DirectoryFilters, now = new Date()): Pred[] {
  const f = activeFilters(input)
  const out: Pred[] = []
  const s = (name: string, value: string) => out.push({ name, op: '=', type: 'str', value })
  const n = (name: string, op: Pred['op'], value: number) => out.push({ name, op, type: 'i32', value })
  const bk = matchKey(f.batch)
  if (bk.length >= 2) s('batch', bk)
  if (f.src) s('src', f.src)
  if (f.state) s('state', f.state)
  if (f.cat) s('cat', f.cat)
  if (f.fail) s('fail', f.fail)
  if (f.form) s('form', f.form)
  if (f.sevMin && f.sevMin === f.sevMax) n('sev', '=', f.sevMin)
  else {
    if (f.sevMin > 1) n('sev', '>=', f.sevMin)
    if (f.sevMax && f.sevMax < 5) n('sev', '<=', f.sevMax)
  }
  if (f.peds) n('peds', '=', f.peds === '1' ? 1 : 0)
  if (f.inDate) n('exp_ym', '>=', currentYm(now))
  if (f.alertFrom) n('alert_ym', '>=', f.alertFrom)
  if (f.alertTo) n('alert_ym', '<=', f.alertTo)
  if (f.notice) out.push({ name: 'notice', op: '=', type: 'key', value: f.notice })
  if (f.noticeYm) n('notice_ym', '=', f.noticeYm)
  return out
}

const basePreds = (t: string): Pred[] => [
  { name: 'project', op: '=', type: 'str', value: PROJECT },
  { name: 't', op: '=', type: 'str', value: t },
]

const lit = (p: Pred) => (p.type === 'str' ? `'${String(p.value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(p.value))

/** The text the Arkiv node parses, as the SDK builder's toString() renders it. */
export function queryString(t: string, preds: Pred[], publisher: string = PUBLISHER) {
  return [...basePreds(t), ...preds].map((p) => `${p.name} ${p.op} ${p.type}(${lit(p)})`).concat(`$creator = addr(${publisher})`).join(' AND ')
}

const FN: Record<Pred['op'], string> = { '=': 'eq', '>=': 'gte', '<=': 'lte' }
const code = (p: Pred) => `${FN[p.op]}('${p.name}', ${p.type}(${p.type === 'key' ? `'${p.value}'` : lit(p)}))`

/** A copyable TypeScript program that runs the same query with nothing but the Arkiv SDK. */
export function sdkSnippet(t: string, preds: Pred[], limit = PAGE_SIZE, publisher: string = PUBLISHER) {
  const all = [...basePreds(t), ...preds]
  const fns = [...new Set(all.map((p) => FN[p.op]))].sort()
  const types = [...new Set(all.map((p) => p.type))].sort()
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
${all.map((p) => `      ${code(p)},`).join('\n')}
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

/** Query parameters for GET /v1/arkiv/entities. */
export function apiParams(input: DirectoryFilters, page?: { cursor: string; block: string }, now = new Date()) {
  const f = activeFilters(input)
  const p = new URLSearchParams({ type: f.type, limit: String(PAGE_SIZE) })
  for (const k of ['src', 'state', 'cat', 'fail', 'form', 'notice'] as const) if (f[k]) p.set(k, f[k])
  if (matchKey(f.batch).length >= 2) p.set('batch', f.batch)
  if (f.sevMin) p.set('sevMin', String(f.sevMin))
  if (f.sevMax) p.set('sevMax', String(f.sevMax))
  if (f.peds) p.set('peds', f.peds)
  if (f.inDate) p.set('expFrom', String(currentYm(now)))
  if (f.alertFrom) p.set('alertFrom', String(f.alertFrom))
  if (f.alertTo) p.set('alertTo', String(f.alertTo))
  if (f.noticeYm) p.set('noticeYm', String(f.noticeYm))
  if (page) (p.set('cursor', page.cursor), p.set('block', page.block))
  return p
}

// ---- results

export type TypedAttribute = { name: string; type: string; value: string | number }

export type DirectoryEntity = {
  key: string
  type: string
  creator: string | null
  owner: string | null
  createdAtBlock: string | null
  expiresAtBlock: string | null
  expiresAtEstimate: string | null
  flags: { readonly: boolean; permissionlessExtension: boolean } | null
  attributes: TypedAttribute[]
  payload: unknown
}

export type DirectoryPage = { items: DirectoryEntity[]; cursor: string | null; block: string }

export type Counts = Record<string, number>
export type ArkivSummary = {
  publisher: string
  project: string
  generatedAt: string
  generatedAtBlock: string
  latestBlock: string
  stale: boolean
  error: string | null
  entities: Counts
  alerts: { total: number; bySrc: Counts; byState: Counts; byCat: Counts; bySev: Counts; byForm: Counts; byFail: Counts; peds: number; inDate: number }
  notices: { key: string; src: string; noticeYm: number | null; rows: number; sha: string; title: string | null; url: string | null }[]
  heartbeat: { key: string; lastOkMs: number | null; expiresAtBlock: string | null; expiresAtEstimate: string | null } | null
}

/** Why a read failed, in terms the page can act on. */
export class DirectoryReadError extends Error {
  constructor(
    message: string,
    readonly kind: 'throttled' | 'unavailable' | 'no-api' | 'expired' | 'bad-request',
    readonly retryInMs = 0,
  ) {
    super(message)
    this.name = 'DirectoryReadError'
  }
}

export const attr = (e: DirectoryEntity, name: string) => e.attributes.find((a) => a.name === name)?.value ?? null
export const isOfficial = (e: Pick<DirectoryEntity, 'creator'>) => !!e.creator && e.creator.toLowerCase() === PUBLISHER.toLowerCase()

async function apiGet<T>(path: string, signal?: AbortSignal, timeoutMs = 20_000): Promise<T> {
  if (!API_URL) throw new DirectoryReadError('No Nazar API is configured for this build', 'no-api')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs)
  const onAbort = () => ctrl.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(`${API_URL}${path}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (res.ok) return (await res.json()) as T
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    const retry = Number(res.headers.get('retry-after') ?? 0) * 1000
    const msg = body?.error?.message ?? `${path} returned ${res.status}`
    if (body?.error?.code === 'ARKIV_THROTTLED' || res.status === 429) throw new DirectoryReadError(msg, 'throttled', retry)
    if (res.status === 410) throw new DirectoryReadError(msg, 'expired')
    if (res.status === 400) throw new DirectoryReadError(msg, 'bad-request')
    throw new DirectoryReadError(msg, 'unavailable', retry)
  } catch (err) {
    if (err instanceof DirectoryReadError || signal?.aborted) throw err
    throw new DirectoryReadError('The Nazar API could not be reached', 'unavailable')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export const apiSummary = (signal?: AbortSignal) => apiGet<ArkivSummary>('/v1/arkiv/summary', signal, 25_000)

export async function apiEntities(f: DirectoryFilters, page?: { cursor: string; block: string }, signal?: AbortSignal): Promise<DirectoryPage> {
  const r = await apiGet<DirectoryPage>(`/v1/arkiv/entities?${apiParams(f, page)}`, signal)
  if (!r || !Array.isArray(r.items)) throw new DirectoryReadError('Unexpected /v1/arkiv/entities response', 'unavailable')
  return { items: r.items, cursor: r.cursor ?? null, block: String(r.block) }
}

/** The same page, read straight from Arkiv in this browser: no Nazar server involved. */
export async function browserEntities(f: DirectoryFilters, page?: { cursor: string; block: string }, signal?: AbortSignal): Promise<DirectoryPage> {
  const arkiv = await import('./arkiv')
  try {
    return await arkiv.arkivDirectoryPage(activeFilters(f).type, predicates(f), PAGE_SIZE, page, signal)
  } catch (err) {
    if (signal?.aborted) throw err
    if (err instanceof arkiv.ArkivBackoffError) throw new DirectoryReadError(err.message, 'throttled', err.retryInMs)
    const status = statusOf(err)
    if (status === 429) throw new DirectoryReadError('The public Arkiv RPC is rate limiting this browser', 'throttled', arkiv.arkivPausedFor())
    if ((err as Error)?.name === 'QueryError' && /cursor/i.test(String((err as Error).message))) throw new DirectoryReadError('That page expired; start again from the first page', 'expired')
    throw new DirectoryReadError(`Arkiv could not be reached from this browser`, 'unavailable', arkiv.arkivPausedFor())
  }
}

function statusOf(err: unknown): number | null {
  for (let e = err as { status?: number; cause?: unknown } | undefined, i = 0; e && i < 6; e = e.cause as typeof e, i++) {
    if (typeof e.status === 'number') return e.status
  }
  return null
}
