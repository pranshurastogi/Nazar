import type { PublicArkivClient } from '@arkiv-network/sdk'
import { formatEther, type Hex } from 'viem'

import type { Ledger } from '../storage/ledger.ts'

/** Per-source bookkeeping in the ledger's kv table, shared by the run loop, heartbeat, API and CLI. */

export interface SourceCheck {
  lastCheckedMs: number
  ok: boolean
  docs: number
  alerts?: number
  error?: string | null
}

const SOURCE_PREFIX = 'source:'
const SOURCE_SUFFIX = ':last'

export function recordSourceCheck(ledger: Ledger, sourceId: string, check: SourceCheck) {
  ledger.setKv(`${SOURCE_PREFIX}${sourceId}${SOURCE_SUFFIX}`, JSON.stringify(check))
}

export function sourceLastCheck(ledger: Ledger, sourceId: string): SourceCheck | null {
  const raw = ledger.getKv(`${SOURCE_PREFIX}${sourceId}${SOURCE_SUFFIX}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SourceCheck
  } catch {
    return null
  }
}

/** Compact form for the heartbeat payload. */
export function sourceLastChecks(ledger: Ledger): Record<string, { lastCheckedMs: number; ok: boolean; docs: number }> {
  const rows = ledger.db.prepare("SELECT key, value FROM kv WHERE key LIKE 'source:%:last'").all() as { key: string; value: string }[]
  const out: Record<string, { lastCheckedMs: number; ok: boolean; docs: number }> = {}
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value) as SourceCheck
      out[r.key.slice(SOURCE_PREFIX.length, -SOURCE_SUFFIX.length)] = { lastCheckedMs: v.lastCheckedMs, ok: v.ok, docs: v.docs }
    } catch {}
  }
  return out
}

export const HEARTBEAT_LAST = 'heartbeat:last'
/** The heartbeat lives 20 minutes; older than that and the pipeline is offline. */
export const HEARTBEAT_STALE_MS = 20 * 60 * 1000

/** What the last beat did, kept in the ledger for /v1/pipeline/status. */
export interface HeartbeatRecord {
  mode: 'dry-run' | 'live'
  action: 'created' | 'renewed' | 'dry-run'
  atMs: number
  entityKey: string | null
  txHash: string | null
}

export function lastHeartbeat(ledger: Ledger): HeartbeatRecord | null {
  const raw = ledger.getKv(HEARTBEAT_LAST)
  if (!raw) return null
  try {
    return JSON.parse(raw) as HeartbeatRecord
  } catch {
    return null
  }
}

export interface HeartbeatStatus {
  lastOkMs: number
  entityKey: string | null
  /** dry-run beats are local only; live beats are entities on Arkiv. */
  mode: 'dry-run' | 'live' | null
  action: HeartbeatRecord['action'] | null
  txHash: string | null
  ageMs: number
  /** Older than the heartbeat's 20-minute life: the pipeline is not running. */
  stale: boolean
  /** The newest heartbeat entity read from Arkiv (when a reader is wired), so a separate API host sees the truth. */
  chain: { entityKey: string; lastOkMs: number; expiresAtBlock: string | null } | null
}

export interface PipelineStatus {
  heartbeat: HeartbeatStatus | null
  runs: unknown[]
  stats: ReturnType<Ledger['stats']>
  publisher: { address: string; balanceGlm: string | null } | null
  mode: 'dry-run' | 'live'
  sources: Record<string, SourceCheck>
}

let balanceCache: { address: string; at: number; value: string | null } | undefined

/** Publisher balance, cached for a minute so a busy status endpoint never hammers the RPC. */
export async function publisherBalance(client: Pick<PublicArkivClient, 'getBalance'>, address: Hex, ttlMs = 60_000): Promise<string | null> {
  if (balanceCache && balanceCache.address === address && Date.now() - balanceCache.at < ttlMs) return balanceCache.value
  let value: string | null = null
  try {
    value = formatEther(await client.getBalance({ address }))
  } catch {
    value = null
  }
  balanceCache = { address, at: Date.now(), value }
  return value
}

export async function pipelineStatus(o: {
  ledger: Ledger
  mode: 'dry-run' | 'live'
  address: Hex | null
  client?: Pick<PublicArkivClient, 'getBalance'> | null
  runs?: number
  /** On-chain heartbeat (Q6); errors and slow answers are ignored. */
  chainHeartbeat?: (() => Promise<{ entityKey: string; lastOkMs: number; expiresAtBlock: string | null } | null>) | null
  now?: () => number
}): Promise<PipelineStatus> {
  const now = o.now?.() ?? Date.now()
  const lastOk = o.ledger.getKv('heartbeat:lastOkMs')
  const last = lastHeartbeat(o.ledger)
  const chain = o.chainHeartbeat
    ? await Promise.race([o.chainHeartbeat().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000).unref())])
    : null
  const lastOkMs = Math.max(lastOk ? Number(lastOk) : 0, chain?.lastOkMs ?? 0)
  const heartbeat: HeartbeatStatus | null = lastOkMs
    ? {
        lastOkMs,
        entityKey: chain?.entityKey ?? o.ledger.getKv('heartbeat:entityKey') ?? null,
        mode: last?.mode ?? (chain ? 'live' : null),
        action: last?.action ?? null,
        txHash: last?.txHash ?? null,
        ageMs: Math.max(0, now - lastOkMs),
        stale: now - lastOkMs > HEARTBEAT_STALE_MS,
        chain: chain ? { entityKey: chain.entityKey, lastOkMs: chain.lastOkMs, expiresAtBlock: chain.expiresAtBlock } : null,
      }
    : null
  const sources: Record<string, SourceCheck> = {}
  const rows = o.ledger.db.prepare("SELECT key, value FROM kv WHERE key LIKE 'source:%:last'").all() as { key: string; value: string }[]
  for (const r of rows) {
    try {
      sources[r.key.slice(SOURCE_PREFIX.length, -SOURCE_SUFFIX.length)] = JSON.parse(r.value) as SourceCheck
    } catch {}
  }
  return {
    heartbeat,
    runs: o.ledger.recentRuns(o.runs ?? 10),
    stats: o.ledger.stats(),
    publisher: o.address ? { address: o.address, balanceGlm: o.client ? await publisherBalance(o.client, o.address) : null } : null,
    mode: o.mode,
    sources,
  }
}
