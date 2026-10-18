// Count every Nazar entity by type (pinned pagination).  npx tsx count.ts
import { PUBLISHER, client, nazar } from './nazar.ts'

const head = await client.getBlockNumber()
for (const t of ['notice', 'alert', 'retraction', 'heartbeat'] as const) {
  const build = () => client.select({ key: true }).where(...nazar(t)).createdBy(PUBLISHER).atBlock(head).limit(200)
  let page = await build().fetch()
  let n = page.entities.length
  while (page.hasNextPage() && page.cursor) {
    page = await build().cursor(page.cursor).fetch()
    n += page.entities.length
  }
  console.log(t.padEnd(10), n)
}
console.log('at block', head.toString())
