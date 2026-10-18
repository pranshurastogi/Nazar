// Q1 – check a batch:  npx tsx check-batch.ts SR-13
import { str } from '@arkiv-network/sdk/attr'
import { eq } from '@arkiv-network/sdk/query'

import { PUBLISHER, batchKey, client, nazar, show } from './nazar.ts'

const batch = process.argv[2] ?? 'SR-13'
const q = client
  .select({ key: true, attributes: true, payload: true, creator: true, expiresAt: true })
  .where(...nazar('alert'), eq('batch', str(batchKey(batch))))
  .createdBy(PUBLISHER)
  .limit(20)
console.log('query:', q.toString())
const page = await q.fetch()
console.log(page.entities.length ? `${page.entities.length} alert(s) for ${batch}` : `No alert found for ${batch} (not a safety certificate)`)
for (const e of page.entities) console.dir(show(e), { depth: 4 })
