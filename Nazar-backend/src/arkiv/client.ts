import { createPublicClient, createWalletClient, type PublicArkivClient, type WalletArkivClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { http, webSocket, type Hex } from 'viem'
import { nonceManager, privateKeyToAccount } from 'viem/accounts'

import { arkivHttpUrl, arkivWsUrl, env } from '../config/env.ts'
import { ConfigError } from '../lib/errors.ts'

/**
 * Read and write clients are separate on purpose: the API and indexer only ever
 * get a public client; only the publisher holds a key.
 */
let pub: PublicArkivClient | undefined
export function publicClient(): PublicArkivClient {
  pub ??= createPublicClient({ chain: tiramisu, transport: http(arkivHttpUrl(), { retryCount: 3, timeout: 20_000 }) })
  return pub
}

export function liveClient(): PublicArkivClient {
  return createPublicClient({ chain: tiramisu, transport: webSocket(arkivWsUrl(), { reconnect: true }) })
}

let wallet: WalletArkivClient | undefined
export function walletClient(): WalletArkivClient {
  if (wallet) return wallet
  const pk = env().NAZAR_PUBLISHER_PRIVATE_KEY
  if (!pk) throw new ConfigError('NAZAR_PUBLISHER_PRIVATE_KEY is not set; publishing needs a funded Tiramisu wallet')
  const account = privateKeyToAccount(pk as Hex, { nonceManager })
  wallet = createWalletClient({ chain: tiramisu, account, transport: http(arkivHttpUrl(), { retryCount: 2, timeout: 30_000 }) })
  return wallet
}

export function publisherAddress(): Hex | null {
  const pk = env().NAZAR_PUBLISHER_PRIVATE_KEY
  return pk ? privateKeyToAccount(pk as Hex).address : null
}

export const explorerTx = (tx: string) => `${env().ARKIV_EXPLORER_URL}/tx/${tx}`
export const explorerEntity = (k: string) => `${env().ARKIV_EXPLORER_URL}/entity/${k}`
export const explorerAddress = (a: string) => `${env().ARKIV_EXPLORER_URL}/address/${a}`
