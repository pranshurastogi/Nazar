# Nazar on Arkiv

Everything about how Nazar uses Arkiv lives in this folder: the data contract, real entities read from the chain, and a runnable script for every query the app runs. No account, key or Nazar server is needed to read any of it.

This is the deep reference. For a quick start (why Arkiv, the entity table and copy-paste SDK examples), see [**Use the data on Arkiv directly**](../docs/arkiv.md). AI agents can do the same through the [MCP server](../docs/mcp.md), and scripts through the [REST API](../docs/api.md#arkiv). How the data gets here: [How Nazar works](../docs/architecture.md).

| | |
|---|---|
| **Network** | Arkiv Tiramisu testnet, chain `7738577` |
| **RPC** | `https://rpc.tiramisu.db-chain.testnet.arkiv.network` (append `/<ARKIV_API_KEY>` for higher limits) |
| **Publisher** | [`0xd06d85Eb20f126f796E4a341b711B1a757c66bD2`](https://tiramisu.explorer.arkiv.network/address/0xd06d85Eb20f126f796E4a341b711B1a757c66bD2), the only `$creator` the app trusts |
| **Project tag** | `project = "nazar-in-batch-alerts"` on every entity |
| **SDK** | `@arkiv-network/sdk` `0.8.0` with `viem` |
| **On chain (18 Oct 2026)** | 21 `notice`, 1,404 `alert`, 0 `retraction`, 1 `heartbeat` (renewed every 5 min) |
| **Browse it** | [nazar-nu.vercel.app/arkiv](https://nazar-nu.vercel.app/arkiv): filters, the live query string, an SDK snippet, attributes vs payload, and a "From my browser" mode |

## What's here

```
arkiv/
├── README.md        you are here: the query reference
├── schema.md        the data contract: entity types, attributes vs payload, lifetimes, flags, write rules, cost
├── friction.md      what was hard while building on Arkiv, with dates and workarounds
├── examples/        real entities read from Tiramisu (pretty JSON)
│   ├── alert-sr13-coldrif.json       COLDRIF batch SR-13: typed attributes + display payload + creation flags
│   ├── notice-who-mpa-n5-2025.json   the WHO alert it links to through its `notice` key attribute
│   └── heartbeat.json                the pipeline's lease-style liveness entity
└── queries/         runnable TypeScript, one file per query the app runs
    ├── nazar.ts                 shared client, PUBLISHER, PROJECT, nazar(t), batchKey(), show()
    ├── check-batch.ts           Q1  batch lookup                eq(batch)
    ├── feed.ts                  Q3  feed since a month          gte(alert_ym) [+ eq(state)], pinned cursor pagination
    ├── child-shield.ts          Q4  paediatric, serious         eq(peds,1) + gte(sev,4)
    ├── heartbeat.ts             Q6  is the pipeline alive?      t = heartbeat
    ├── notice-with-alerts.ts    Q7  notices, then the alerts linked to one   eq(notice, key)
    ├── count.ts                 every entity type, counted at one pinned block
    └── dump-examples.ts         regenerates examples/
```

## Run the queries

```bash
cd arkiv/queries
npm install
npx tsx check-batch.ts SR-13        # 2 official alerts (WHO + curated), severity 5, Child Shield
npx tsx feed.ts 202608 IN-TN        # alerts since Aug 2026 for Tamil Nadu-made batches
npx tsx child-shield.ts             # paediatric products at severity 4+
npx tsx notice-with-alerts.ts       # list notices; pass a notice key to list its alerts
npx tsx heartbeat.ts                # last ok time and expiry of the heartbeat
npx tsx count.ts                    # notice / alert / retraction / heartbeat counts
ARKIV_API_KEY=… npx tsx count.ts    # with an access key, if the public RPC returns HTTP 429
```

The same scripts are wired as npm scripts: `npm run check -- SR-13`, `npm run feed -- 202608 IN-TN`, `npm run child-shield`, `npm run notice`, `npm run heartbeat`, `npm run count`. Each script prints the query it runs.

## The three filters every query uses

```ts
.where(eq('project', str('nazar-in-batch-alerts')), eq('t', str('alert')), …)
.createdBy('0xd06d85Eb20f126f796E4a341b711B1a757c66bD2')
```

- `project` keeps other apps' data out.
- `t` picks the entity type.
- `.createdBy(PUBLISHER)` (`$creator`) means an entity that copies Nazar's tag from another wallet is never shown as official. The creator never changes, so an alert someone else kept alive still passes.

## Query reference

All queries start with the three filters above. Numbers match [`schema.md`](schema.md#queries-the-app-runs).

| # | Question | Predicates after the base three | Script |
|---|---|---|---|
| Q1 | Is this batch flagged? | `eq('batch', str('sr13'))` | `check-batch.ts` |
| Q2 | Alerts on a brand still in date | `eq('brand', str('coldrif')), gte('exp_ym', i32(202610))` | (one line; see below) |
| Q3 | Feed since a month, optionally for a state | `gte('alert_ym', i32(202608))` [`, eq('state', str('IN-TN'))`] | `feed.ts` |
| Q4 | Child Shield | `eq('peds', i32(1)), gte('sev', i32(4))` | `child-shield.ts` |
| Q5 | Batch Passport: every notice that named one batch | `eq('case', str(caseId))` | (one line) |
| Q6 | Is the pipeline alive? | `t = heartbeat` only | `heartbeat.ts` |
| Q7 | Notices (optionally for a month) | `t = notice` [`, eq('notice_ym', i32(202506))`] | `notice-with-alerts.ts` |
| | Alerts from one notice | `eq('notice', key(noticeKey))` | `notice-with-alerts.ts <key>` |
| | Corrections to one alert | `t = retraction, eq('alert', key(alertKey))` | (one line) |

Batch keys use the app's normalisation: lowercase, letters and digits only (`SR-13` → `sr13`, `(N)25567` → `n25567`). Strip a printed label such as "B.No." first. The "Did you mean…?" look-alike step is not a chain query: the app and API fold 0/O, 1/I/L, 5/S, 8/B locally, and a look-alike is never a flag.

### As raw query strings

What the Arkiv node parses, as the SDK builder's `toString()` renders it (and as the `/arkiv` query panel shows it):

```
Q1  project = str('nazar-in-batch-alerts') AND t = str('alert') AND batch = str('sr13') AND $creator = addr(0xd06d85Eb20f126f796E4a341b711B1a757c66bD2)
Q3  project = str('nazar-in-batch-alerts') AND t = str('alert') AND state = str('IN-TN') AND alert_ym >= i32(202608) AND $creator = addr(0xd06d85Eb20f126f796E4a341b711B1a757c66bD2)
Q4  project = str('nazar-in-batch-alerts') AND t = str('alert') AND sev >= i32(4) AND peds = i32(1) AND $creator = addr(0xd06d85Eb20f126f796E4a341b711B1a757c66bD2)
```

### Pagination: pin the block

A cursor is only valid at the block its first page was read at. `page.next()` alone breaks as soon as a new block arrives ([friction.md](friction.md) #11), so rebuild the query for each page:

```ts
const build = () => client.select({ key: true, attributes: true }).where(...filters).createdBy(PUBLISHER).limit(200)

let page = await build().fetch()
const block = page.blockNumber
while (page.hasNextPage() && page.cursor) {
  page = await build().atBlock(block).cursor(page.cursor).fetch()
}
```

For an exact count, pin the first page as well: `count.ts` reads `client.getBlockNumber()` once and adds `.atBlock(head)` to every page. Arkiv returns no particular order, so sort by `alert_ym` yourself for a newest-first feed.

### Verify one entity by key

```ts
const e = await client.getEntity('0x346f83d7a8bed1003081605c0ad3bc76fa953b4eefea2c8a0cc9128ed180fe54')
const official = e.creator?.toLowerCase() === PUBLISHER.toLowerCase()
const nazar = (e.attributes as Record<string, { value: unknown }>).project?.value === 'nazar-in-batch-alerts'
// e.creationFlags → { readonly, permissionlessExtension }, e.expiresAt → expiry block, e.toJson() → payload
```

`getEntity` throws `NoEntityFoundError` for a key that never existed or has expired. The MCP `arkiv_proof` tool runs exactly this check (code: [`Nazar-backend/src/mcp/proof.ts`](../Nazar-backend/src/mcp/proof.ts)).

### Other ways to run the same queries

- **In the app:** [`/arkiv`](https://nazar-nu.vercel.app/arkiv). "Via Nazar API" calls `GET /v1/arkiv/entities` (which reads Arkiv, never Nazar's ledger). "From my browser" sends the query straight from your browser to the public RPC. Both show the query string and a copyable SDK program.
- **Over HTTP:** `GET https://nazar-api-production.up.railway.app/v1/arkiv/entities?type=alert&peds=1&sevMin=4` returns one page with the exact `query` string, a `cursor` and the pinned `block`; pass `cursor` and `block` back for the next page. `GET /v1/arkiv/summary` returns live counts and breakdowns.
- **From an AI assistant:** the MCP `arkiv_proof` tool, at `https://nazar-api-production.up.railway.app/mcp`.

## How an alert is shaped

Taken from [`examples/alert-sr13-coldrif.json`](examples/alert-sr13-coldrif.json):

| Queryable attributes (typed) | Display-only payload (JSON) |
|---|---|
| `batch` `sr13`, `batch_raw` `SR-13`, `sev` 5, `peds` 1, `exp_ym` 202704, `alert_ym` 202510, `state` IN-TN, `cat` adulterated, `fail` glycol, `form`, `brand`, `mfr`, `src`, `juris`, `notice` (key), `case`, `rid`, `conf`, `method`, `tier` | product name, generic, manufacturer and its role, the reason as printed, failure codes, the severity rules that fired, authority, notice title / URL / date, source SHA-256 |

- **Flags:** `readonly` (no one can rewrite an alert, Nazar included; corrections are `retraction` entities) and `permissionlessExtension` (anyone can keep an alert alive while the batch is still on shelves, for example with `pnpm cli keep-alive <entityKey>`).
- **Lifetime:** the alert expires 180 days after the batch's own expiry month.

The other types (`notice`, `retraction`, `heartbeat`, `snapshot`) and every attribute's type are in [`schema.md`](schema.md#entity-types). `snapshot` is defined in the contract, but none are live today; the app's offline copy comes from the API's `/v1/snapshot` and the site's `/data/snapshot.json` instead.

## What stays off Arkiv

- **Source PDFs.** Their SHA-256 is stored on the notice instead.
- **Anything about users.** Checks, the medicine cabinet and photos stay on the device.
- **The search index.** It is a local cache, rebuildable from Arkiv.
