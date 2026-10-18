# Use the data on Arkiv directly

Nazar's database is public. Every alert Nazar publishes is an entity on [Arkiv](https://arkiv.network), and you can read all of it with the Arkiv SDK: **no Nazar account, key or server is needed**. This page is the quick start: why Arkiv is the source of truth, the entity types, copy-paste SDK examples and the raw query strings. The deep reference (runnable scripts, the full query table, real entities) is [`arkiv/README.md`](../arkiv/README.md), and the full data contract is [`arkiv/schema.md`](../arkiv/schema.md).

**Contents**

- [Why Arkiv is the source of truth](#why-arkiv-is-the-source-of-truth)
- [Network and publisher](#network-and-publisher)
- [Entity types](#entity-types)
- [Copy-paste SDK examples](#copy-paste-sdk-examples)
- [Pagination must pin the block](#pagination-must-pin-the-block)
- [Raw query strings](#raw-query-strings)
- [Runnable scripts](#runnable-scripts)
- [Other ways to run the same queries](#other-ways-to-run-the-same-queries)
- [Keep an alert alive](#keep-an-alert-alive)

## Why Arkiv is the source of truth

- **Anyone can verify it.** Each alert is created by one publisher wallet and links to the regulator notice it came from, which stores the SHA-256 of the downloaded document.
- **Nobody can rewrite it.** Alerts are `readonly`, Nazar included. Corrections are new `retraction` entities, never silent edits.
- **Anyone can keep it alive.** Alerts allow `permissionlessExtension`: a chemist or an NGO can extend an alert while the batch is still on shelves.
- **Nazar's servers are only caches.** The SQLite ledger and search index can be rebuilt from Arkiv. A fresh server did exactly that: it adopted every published alert by row id and published zero duplicates.
- **The app reads it directly.** When the Nazar API is down, the web app queries Arkiv from the browser ([fallback chain](architecture.md#the-fallback-chain)).
- **Lifetimes follow product logic.** An alert lives until the batch expires + 180 days.

## Network and publisher

| | |
|---|---|
| **Network** | Arkiv Tiramisu testnet, chain `7738577`, RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network` |
| **Publisher (`$creator`)** | [`0xd06d85Eb20f126f796E4a341b711B1a757c66bD2`](https://tiramisu.explorer.arkiv.network/address/0xd06d85Eb20f126f796E4a341b711B1a757c66bD2) |
| **Project tag** | `project = "nazar-in-batch-alerts"` on every entity |
| **Live (18 Oct 2026)** | 21 `notice`, 1,404 `alert`, 0 `retraction`, 1 `heartbeat` (live counts: [`/v1/arkiv/summary`](https://nazar-api-production.up.railway.app/v1/arkiv/summary)) |
| **SDK** | [`@arkiv-network/sdk`](https://www.npmjs.com/package/@arkiv-network/sdk) `0.8.0` with `viem` |

**Always filter by all three:** `eq('project', …)`, `eq('t', …)` and `.createdBy(PUBLISHER)`. The first two keep other apps' data out. The third means an entity copied by someone else is never shown as official.

## Entity types

Every entity carries `project`, `t` (type) and `v` (schema version). What you query is a typed attribute; display detail is in the JSON payload. The full contract, with every attribute's type, is in [`arkiv/schema.md`](../arkiv/schema.md#entity-types).

| `t` | One entity is | Key attributes | Payload | Lifetime, flags |
|---|---|---|---|---|
| `notice` | one regulator document | `src`, `juris`, `notice_ym`, `sha` (SHA-256 of the document), `rows`, `parser` | title, authority, URL, date | 5 years, `readonly` |
| `alert` | one batch named in a notice | `batch` (match key: `SR-13` → `sr13`), `batch_raw`, `sev` (1–5), `peds` (0/1), `cat`, `fail`, `form`, `state` (e.g. `IN-TN`), `mfg_ym`, `exp_ym`, `alert_ym`, `src`, `juris`, `notice` (key of the parent notice), `case`, `rid`, `brand`, `mfr`, `plant`, `conf`, `method`, `tier` | product, generic, manufacturer and its role, reason as printed, severity rules, notice title, URL, date and SHA-256 | batch expiry + 180 days; `readonly` + `permissionlessExtension` |
| `retraction` | a correction to an alert | `alert` (key), `case`, `reason`, `src` | note | alert's remaining life + 1 year, `readonly` |
| `heartbeat` | the pipeline's liveness lease | `worker`, `last_ok` (ms) | per-source last checks, alert count, version | 20 minutes, renewed every 5 |
| `snapshot` | daily pack of batch keys | `day`, `count`, `sha` | batch keys | 7 days, `readonly` (defined in the contract; none are live today) |

Months are `YYYYMM` integers (`202704`), so ranges work with `gte`/`lte`. Real entities read from the chain are in [`arkiv/examples/`](../arkiv/examples): the [SR-13 alert](../arkiv/examples/alert-sr13-coldrif.json), [its WHO notice](../arkiv/examples/notice-who-mpa-n5-2025.json) and [the heartbeat](../arkiv/examples/heartbeat.json).

## Copy-paste SDK examples

```bash
npm install @arkiv-network/sdk@0.8.0 viem
```

Shared setup for every example below:

```ts
import { createPublicClient } from '@arkiv-network/sdk'
import { i32, key, str } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq, gte } from '@arkiv-network/sdk/query'
import { http } from 'viem'

const PUBLISHER = '0xd06d85Eb20f126f796E4a341b711B1a757c66bD2'
const PROJECT = 'nazar-in-batch-alerts'
const client = createPublicClient({ chain: tiramisu, transport: http('https://rpc.tiramisu.db-chain.testnet.arkiv.network') })

/** The two filters every Nazar query starts with. */
const nazar = (t: 'notice' | 'alert' | 'retraction' | 'heartbeat') => [eq('project', str(PROJECT)), eq('t', str(t))]
/** Same normalisation as the app: "SR-13" → "sr13". Pass the batch alone, without "B.No.". */
const matchKey = (b: string) => b.toLowerCase().replace(/[^a-z0-9]/g, '')
```

### 1. Check a batch

The app's Q1:

```ts
const page = await client
  .select({ key: true, attributes: true, payload: true, creator: true })
  .where(...nazar('alert'), eq('batch', str(matchKey('SR-13'))))
  .createdBy(PUBLISHER)
  .limit(20)
  .fetch()

if (!page.entities.length) console.log('No alert found (not a safety certificate)')
for (const e of page.entities) {
  const p = e.toJson() as { product: string; reason: string; authority: string; noticeTitle: string; noticeUrl: string }
  console.log(e.key, p.product, '|', p.reason, '|', p.authority, p.noticeTitle, p.noticeUrl)
}
```

An exact query cannot suggest look-alikes: the "Did you mean…?" step (0/O, 1/I/L, 5/S, 8/B) is done by the app and the API. To see whether an alert was corrected, look for a retraction that points at it:

```ts
const fixes = await client.select({ key: true, attributes: true, payload: true })
  .where(...nazar('retraction'), eq('alert', key(page.entities[0].key)))
  .createdBy(PUBLISHER).fetch()
```

### 2. Recent alerts for one state

Q3, with pinned pagination:

```ts
const build = () =>
  client
    .select({ key: true, attributes: true, payload: true })
    .where(...nazar('alert'), gte('alert_ym', i32(202608)), eq('state', str('IN-TN')))
    .createdBy(PUBLISHER)
    .limit(200)

let page = await build().fetch()
const block = page.blockNumber          // pin every later page to this block
const alerts = [...page.entities]
while (page.hasNextPage() && page.cursor) {
  page = await build().atBlock(block).cursor(page.cursor).fetch()
  alerts.push(...page.entities)
}
// Arkiv returns no particular order: sort newest first yourself.
const ym = (e: (typeof alerts)[number]) => Number((e.attributes as Record<string, { value: unknown }>).alert_ym.value)
alerts.sort((a, b) => ym(b) - ym(a))
console.log(`${alerts.length} alert(s) for Tamil Nadu-made batches since Aug 2026, read at block ${block}`)
```

Child Shield (Q4) is the same shape: `eq('peds', i32(1)), gte('sev', i32(4))`. Batch Passport (Q5), every notice that named one batch: `eq('case', str(caseId))`.

### 3. A notice and every alert linked to it

Q7, then the `notice` key attribute:

```ts
const notices = await client.select({ key: true, attributes: true, payload: true })
  .where(...nazar('notice')).createdBy(PUBLISHER).limit(50).fetch()
const notice = notices.entities[0]
console.log((notice.toJson() as { title: string }).title)

const linked = await client.select({ key: true, attributes: true })
  .where(...nazar('alert'), eq('notice', key(notice.key)))
  .createdBy(PUBLISHER).limit(200).fetch()
console.log(`${linked.entities.length} alert(s) on the first page`)
```

### 4. Is the pipeline alive?

Q6. The heartbeat lives 20 minutes and is renewed every 5, so no heartbeat means the pipeline has stopped:

```ts
const hb = await client.select({ key: true, attributes: true, expiresAt: true })
  .where(...nazar('heartbeat')).createdBy(PUBLISHER).limit(5).fetch()
const lastOk = Number((hb.entities[0]?.attributes as Record<string, { value: unknown }> | undefined)?.last_ok?.value ?? 0)
console.log(hb.entities.length ? `last ok ${new Date(lastOk).toISOString()}` : 'no live heartbeat: the pipeline is paused')
```

### 5. Verify one entity

Is it really from Nazar? Read it by key, straight from the chain:

```ts
const e = await client.getEntity('0x346f83d7a8bed1003081605c0ad3bc76fa953b4eefea2c8a0cc9128ed180fe54') // SR-13 alert
const attrs = e.attributes as Record<string, { value: unknown }>
console.log({
  official: e.creator?.toLowerCase() === PUBLISHER.toLowerCase(), // created by the Nazar publisher
  nazarProject: attrs.project?.value === PROJECT,                 // carries Nazar's project tag
  flags: e.creationFlags,                                         // readonly, permissionlessExtension
  expiresAtBlock: e.expiresAt,
})
```

`getEntity` throws `NoEntityFoundError` when the key never existed or has expired. This is the same check the MCP [`arkiv_proof`](mcp.md#tools) tool runs.

## Pagination must pin the block

A cursor is only valid at the block where its first page was read. `page.next()` breaks as soon as a new block arrives, so always rebuild the query with `.atBlock(firstPage.blockNumber).cursor(page.cursor)`, as in example 2. To count consistently, pin the first page too: `.atBlock(await client.getBlockNumber())`. Background: [`arkiv/friction.md`](../arkiv/friction.md).

## Raw query strings

The `/arkiv` page's query panel shows the exact text the Arkiv node parses (what the SDK's `toString()` renders). Check a batch:

```
project = str('nazar-in-batch-alerts') AND t = str('alert') AND batch = str('sr13') AND $creator = addr(0xd06d85Eb20f126f796E4a341b711B1a757c66bD2)
```

Child Shield, severity 4+:

```
project = str('nazar-in-batch-alerts') AND t = str('alert') AND sev >= i32(4) AND peds = i32(1) AND $creator = addr(0xd06d85Eb20f126f796E4a341b711B1a757c66bD2)
```

Alerts linked to a notice: `… AND t = str('alert') AND notice = key(0x…) AND $creator = addr(…)`.

## Runnable scripts

[`arkiv/queries/`](../arkiv/queries) has one TypeScript file per query the app runs. The full list, the query table (Q1–Q7) and the npm script aliases are in [`arkiv/README.md`](../arkiv/README.md#run-the-queries).

```bash
cd arkiv/queries
npm install
npx tsx check-batch.ts SR-13        # Q1: 2 official alerts, severity 5, Child Shield
npx tsx feed.ts 202608 IN-TN        # Q3: since Aug 2026, Tamil Nadu-made, pinned pagination
npx tsx child-shield.ts             # Q4: paediatric, severity 4+
npx tsx notice-with-alerts.ts       # Q7: list notices; pass a notice key to list its alerts
npx tsx heartbeat.ts                # Q6: is the pipeline alive?
npx tsx count.ts                    # every entity type, counted at one block
```

The public RPC is rate limited. Set `ARKIV_API_KEY` (an access key from the Arkiv hub) if you hit HTTP 429.

## Other ways to run the same queries

- **In the browser:** the [Arkiv directory](https://nazar-nu.vercel.app/arkiv) has two run modes. **Via Nazar API** uses `GET /v1/arkiv/entities` (which itself reads Arkiv, never the ledger). **From my browser** sends the same query straight to the public Arkiv RPC, with no Nazar server involved. Each filter shows up in the query string and in a copyable SDK program. See [features → Arkiv directory](features.md#arkiv-directory).
- **Over HTTP:** [`GET /v1/arkiv/entities`](api.md#get-v1arkiventities) returns one page with the exact `query` string, a `cursor` and the pinned `block`; [`GET /v1/arkiv/summary`](api.md#get-v1arkivsummary) returns live counts and breakdowns.
- **From an AI assistant:** the MCP [`arkiv_proof`](mcp.md#tools) tool.

## Keep an alert alive

Alerts carry `permissionlessExtension`, so any wallet can call `extendEntity` on a Nazar alert while the batch is still on shelves. The creator never changes, so a kept-alive alert still passes `.createdBy(PUBLISHER)`. The reference client is `pnpm cli keep-alive <entityKey> --days 180 [--live]` in the backend; the rules are in [`arkiv/schema.md`](../arkiv/schema.md#keep-alive-permissionless-no-endpoint).
