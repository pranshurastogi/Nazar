import { formatEther } from 'viem'

/**
 * Funding UX. The Tiramisu faucet needs a human (it is behind a captcha), so when the publisher is
 * short we stop before sending anything and print exactly what to paste where.
 */

export const FAUCET_URL = 'https://hub.arkiv.network/faucet'

/** Trim a GLM amount to something readable without hiding tiny testnet costs. */
export function glm(wei: bigint): string {
  const s = formatEther(wei)
  const [i, f = ''] = s.split('.')
  const trimmed = f.slice(0, 6).replace(/0+$/, '')
  if (!trimmed && wei > 0n) return `${s.slice(0, 12)}`
  return trimmed ? `${i}.${trimmed}` : i!
}

export function fundingInstructions(o: { address: string; balanceWei: bigint; neededWei: bigint; what: string; rerun?: string }): string {
  const short = o.neededWei > o.balanceWei ? o.neededWei - o.balanceWei : 0n
  return [
    `The publisher wallet does not have enough GLM on Arkiv Tiramisu (chain 7738577).`,
    `  address  ${o.address}`,
    `  balance  ${glm(o.balanceWei)} GLM`,
    `  needed   ~${glm(o.neededWei)} GLM for ${o.what}`,
    `  short    ${glm(short)} GLM`,
    ``,
    `To fund it:`,
    `  1. Open ${FAUCET_URL}`,
    `  2. Paste this address and request testnet GLM:`,
    `       ${o.address}`,
    `  3. Check the balance:  pnpm cli wallet:balance`,
    `  4. Then run again:     ${o.rerun ?? 'pnpm cli publish --live'}`,
    ``,
    `Nothing was sent.`,
  ].join('\n')
}
