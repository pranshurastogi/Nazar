import { createPublicClient, type PublicArkivClient } from '@arkiv-network/sdk'
import { i32, key, str } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq, gte, or, type Expression } from '@arkiv-network/sdk/query'
import { http, type Hex } from 'viem'

import { ARKIV_RPC_URL, PROJECT, PUBLISHER } from './config'
import { fromArkiv, type ArkivAlert } from './map'
import { confusionVariants, matchKey, resolveResult } from './match'
import type { Alert, CheckResult } from './types'

// Reads Nazar's alerts straight from Arkiv in the browser. This is the path that keeps
// working when every Nazar server is down: the data lives on-chain and every query is
// pinned to Nazar's project tag and publisher wallet, so nobody else can inject alerts.

let client: PublicArkivClient | undefined
const arkiv = () =>
  (client ??= createPublicClient({ chain: tiramisu, transport: http(ARKIV_RPC_URL, { timeout: 6000, retryCount: 0 }) }))

/** The RPC transport has no per-call signal, so we race it against the caller's. */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

type Attr = { type?: string; value?: unknown } | undefined
type RawEntity = { key?: Hex; creator?: Hex; attributes?: Readonly<Record<string, unknown>>; payload?: Uint8Array; toJson(): unknown }

/** The SDK narrows entity types per selection; we read them through one loose shape. */
const entitiesOf = (page: { entities: readonly unknown[] }) => page.entities as readonly RawEntity[]

const s = (a: Attr) => (a && a.value !== undefined && a.value !== null ? String(a.value) : null)
const n = (a: Attr) => (a && a.value !== undefined && a.value !== null ? Number(a.value) : null)

function payloadOf(e: RawEntity): ArkivAlert['payload'] {
  if (!e.payload?.length) return null
  try {
    return e.toJson() as ArkivAlert['payload']
  } catch {
    try {
      return JSON.parse(new TextDecoder().decode(e.payload)) as ArkivAlert['payload']
    } catch {
      return null
    }
  }
}

/** Mirrors decodeAlert in Nazar-backend/src/arkiv/schema.ts. */
export function decodeAlert(e: RawEntity): ArkivAlert {
  const a = (e.attributes ?? {}) as Record<string, Attr>
  return {
    entityKey: e.key ?? '',
    creator: e.creator ?? null,
    batchKey: s(a.batch) ?? '',
    batch: s(a.batch_raw) ?? s(a.batch) ?? '',
    rid: s(a.rid) ?? '',
    brand: s(a.brand) ?? '',
    form: s(a.form) ?? 'other',
    category: s(a.cat) ?? 'nsq',
    failure: s(a.fail) ?? 'other',
    severity: n(a.sev) ?? 1,
    peds: n(a.peds) === 1,
    mfgYm: n(a.mfg_ym),
    expYm: n(a.exp_ym),
    alertYm: n(a.alert_ym),
    confidence: (n(a.conf) ?? 0) / 100,
    method: s(a.method) ?? 'text',
    tier: s(a.tier) ?? 'auto',
    payload: payloadOf(e),
  }
}

const mine = (t: string) => [eq('project', str(PROJECT)), eq('t', str(t))]
const anyOf = (exprs: Expression[]) => (exprs.length === 1 ? exprs[0]! : or(exprs))

/**
 * Nazar may not have published anything yet (fresh deploy, testnet reset). An empty
 * dataset must never be read as "no alert", so callers fall through to the next source.
 */
let datasetSeen = false
let emptyCheckedAt = 0
export async function arkivHasData(signal?: AbortSignal) {
  if (datasetSeen) return true
  if (Date.now() - emptyCheckedAt < 60_000) return false
  const page = await abortable(arkiv().select({ key: true }).where(mine('alert')).createdBy(PUBLISHER).limit(1).fetch(), signal)
  datasetSeen = page.entities.length > 0
  if (!datasetSeen) emptyCheckedAt = Date.now()
  return datasetSeen
}

/** Retractions point at the alert they withdraw; attach them so the UI can show "Retracted". */
async function withRetractions(alerts: ArkivAlert[], signal?: AbortSignal) {
  const keys = alerts.map((a) => a.entityKey).filter(Boolean) as Hex[]
  if (!keys.length) return alerts
  const page = await abortable(
    arkiv()
      .select({ key: true, attributes: true, payload: true })
      .where(mine('retraction'))
      .where(anyOf(keys.map((k) => eq('alert', key(k)))))
      .createdBy(PUBLISHER)
      .limit(50)
      .fetch(),
    signal,
  )
  const byAlert = new Map<string, { reason: string; note: string | null }>()
  for (const e of entitiesOf(page)) {
    const a = (e.attributes ?? {}) as Record<string, Attr>
    const target = s(a.alert)?.toLowerCase()
    if (!target) continue
    let note: string | null = null
    try {
      note = (e.toJson() as { note?: string })?.note ?? null
    } catch {}
    byAlert.set(target, { reason: s(a.reason) ?? 'correction', note })
  }
  return alerts.map((a) => {
    const r = byAlert.get(a.entityKey.toLowerCase())
    return r ? { ...a, retraction: r } : a
  })
}

/** Returns null when Arkiv has no Nazar data to answer from. */
export async function arkivCheck(batch: string, signal?: AbortSignal): Promise<CheckResult | null> {
  const exactKey = matchKey(batch)
  const variants = confusionVariants(batch)
  const [ready, page] = await Promise.all([
    arkivHasData(signal),
    abortable(
      arkiv()
        .select({ key: true, attributes: true, payload: true, creator: true })
        .where(mine('alert'))
        .where(anyOf(variants.map((v) => eq('batch', str(v)))))
        .createdBy(PUBLISHER)
        .limit(50)
        .fetch(),
      signal,
    ),
  ])
  const decoded = entitiesOf(page).map(decodeAlert)
  const exact = decoded.filter((a) => a.batchKey === exactKey)
  if (!exact.length && !ready) return null
  const lookAlike = exact.length ? undefined : decoded[0]?.batch
  const alerts = exact.length ? (await withRetractions(exact, signal)).map(fromArkiv) : []
  return resolveResult(batch, alerts, lookAlike, 'arkiv')
}

/** Recent high-severity alerts for the home page, newest first. Null when Arkiv has no Nazar data. */
export async function arkivAlerts(q: { minSeverity?: number; peds?: boolean; limit?: number } = {}, signal?: AbortSignal): Promise<Alert[] | null> {
  const filters: Expression[] = [...mine('alert')]
  if (q.minSeverity) filters.push(gte('sev', i32(q.minSeverity)))
  if (q.peds) filters.push(eq('peds', i32(1)))
  const page = await abortable(
    arkiv()
      .select({ key: true, attributes: true, payload: true, creator: true })
      .where(filters)
      .createdBy(PUBLISHER)
      .limit(q.limit ?? 30)
      .fetch(),
    signal,
  )
  if (!page.entities.length) return null
  const alerts = await withRetractions(entitiesOf(page).map(decodeAlert), signal)
  return alerts.map(fromArkiv).filter((a) => !a.retraction).sort((a, b) => b.noticeOrder - a.noticeOrder)
}

/** Last time the pipeline reported in, from its on-chain heartbeat (expires after 20 minutes). */
export async function arkivHeartbeat(signal?: AbortSignal): Promise<number | null> {
  const page = await abortable(
    arkiv().select({ key: true, attributes: true }).where(mine('heartbeat')).createdBy(PUBLISHER).limit(10).fetch(),
    signal,
  )
  const times = entitiesOf(page)
    .map((e) => n(((e.attributes ?? {}) as Record<string, Attr>).last_ok))
    .filter((t): t is number => t !== null && Number.isFinite(t))
  return times.length ? Math.max(...times) : null
}
