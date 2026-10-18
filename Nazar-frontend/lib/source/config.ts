// Public runtime config. NEXT_PUBLIC_* values are inlined at build time.

const trimSlash = (s: string) => s.replace(/\/+$/, '')

/**
 * The Nazar API is optional. `next dev` defaults to a local backend; a production build
 * only calls an API it was explicitly given, so a deployed HTTPS site never probes the
 * visitor's own localhost. Without one, answers come from Arkiv, then demo data.
 * "off" disables the API in development too.
 */
function apiUrl(): string | null {
  // Same-origin proxy (next.config.mjs, set by NAZAR_API_ORIGIN) wins: no CORS, edge-cached GETs.
  const proxy = process.env.NEXT_PUBLIC_NAZAR_API_PROXY?.trim()
  if (proxy && process.env.NEXT_PUBLIC_NAZAR_API_URL?.trim().toLowerCase() !== 'off') return trimSlash(proxy)
  const configured = process.env.NEXT_PUBLIC_NAZAR_API_URL?.trim()
  if (configured) return configured.toLowerCase() === 'off' ? null : trimSlash(configured)
  return process.env.NODE_ENV === 'development' ? 'http://localhost:8787' : null
}

export const API_URL = apiUrl()
export const ARKIV_RPC_URL = process.env.NEXT_PUBLIC_ARKIV_RPC_URL || 'https://rpc.tiramisu.db-chain.testnet.arkiv.network'
export const PUBLISHER = (process.env.NEXT_PUBLIC_NAZAR_PUBLISHER || '0xd06d85Eb20f126f796E4a341b711B1a757c66bD2') as `0x${string}`
export const EXPLORER_URL = 'https://tiramisu.explorer.arkiv.network'

/** Arkiv project tag; must match Nazar-backend/src/arkiv/schema.ts. */
export const PROJECT = 'nazar-in-batch-alerts'

export const explorerEntity = (key: string) => `${EXPLORER_URL}/entity/${key}`
export const explorerTx = (tx: string) => `${EXPLORER_URL}/tx/${tx}`
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`
