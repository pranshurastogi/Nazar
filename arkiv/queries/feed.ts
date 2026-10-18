// Q3 – the feed: alerts since a month, optionally for one state, with pinned cursor pagination.
//   npx tsx feed.ts 202608 IN-TN
import { i32, str } from '@arkiv-network/sdk/attr'
import { eq, gte } from '@arkiv-network/sdk/query'

import { PUBLISHER, client, nazar } from './nazar.ts'

const since = Number(process.argv[2] ?? 202601)
const state = process.argv[3]
const filters = [...nazar('alert'), gte('alert_ym', i32(since)), ...(state ? [eq('state', str(state))] : [])]
const build = () => client.select({ key: true, attributes: true }).where(...filters).createdBy(PUBLISHER).limit(200)

let page = await build().fetch()
const block = page.blockNumber
let total = page.entities.length
// A cursor is only valid at the block its first page was read at: pin it (page.next() alone breaks
// as soon as a new block arrives – see arkiv/friction.md #11).
while (page.hasNextPage() && page.cursor) {
  page = await build().atBlock(block).cursor(page.cursor).fetch()
  total += page.entities.length
}
console.log(`${total} alert(s) since ${since}${state ? ` in ${state}` : ''} (read at block ${block})`)
