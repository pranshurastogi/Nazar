// Q7 + Q5 – a regulator notice and every alert that links to it via the `notice` key attribute.
//   npx tsx notice-with-alerts.ts            (latest notices)
//   npx tsx notice-with-alerts.ts 0xNOTICEKEY
import { key } from '@arkiv-network/sdk/attr'
import { eq } from '@arkiv-network/sdk/query'

import { PUBLISHER, client, nazar, show } from './nazar.ts'

const noticeKey = process.argv[2] as `0x${string}` | undefined
if (!noticeKey) {
  const notices = await client.select({ key: true, attributes: true, payload: true }).where(...nazar('notice')).createdBy(PUBLISHER).limit(50).fetch()
  for (const n of notices.entities) {
    const s = show(n)
    console.log(`${s.key}  ${s.attributes.src}  ${s.attributes.notice_ym}  rows ${s.attributes.rows}  ${(s.payload as { title?: string })?.title ?? ''}`)
  }
  console.log('\nPass a notice key to list its alerts.')
} else {
  const alerts = await client.select({ key: true, attributes: true }).where(...nazar('alert'), eq('notice', key(noticeKey))).createdBy(PUBLISHER).limit(200).fetch()
  console.log(`${alerts.entities.length} alert(s) on the first page for notice ${noticeKey}`)
  for (const a of alerts.entities.slice(0, 20)) console.log(' -', show(a).attributes.batch_raw, 'sev', show(a).attributes.sev)
}
