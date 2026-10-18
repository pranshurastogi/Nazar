// Shared setup for the examples: a read-only client and the two filters every Nazar query uses.
import { createPublicClient } from '@arkiv-network/sdk'
import { str } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq } from '@arkiv-network/sdk/query'
import { http } from 'viem'

/** Nazar's publisher wallet. Only entities it created are treated as official ($creator check). */
export const PUBLISHER = '0xd06d85Eb20f126f796E4a341b711B1a757c66bD2' as const
/** Project tag on every Nazar entity, so queries never match other apps' data. */
export const PROJECT = 'nazar-in-batch-alerts'

// Pass an access key (optional, raises rate limits) as ARKIV_API_KEY.
const key = process.env.ARKIV_API_KEY
export const client = createPublicClient({
  chain: tiramisu,
  transport: http(`https://rpc.tiramisu.db-chain.testnet.arkiv.network${key ? `/${key}` : ''}`),
})

export const nazar = (t: 'notice' | 'alert' | 'retraction' | 'heartbeat' | 'snapshot') => [eq('project', str(PROJECT)), eq('t', str(t))]

/** Same normalisation as the app: "SR-13" → "sr13". */
export const batchKey = (b: string) => b.toLowerCase().replace(/[^a-z0-9]/g, '')

type Attr = { type: string; value: unknown }
export function show(e: { key: string; attributes?: unknown; creator?: string; expiresAt?: bigint; toJson(): unknown }) {
  const a = (e.attributes ?? {}) as Record<string, Attr>
  const attrs = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v.value === 'bigint' ? v.value.toString() : v.value]))
  let payload: unknown = null
  try {
    payload = e.toJson()
  } catch {}
  return { key: e.key, creator: e.creator, official: e.creator?.toLowerCase() === PUBLISHER.toLowerCase(), expiresAtBlock: e.expiresAt?.toString(), attributes: attrs, payload }
}
