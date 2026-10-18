# Nazar on Arkiv: data contract

Nazar publishes Indian drug-regulator alerts (CDSCO and state drug controllers) as entities on the **Arkiv Tiramisu testnet** (chain `7738577`). Arkiv is the source of truth. Every Nazar database is a cache that can be rebuilt from these entities.

This file covers what we write, why each field is an attribute or payload, how long each entity type lives, and the exact queries the app runs. The code is in [`Nazar-backend/src/arkiv/schema.ts`](../Nazar-backend/src/arkiv/schema.ts).

## Who writes

| Role | Address | Writes |
|---|---|---|
| Publisher | `0xd06d85Eb20f126f796E4a341b711B1a757c66bD2` | `notice`, `alert`, `retraction`, `heartbeat`, `snapshot` |

Explorer: <https://tiramisu.explorer.arkiv.network/address/0xd06d85Eb20f126f796E4a341b711B1a757c66bD2>

Every read filters by `$creator` through `.createdBy(PUBLISHER)`. Anyone can write an entity that copies our `project` tag. Only entities created by the publisher wallet show as official alerts. Anything else is ignored, or labelled "Not from a listed publisher".

## Common attributes (every entity)

| Attribute | Type | Value |
|---|---|---|
| `project` | str | `nazar-in-batch-alerts`, unique, so our queries never match other apps |
| `t` | str | entity type: `notice`, `alert`, `retraction`, `heartbeat`, `snapshot` |
| `v` | i32 | schema version (currently `1`) |

Anything a query filters or ranges over is a typed attribute. Months are stored as `YYYYMM` integers so `gte`/`lte` work. Anything only displayed (long product names, full manufacturer address, severity reasoning, notice title) goes in the JSON payload.

## Entity types

### `notice`: one regulator document

| Attribute | Type | Example |
|---|---|---|
| `src` | str | `cdsco-pdf`, `cdsco-online`, `tn-dc`, `mh-fda`, `who-mpa`, `curated` |
| `juris` | str | `IN`, `IN-TN`, `IN-MH` (ISO 3166-2) |
| `notice_ym` | i32 | `202506` |
| `sha` | str | SHA-256 of the exact bytes we downloaded |
| `rows` | i32 | number of batch rows extracted |
| `parser` | str | `cdsco-modern@1` |

- **Payload:** title, authority, URL, publish date, sha256, parser, method.
- **Lifetime:** 5 years. It is the evidence behind every alert.
- **Flags:** `readonly`.

### `alert`: one batch named in a notice

| Attribute | Type | Why it is an attribute |
|---|---|---|
| `batch` | str | normalised batch key (`SR-13` → `sr13`), used for the core lookup |
| `batch_raw` | str | batch as printed |
| `case` | str | joins the same batch across notices (Batch Passport) |
| `rid` | str | `hash(source sha, row, parser)`, which makes publishing idempotent |
| `brand` | str | brand slug, at most 48 bytes, cut at a word boundary (`coldrif`) |
| `form` | str | `syrup`, `tablet`, `injection`… |
| `cat` | str | `nsq`, `spurious`, `adulterated`, `misbranded` |
| `fail` | str | top failure code (`glycol`, `assay`, `dissolution`…) |
| `sev` | i32 | severity 1–5, range-queried |
| `peds` | i32 | 1 for paediatric formulations (Child Shield) |
| `mfr` | str | the resolver's firm key: legal suffixes removed, at most 48 bytes, and always the prefix of `plant` (`sresan-pharmaceuticals`) |
| `plant` | str | manufacturer slug + PIN code |
| `state` | str | manufacturing state (`IN-TN`) |
| `mfg_ym` | i32 | manufacture month |
| `exp_ym` | i32 | expiry month, range-queried ("still on shelves") |
| `alert_ym` | i32 | month the alert was published (feed) |
| `src`, `juris` | str | source adapter and jurisdiction |
| `notice` | key | entity key of the parent `notice`, created in the same transaction |
| `conf` | i32 | extraction confidence × 100 |
| `method` | str | `api`, `text`, `ocr`, `llm`, `curated` |
| `tier` | str | `auto` or `machine_read` ("awaiting pharmacist confirmation") |

- **Payload:** full product name, generic, manufacturer and address, manufacturer role (`label_claim` for spurious batches), the reason as printed, failure codes, severity rules that fired and rule version, authority, notice title, URL and date, source sha.
- **Lifetime:** end of the batch's expiry month + 180 days, at least 90 days and at most 10 years from now. With no printed expiry, 3 years from the alert month. The alert disappears once the batch can no longer legally be sold. The 10-year cap catches a misread expiry such as 2099.
- **Flags:**
  - `readonly`: nobody can rewrite an alert, Nazar included. Corrections are separate `retraction` entities.
  - `permissionlessExtension`: anyone, such as a chemist or an NGO, can call `extendEntity` to keep an alert alive while the batch is still on shelves.

### `retraction`: a correction, never a silent edit

| Attribute | Type |
|---|---|
| `alert` | key, the alert it corrects |
| `case` | str |
| `reason` | str: `appeal`, `correction`, `duplicate`, `superseded` |
| `src` | str |

- **Payload:** note.
- **Lifetime:** the alert's remaining life + 1 year.
- **Flags:** `readonly`.

### `heartbeat`: is the pipeline alive?

| Attribute | Type |
|---|---|
| `worker` | str |
| `last_ok` | u64, milliseconds since epoch |

- **Payload:** per-source last check, alert count, version.
- **Lifetime:** 20 minutes. Every 5 minutes the worker patches `last_ok` and the payload, then calls `extendEntity` with a fresh 20 minutes, which is always later than the 15 minutes left. It is a lease renewed by activity.
- **If the pipeline dies,** the heartbeat expires and the app shows "Pipeline offline". A new heartbeat entity is created only when the old one is provably gone (`getEntity` throws `NoEntityFoundError`). A transient RPC error is retried on the next tick, so two heartbeats are never alive at once.
- `/v1/pipeline/status` reports the last beat (`mode`, `action`, `txHash`, `ageMs`, and `stale` after 20 minutes). In live mode it also reports the newest heartbeat read from Arkiv (Q6).

### `snapshot`: daily offline pack

| Attribute | Type |
|---|---|
| `day` | i32 (`20261017`) |
| `count` | i32 |
| `sha` | str |

- **Payload:** sorted batch keys.
- **Lifetime:** 7 days.
- **Flags:** `readonly`.

## Writes

- **One atomic `executeBatch` per notice:** the notice plus up to 11 alerts in the first transaction. `predictEntityKeys` gives the notice's key in advance, so every alert's `notice` attribute points at it within the same transaction. Later chunks reference the now-known notice key.
- **Idempotency:** before sending, the publisher queries existing alerts by `notice` and `rid`. Rows already on chain are reconciled into the local ledger, never re-sent. After a timeout we reconcile by `rid`; we never retry blindly.
- **Concurrency:** one writer per wallet, serialised in process, because key prediction depends on the account's nonce.
- **Dry-run is the default** (`NAZAR_PUBLISH_MODE=dry-run`). It builds and validates every entity without sending.
- **Pre-flight on the whole ledger:** `pnpm cli arkiv:validate` (or `publish --check`) builds every notice and alert exactly as the publisher would and checks:
  - attribute names against the SDK grammar and reserved words;
  - at most 32 attributes, `str` values of at most 128 bytes, payloads of at most 128 KB;
  - i32 ranges and YYYYMM months;
  - the lifetime window for each type;
  - that every alert's `notice` key matches the notice in its own batch;
  - batch sizes, at most 12 creates and about 120 KB of calldata.

  It then runs `eth_estimateGas` on a sample of real batches, which needs no funds. `publish --live` re-runs these checks for exactly what it is about to send, compares the cost against the balance, and stops with the faucet instructions if the wallet is short.
- **Measured cost:** a 12-alert batch is about 2.5M gas and about 71 KB of calldata, roughly 210k gas per alert. Each attribute is ABI-encoded as a 160-byte-plus tuple, so 25 attributes outweigh the ~1 KB payload. At 1 gwei that is about 0.0002 GLM per alert.

## Keep Alive (permissionless, no endpoint)

Alerts carry `permissionlessExtension`, so **any wallet** can call `extendEntity` on a Nazar alert while the batch is still on shelves: a chemist, an NGO or a journalist. Nazar does not run, and does not need, a write endpoint for this. The chain enforces who may extend, and the alert stays readonly, so an extension can change its lifetime and nothing else.

- An extension **sets** a new expiry counted from now; it does not add to the old one. The engine rejects an extension that would not move the expiry later.
- The reference client is `pnpm cli keep-alive <entityKey> --days 180 [--live]`. It checks that the entity is a live Nazar entity that allows permissionless extension, shows the days remaining, skips no-op extensions, and estimates gas in dry-run.
- The creator never changes, so a kept-alive alert still passes the `.createdBy(PUBLISHER)` filter on every read.

```ts
await wallet.extendEntity({ entityKey: alertKey, expires: ExpirationTime.fromDays(180) })
```

## Queries the app runs

All queries include `eq("project", "nazar-in-batch-alerts")` and `.createdBy(PUBLISHER)`.

| # | Purpose | Predicate |
|---|---|---|
| Q1 | Check a batch | `eq("t","alert"), eq("batch","sr13")` |
| Q2 | A brand still in date | `eq("t","alert"), eq("brand","coldrif"), gte("exp_ym",202610)` |
| Q3 | Live feed for a state | `eq("t","alert"), gte("alert_ym",202608), eq("state","IN-TN")` |
| Q4 | Child Shield | `eq("t","alert"), eq("peds",1), gte("sev",4)` |
| Q5 | Batch Passport (one case) | `eq("t","alert"), eq("case",<caseId>)` |
| Q6 | Pipeline heartbeat | `eq("t","heartbeat")`, `.limit(1)` |
| Q7 | Notices for a month | `eq("t","notice"), eq("notice_ym",202506)` |

Lists use cursor pagination pinned to the first page's block: rebuild the query with `.atBlock(firstPage.blockNumber).cursor(page.cursor)` while `page.hasNextPage()`. A bare `page.next()` breaks once a new block arrives ([friction.md](friction.md) #11).

Reproduce Q1 with the SDK:

```ts
import { createPublicClient } from '@arkiv-network/sdk'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq } from '@arkiv-network/sdk/query'
import { str } from '@arkiv-network/sdk/attr'
import { http } from 'viem'

const client = createPublicClient({ chain: tiramisu, transport: http() })
const page = await client
  .select({ key: true, attributes: true, payload: true, creator: true, expiresAt: true })
  .where(eq('project', str('nazar-in-batch-alerts')), eq('t', str('alert')), eq('batch', str('sr13')))
  .createdBy('0xd06d85Eb20f126f796E4a341b711B1a757c66bD2')
  .limit(20)
  .fetch()
```

## What deliberately stays off Arkiv

- **Raw PDFs.** Too big for a payload, and they are the regulator's documents. We store their SHA-256 on the notice, and keep the bytes in a content-addressed store anyone can re-download and hash.
- **Anything about users.** Batches someone checked, stock files and photos never leave the device. Arkiv holds only public regulator facts.
- **The search index.** A local SQLite/FTS5 cache, rebuilt from Arkiv.
