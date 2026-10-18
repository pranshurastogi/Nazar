// Q6 – is the pipeline alive? The heartbeat entity lives 20 minutes and is renewed every 5.
//   npx tsx heartbeat.ts
import { PUBLISHER, client, nazar, show } from './nazar.ts'

const page = await client.select({ key: true, attributes: true, payload: true, expiresAt: true, creator: true }).where(...nazar('heartbeat')).createdBy(PUBLISHER).limit(5).fetch()
if (!page.entities.length) console.log('No live heartbeat: the pipeline is paused (or its heartbeat expired).')
for (const e of page.entities) {
  const s = show(e)
  const lastOk = Number(s.attributes.last_ok)
  console.log(`heartbeat ${s.key}: last ok ${new Date(lastOk).toISOString()} (${Math.round((Date.now() - lastOk) / 60000)} min ago), expires at block ${s.expiresAtBlock}`)
}
