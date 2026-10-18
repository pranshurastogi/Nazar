# Nazar on Arkiv

Everything about how Nazar uses Arkiv lives in this folder. Start with the data contract, look at real entities, then run the queries yourself. No account, key or Nazar server is needed.

| | |
|---|---|
| **Network** | Tiramisu testnet, chain `7738577` |
| **Publisher** | [`0xd06d85Eb20f126f796E4a341b711B1a757c66bD2`](https://tiramisu.explorer.arkiv.network/address/0xd06d85Eb20f126f796E4a341b711B1a757c66bD2) (the only `$creator` the app trusts) |
| **Project tag** | `project = "nazar-in-batch-alerts"` on every entity |
| **On chain (18 Oct 2026)** | 21 `notice`, 1,404 `alert`, 1 `heartbeat` (renewed every 5 min) |
| **Browse it** | in the app at [nazar-nu.vercel.app/arkiv](https://nazar-nu.vercel.app/arkiv): filters, live query string, attributes vs payload |

## What's here

```
arkiv/
├── README.md        you are here
├── schema.md        the data contract: entity types, attributes vs payload, lifetimes, flags, write rules, queries
├── friction.md      what was hard while building on Arkiv, with dates and workarounds
├── examples/        real entities read from Tiramisu (pretty JSON)
│   ├── alert-sr13-coldrif.json       COLDRIF batch SR-13: typed attributes + display payload + creation flags
│   ├── notice-who-mpa-n5-2025.json   the WHO alert it links to through its `notice` key attribute
│   └── heartbeat.json                the pipeline's lease-style liveness entity
└── queries/         runnable TypeScript, one file per query the app runs
    ├── nazar.ts                 shared client, PUBLISHER, PROJECT, batchKey()
    ├── check-batch.ts           Q1  batch lookup             eq(batch)
    ├── feed.ts                  Q3  feed since a month       gte(alert_ym) [+ eq(state)], pinned cursor pagination
    ├── child-shield.ts          Q4  paediatric, serious      eq(peds,1) + gte(sev,4)
    ├── notice-with-alerts.ts    Q7/Q5 notices, and the alerts linked to one   eq(notice, key)
    ├── heartbeat.ts             Q6  is the pipeline alive?
    ├── count.ts                 every entity type, counted
    └── dump-examples.ts         regenerates examples/
```

## Run the queries

```bash
cd arkiv/queries
npm install
npx tsx check-batch.ts SR-13        # 2 official alerts (WHO + curated), severity 5, Child Shield
npx tsx feed.ts 202608 IN-TN        # alerts since Aug 2026 for Tamil Nadu-made batches
npx tsx child-shield.ts
npx tsx notice-with-alerts.ts       # list notices; pass a notice key to list its alerts
npx tsx heartbeat.ts
npx tsx count.ts
```

AI assistants can do the same through Nazar's MCP server (`https://nazar-api-production.up.railway.app/mcp`): its `arkiv_proof` tool reads an entity directly from Arkiv with `getEntity`, never from Nazar's database, and reports its attributes, payload, creator, whether that creator is the publisher above, its flags and expiry.

Every query starts with `eq("project", …)`, `eq("t", …)` and `.createdBy(PUBLISHER)`. The first two keep other apps' data out. The third means an entity copied by someone else is never shown as official. The anonymous public RPC is rate limited, so set `ARKIV_API_KEY` if you hit HTTP 429.

## How an alert is shaped

Taken from [`examples/alert-sr13-coldrif.json`](examples/alert-sr13-coldrif.json):

| Queryable attributes (typed) | Display-only payload (JSON) |
|---|---|
| `batch` `sr13`, `batch_raw` `SR-13`, `sev` 5, `peds` 1, `exp_ym` 202704, `alert_ym` 202510, `state` IN-TN, `cat` adulterated, `fail` glycol, `form` syrup, `src`, `notice` (key), `case`, `rid`, `conf`, `tier` | product name, generic, manufacturer and its role, the reason as printed, failure codes, the severity rules that fired, authority, notice title / URL / date, source SHA-256 |

- **Flags:** `readonly` (no one can rewrite an alert, Nazar included; corrections are `retraction` entities) and `permissionlessExtension` (anyone can keep an alert alive while the batch is still on shelves).
- **Lifetime:** the alert expires 180 days after the batch's own expiry month.

## What stays off Arkiv

- **Source PDFs.** Their SHA-256 is stored on the notice instead.
- **Anything about users.** Checks, the medicine cabinet and photos stay on the device.
- **The search index.** It is a local cache, rebuildable from Arkiv.
