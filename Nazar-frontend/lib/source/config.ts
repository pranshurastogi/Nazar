// Public runtime config. NEXT_PUBLIC_* values are inlined at build time.

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export const API_URL = trimSlash(process.env.NEXT_PUBLIC_NAZAR_API_URL || 'http://localhost:8787')
export const ARKIV_RPC_URL = process.env.NEXT_PUBLIC_ARKIV_RPC_URL || 'https://rpc.tiramisu.db-chain.testnet.arkiv.network'
export const PUBLISHER = (process.env.NEXT_PUBLIC_NAZAR_PUBLISHER || '0xd06d85Eb20f126f796E4a341b711B1a757c66bD2') as `0x${string}`
export const EXPLORER_URL = 'https://tiramisu.explorer.arkiv.network'

/** Arkiv project tag; must match Nazar-backend/src/arkiv/schema.ts. */
export const PROJECT = 'nazar-in-batch-alerts'

export const explorerEntity = (key: string) => `${EXPLORER_URL}/entity/${key}`
export const explorerTx = (tx: string) => `${EXPLORER_URL}/tx/${tx}`
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`
