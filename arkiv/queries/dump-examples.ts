// Writes real Nazar entities from Tiramisu to ../examples/*.json (one alert, its notice, the heartbeat).
//   npx tsx dump-examples.ts
import { writeFileSync } from 'node:fs'
import { str } from '@arkiv-network/sdk/attr'
import { eq } from '@arkiv-network/sdk/query'

import { PUBLISHER, client, nazar, show } from './nazar.ts'

const fields = { key: true, attributes: true, payload: true, creator: true, owner: true, expiresAt: true, createdAt: true, creationFlags: true } as const
const full = (e: Parameters<typeof show>[0] & { owner?: string; createdAt?: bigint; creationFlags?: unknown }) => ({
  ...show(e),
  owner: e.owner,
  createdAtBlock: e.createdAt?.toString(),
  creationFlags: e.creationFlags,
  explorer: `https://tiramisu.explorer.arkiv.network/entity/${e.key}`,
})
const write = (name: string, data: unknown) => {
  writeFileSync(new URL(`../examples/${name}.json`, import.meta.url), JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n')
  console.log('wrote', name)
}

const alert = (await client.select(fields).where(...nazar('alert'), eq('batch', str('sr13')), eq('src', str('who-mpa'))).createdBy(PUBLISHER).limit(1).fetch()).entities[0]
if (alert) {
  write('alert-sr13-coldrif', full(alert))
  const noticeKey = String((alert.attributes as Record<string, { value: unknown }>).notice?.value)
  const notice = await client.getEntity(noticeKey as `0x${string}`)
  write('notice-who-mpa-n5-2025', full(notice as never))
}
const hb = (await client.select(fields).where(...nazar('heartbeat')).createdBy(PUBLISHER).limit(1).fetch()).entities[0]
if (hb) write('heartbeat', full(hb))
