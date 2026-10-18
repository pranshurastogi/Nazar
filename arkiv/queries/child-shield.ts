// Q4 – Child Shield: paediatric formulations at severity 4 or 5.  npx tsx child-shield.ts
import { i32 } from '@arkiv-network/sdk/attr'
import { eq, gte } from '@arkiv-network/sdk/query'

import { PUBLISHER, client, nazar, show } from './nazar.ts'

const page = await client
  .select({ key: true, attributes: true, payload: true, creator: true })
  .where(...nazar('alert'), eq('peds', i32(1)), gte('sev', i32(4)))
  .createdBy(PUBLISHER)
  .limit(50)
  .fetch()
console.log(`${page.entities.length} Child Shield alert(s)`)
for (const e of page.entities) {
  const s = show(e)
  console.log(`- ${s.attributes.batch_raw}  sev ${s.attributes.sev}  ${(s.payload as { product?: string })?.product ?? ''}`)
}
