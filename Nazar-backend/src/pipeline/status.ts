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

export interface PipelineStatus {
  heartbeat: { lastOkMs: number; entityKey: string | null } | null
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
}): Promise<PipelineStatus> {
  const lastOk = o.ledger.getKv('heartbeat:lastOkMs')
  const sources: Record<string, SourceCheck> = {}
  const rows = o.ledger.db.prepare("SELECT key, value FROM kv WHERE key LIKE 'source:%:last'").all() as { key: string; value: string }[]
  for (const r of rows) {
    try {
      sources[r.key.slice(SOURCE_PREFIX.length, -SOURCE_SUFFIX.length)] = JSON.parse(r.value) as SourceCheck
    } catch {}
  }
  return {
    heartbeat: lastOk ? { lastOkMs: Number(lastOk), entityKey: o.ledger.getKv('heartbeat:entityKey') ?? null } : null,
    runs: o.ledger.recentRuns(o.runs ?? 10),
    stats: o.ledger.stats(),
    publisher: o.address ? { address: o.address, balanceGlm: o.client ? await publisherBalance(o.client, o.address) : null } : null,
    mode: o.mode,
    sources,
  }
}
