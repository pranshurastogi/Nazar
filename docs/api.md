# REST API

Nazar's HTTP API is the same one the web app uses: batch checks, the alert feed and search, the regulator documents, a daily snapshot, live reads from Arkiv, subscribable feeds, and the two opt-in AI endpoints. It is read-only for regulator data, needs no key, and answers with the same four states as the app; it never calls a medicine "safe". This page lists every endpoint with its parameters, an example, the error shape, rate limits, CORS and caching.

**Base URL:** `https://nazar-api-production.up.railway.app` (Railway, Singapore). Locally: `http://localhost:8787` ([development](development.md#run-it-yourself)).

**Contents**

- [Endpoints at a glance](#endpoints-at-a-glance)
- [Checks](#checks): [`/v1/check`](#get-v1check)
- [Alerts](#alerts): [`/v1/alerts`](#get-v1alerts) · [`/v1/alerts/:rid`](#get-v1alertsrid) · [feeds](#feeds-rss-atom-json-feed) · [`/v1/search`](#get-v1search) · [`/v1/cases/:caseId`](#get-v1casescaseid)
- [Sources and documents](#sources-and-documents): [`/v1/notices`](#get-v1notices) · [`/v1/sources`](#get-v1sources) · [`/v1/snapshot`](#get-v1snapshot) · [`/v1/pipeline/status`](#get-v1pipelinestatus) · [`/health`](#get-health)
- [Arkiv](#arkiv): [`/v1/arkiv/summary`](#get-v1arkivsummary) · [`/v1/arkiv/entities`](#get-v1arkiventities)
- [Medicine (opt-in AI)](#medicine-opt-in-ai): [`/v1/medicine/explain`](#post-v1medicineexplain) · [`/v1/medicine/identify`](#post-v1medicineidentify)
- [Errors](#errors) · [Rate limits](#rate-limits) · [CORS](#cors) · [Caching](#caching)

## Endpoints at a glance

| Method and path | Returns |
|---|---|
| `GET /health` | version, mode, publisher, chain id, ledger stats, egress check |
| `GET /v1/check?batch=` | the four-state answer with alerts |
| `GET /v1/alerts?…` | the feed, newest first, `{ items, total }` |
| `GET /v1/alerts/:rid` | one alert |
| `GET /v1/alerts.rss`, `.atom`, `.json` | the same feed as RSS 2.0, Atom 1.0 or JSON Feed 1.1 |
| `GET /v1/search?q=&limit=` | full-text search over brand, product, generic, manufacturer and reason |
| `GET /v1/cases/:caseId` | Batch Passport: every alert in one case |
| `GET /v1/notices?limit=` | regulator documents, with their Arkiv keys |
| `GET /v1/sources` | source adapters, schedule and last run |
| `GET /v1/snapshot` | every publishable alert in one compressed file |
| `GET /v1/pipeline/status` | heartbeat, recent runs, wallet balance |
| `GET /v1/arkiv/summary` | live entity counts and breakdowns, read from Arkiv |
| `GET /v1/arkiv/entities?…` | one page of entities straight from Arkiv |
| `POST /v1/medicine/explain` | "About this medicine" general information |
| `POST /v1/medicine/identify` | a guess of the medicine from label text |
| `POST /mcp` | the MCP server ([docs/mcp.md](mcp.md)) |

All responses are JSON unless noted. Alert objects (`AlertDTO`) carry the resolved record (`batch`, `brand`, `product`, `generic`, `manufacturer`, `form`, `category`, `failures`, `reason`, `severity`, `severityRules`, `peds`, `state`, `mfgYm`, `expYm`, `alertYm`, `dateKnown`, `productClass`, `authority`, `noticeTitle`, `noticeUrl`, `noticeDate`, `noticeSha`, `method`, `confidence`, `tier`, `caseId`, `rid`) plus where it lives on Arkiv (`entityKey`, `txHash`, `creator`, `publishedAt`, `retracted`, `explorer.entity`, `explorer.tx`).

## Checks

### `GET /v1/check`

| Param | Rules |
|---|---|
| `batch` | required, up to 200 characters. A printed label ("B.No. SR-13") is stripped first. |

```bash
curl -s 'https://nazar-api-production.up.railway.app/v1/check?batch=SR-13' \
  | jq '{state, batch, source, alerts: [.alerts[] | {brand, authority, noticeTitle, severity, entityKey}]}'
```

```json
{
  "state": "flagged",
  "batch": "SR-13",
  "asOf": "2026-10-18T18:08:00.000Z",
  "alerts": [{ "brand": "COLDRIF", "authority": "WHO", "severity": 5, "peds": true, "entityKey": "0x346f83d7…80fe54", "…": "…" }],
  "source": "ledger"
}
```

| `state` | When |
|---|---|
| `flagged` | an exact match on a publishable alert |
| `retracted` | every matching alert has been withdrawn |
| `no_alert` | nothing names this batch (not a safety certificate) |
| `unreadable` | the batch has an invalid shape, or only a look-alike matched; then `suggestion` holds the look-alike (`5R-13` → `"SR-13"`), never a flag |

`source` is `ledger`, or `arkiv` when the ledger had nothing and the API read Arkiv (filtered by the project tag and the publisher's `$creator`). The MCP `check_batch` tool shares this code path and cache.

## Alerts

### `GET /v1/alerts`

The feed, newest first (undated rows after dated ones). Only publishable tiers (`auto`, `machine_read`); retracted alerts are left out.

| Param | Rules |
|---|---|
| `limit` | 1–200, default 50 |
| `offset` | 0–100000, default 0 |
| `state` | manufacturing state, ISO 3166-2:IN (`IN-TN`) |
| `minSeverity` | 1–5 |
| `peds` | `true`/`false`/`1`/`0` (paediatric formulations) |
| `sinceYm` | alert month at or after `YYYYMM` |
| `source` | source id (`cdsco-online`, `cdsco-pdf`, `tn-dc`, `mh-fda`, `who-mpa`, `curated`) |
| `productClass` | `medicine`, `cosmetic` or `hygiene` (hand sanitiser, cleaning liquid) |

```bash
curl -s 'https://nazar-api-production.up.railway.app/v1/alerts?minSeverity=4&peds=1&productClass=medicine&limit=5' | jq '{total, first: .items[0].brand}'
```

Returns `{ "items": AlertDTO[], "total": number }`.

### `GET /v1/alerts/:rid`

One alert by row id (hex, 8–64 characters). 404 if unknown or not publishable.

### Feeds (RSS, Atom, JSON Feed)

| Path | Format | Content type |
|---|---|---|
| `GET /v1/alerts.rss` | RSS 2.0 | `application/rss+xml` |
| `GET /v1/alerts.atom` | Atom 1.0 | `application/atom+xml` |
| `GET /v1/alerts.json` | JSON Feed 1.1 | `application/feed+json` |

They take the same filters as `/v1/alerts` (`limit` default 50, max 200) and contain the same rows. The feed title reflects the filters; each item links to the batch's share page on the site (`NAZAR_SITE_URL`, e.g. `https://nazar-nu.vercel.app/b/SR-13`) and, in Atom, to the regulator notice. Every item ends with: "Nazar repeats what the regulator published. It is not medical advice and never a safety certificate." Regulator text is XML-escaped and only http(s) links are emitted. CORS is open on these three paths so browser-based feed readers can fetch them.

```bash
curl -s 'https://nazar-api-production.up.railway.app/v1/alerts.rss?peds=1&minSeverity=4'
```

### `GET /v1/search`

| Param | Rules |
|---|---|
| `q` | 1–100 characters |
| `limit` | 1–100, default 25 |

Full-text search (SQLite FTS5) over brand, product, generic, manufacturer and reason. Returns `{ "items": AlertDTO[] }`.

```bash
curl -s 'https://nazar-api-production.up.railway.app/v1/search?q=coldrif&limit=5' | jq '[.items[] | {batch, brand, authority}]'
```

### `GET /v1/cases/:caseId`

Batch Passport: every publishable alert in one case (the same batch across notices). Returns `{ "caseId", "items": AlertDTO[] }`; 404 if empty.

## Sources and documents

### `GET /v1/notices`

`limit` 1–200, default 50. Regulator documents, newest first: `title`, `authority`, `url`, `sha`, `rows`, `parser`, `noticeYm`, `sourceId`, `jurisdiction`, `method`, `publishedAt`, plus `entityKey`, `txHash` and `explorer` links. Returns `{ items }`.

### `GET /v1/sources`

Every source adapter (nine today, six enabled): `id`, `authority`, `jurisdiction`, `homepage`, `description`, `schedule`, `enabled`, `disabledReason`, `lastRun`. Returns `{ items }`.

### `GET /v1/snapshot`

Every publishable alert in one pre-compressed file, which the app keeps on the device for instant and offline checks. Served as brotli or gzip by `Accept-Encoding`, with a strong ETag per encoding and `X-Nazar-Snapshot: <version>`. The same file is published daily as [`nazar-nu.vercel.app/data/snapshot.json`](https://nazar-nu.vercel.app/data/snapshot.json).

Shape (v1), arrays instead of objects to keep it small:

```text
{ v: 1, version, generatedAt, count,
  notices: [authority, title, url, date|null, sourceId][],
  alerts:  { [batchKey]: Row[] } }
Row = [batch|null, notice#, brand, product|null, generic|null, form, category, failure, reason,
       severity, peds 0|1, manufacturer|null, labelClaim 0|1, state|null, mfgYm|null, expYm|null,
       alertYm, machineRead 0|1, onArkiv 0|1, retracted 0|1, dateKnown 0|1, productClass]
```

Entity keys and row ids are left out on purpose (random hex, incompressible), so use `/v1/check`, Arkiv or the MCP server for proof. Source: [`Nazar-backend/src/api/snapshot.ts`](../Nazar-backend/src/api/snapshot.ts).

### `GET /v1/pipeline/status`

`mode`, `publisher` (address and GLM balance), ledger `stats`, `sources`, recent `runs`, the last `heartbeat` (`mode`, `action`, `txHash`, `ageMs`, `stale` after 20 minutes, and in live mode the heartbeat read from Arkiv as `chain`) and `egress`. Never cached.

### `GET /health`

`ok`, `version`, `mode` (`dry-run` or `live`), `publisher`, `chainId`, ledger `stats` (documents, alerts, published, pending, drug-level, curator queue, failed documents), `egress` (the server's region and whether CDSCO is reachable from it) and `warnings`.

```bash
curl -s https://nazar-api-production.up.railway.app/health | jq '{mode, chainId, stats, egress: .egress.country}'
```

## Arkiv

Both endpoints read Arkiv, never Nazar's ledger. They answer 503 when no publisher is configured.

### `GET /v1/arkiv/summary`

Live entity counts (`entities.alert`, `notice`, `retraction`, `heartbeat`, `snapshot`), alert breakdowns (`alerts.total`, `bySrc`, `byState`, `byCat`, `byFail`, `byForm`, `bySev`, `peds`, `inDate`), the notices, the heartbeat, and the block it was read at. `stale: true` when the last refresh failed and an older summary is served.

### `GET /v1/arkiv/entities`

One page of entities with the exact Arkiv query string and an SDK program for it.

| Param | Rules |
|---|---|
| `type` | `alert` (default), `notice`, `retraction`, `heartbeat` |
| `src`, `state`, `cat`, `fail`, `form` | equality filters (alerts) |
| `sevMin`, `sevMax` | 1–5 |
| `peds` | boolean |
| `expFrom`, `expTo`, `alertFrom`, `alertTo`, `noticeYm` | `YYYYMM` ranges |
| `batch` | normalised like the app (`SR-13` → `sr13`) |
| `notice`, `alert` | entity keys (`0x` + 64 hex) |
| `limit` | 1–200, default 25 |
| `cursor`, `block` | from the previous page; pass both back for the next page |

Filters that do not apply to the chosen `type` and reversed ranges are rejected with 400.

```bash
curl -s 'https://nazar-api-production.up.railway.app/v1/arkiv/entities?type=alert&peds=1&sevMin=4&limit=5' | jq '{block, cursor, query: .query.string, first: .items[0].key}'
```

Returns `{ items, cursor, block, query: { string, sdk }, cached }`. Each item has `key`, `type`, `creator`, `owner`, `official`, `flags` (`readonly`, `permissionlessExtension`), `createdAtBlock`, `expiresAtBlock`, `expiresAtEstimate`, typed `attributes` and `payload`. Why the block is pinned: [docs/arkiv.md](arkiv.md#pagination-must-pin-the-block).

## Medicine (opt-in AI)

Both endpoints are called only when a person asks in the app. They are rate-limited, never cached (`Cache-Control: no-store`), and answer 503 `LLM_DISABLED` when the server has no model key. Neither is exposed over MCP.

### `POST /v1/medicine/explain`

"About this medicine": a general reference card written by an LLM (Gemini by default) under a strict schema, plus Nazar's own alert counts. Body up to 2 KB:

```json
{ "brand": "COLDRIF", "product": "Coldrif syrup", "composition": ["Paracetamol"], "form": "syrup", "manufacturer": "Sresan Pharmaceutical", "batch": "SR-13" }
```

At least one of `product`, `brand` or `composition` is required. The `batch` is only looked up in Nazar's alerts and is never sent to the model.

The response has `medicine` (name, generic names, drug class, uses, how it works, common side effects, serious warnings, who should be careful, interactions, storage, prescription status, look-alike names, confidence; no doses, never "safe"), `disclaimer`, `aiGenerated: true`, `brandName`, `brandAlerts`, `ingredientName`, `ingredientAlerts` (other products sharing an ingredient: context only, not about this pack), `batchAlerts`, `nazarQuery`, `cached`, `model` and `generatedAt`.

### `POST /v1/medicine/identify`

"Add to cabinet from a photo": the device reads the label and sends **text only, never the image**. Body up to 8 KB:

```json
{ "text": "DOLO-650 Paracetamol Tablets IP 650 mg B.No. DOBS3975 EXP 03/2028 Micro Labs Limited", "hints": { "batch": "DOBS3975" } }
```

`text` is 3–4,000 characters; `hints` (optional) are what the on-device Pack Reader already parsed, used as context only, never as evidence. The response is `{ guess: { product, brand, composition, form, manufacturer, batch, expiry }, confidence, evidence: [{ field, quote }], aiGenerated: true, model, cached }`. **Every value must be quoted from the submitted text, or it is dropped**, so a batch or expiry not printed on the label is never returned.

## Errors

Every error is JSON:

```json
{ "error": { "code": "BAD_REQUEST", "message": "invalid request", "details": [{ "path": "limit", "message": "Invalid input: expected number, received NaN" }] } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | a parameter or body failed validation (`details` lists each issue), or the body is not JSON |
| 404 | `NOT_FOUND` | unknown alert, case or route |
| 410 | `CURSOR_EXPIRED` | an Arkiv cursor no longer matches its block: start from the first page |
| 413 | `TOO_LARGE` | a medicine request body over its limit |
| 429 | `RATE_LIMITED`, `DAILY_CAP` | medicine endpoints over a per-client or daily limit; `retryAfterSec` and a `Retry-After` header |
| 502 | `LLM_FAILED`, `LLM_BAD_OUTPUT` | the model failed or returned something that did not pass validation |
| 503 | `UNAVAILABLE`, `LLM_DISABLED`, `ARKIV_THROTTLED`, `ARKIV_UNAVAILABLE`, `SUMMARY_WARMING` | a part is not wired in this process, has no key, or Arkiv is busy (`Retry-After` where known) |
| 500 | `INTERNAL` | anything else; the message is generic and secrets are redacted |

`/mcp` answers JSON-RPC errors instead (405, 413, 429): see [docs/mcp.md](mcp.md#transport-limits-and-privacy).

## Rate limits

| Endpoint | Per client | Whole server |
|---|---|---|
| `POST /v1/medicine/explain` | 5 per minute, 30 per day | `NAZAR_LLM_DAILY_CAP` per day (default 500) |
| `POST /v1/medicine/identify` | 10 per minute, 50 per day | `NAZAR_LLM_IDENTIFY_DAILY_CAP` per day (default 500) |
| `POST /mcp` | 240 requests and 60 tool calls per minute | |
| other `GET` routes | no per-client limit; responses are cached (below) | |

A client is a salted SHA-256 of its IP (first `X-Forwarded-For` hop), held only in memory. Identical medicine requests are answered from a cache.

## CORS

| Paths | Allowed origins |
|---|---|
| `/v1/*` (except the feeds), `/health` | only `NAZAR_CORS_ORIGINS` (Nazar's own web origins in production; localhost in development). Methods `GET`, `HEAD`, `POST`, `OPTIONS`. |
| `/mcp` | every origin (MCP clients run anywhere) |
| `/v1/alerts.rss`, `/v1/alerts.atom`, `/v1/alerts.json` | every origin (browser-based feed readers) |

Call `/v1/*` from a server, script or agent, or read [Arkiv directly](arkiv.md) from a browser. The web app itself avoids CORS through a same-origin rewrite (`/api/nazar/*` on Vercel, set by `NAZAR_API_ORIGIN`).

## Caching

`/v1/*` responses carry `Cache-Control` for browsers and a mirrored `CDN-Cache-Control` for Vercel's edge, plus a weak ETag (so unchanged responses come back as 304) and gzip compression (`/mcp` is not compressed).

| Response | `Cache-Control` |
|---|---|
| lists (`/v1/alerts`, feeds, search, notices, sources, cases, one alert) | `public, max-age=30, s-maxage=60, stale-while-revalidate=300` |
| `/v1/check` | `public, max-age=15, s-maxage=15, stale-while-revalidate=60` |
| `/v1/snapshot` | `public, max-age=300, s-maxage=600, stale-while-revalidate=86400` |
| `/v1/arkiv/summary` | `public, max-age=60, s-maxage=120, stale-while-revalidate=600` (15 s when stale) |
| `/v1/arkiv/entities`, first page | `public, max-age=30, s-maxage=30, stale-while-revalidate=120` |
| `/v1/arkiv/entities`, pinned page (with `cursor`) | `public, max-age=300, s-maxage=300, stale-while-revalidate=3600` |
| `/v1/pipeline/status`, medicine endpoints, errors from them | `no-store` |

Inside the server, `/v1/check` answers are kept in an LRU (5,000 batches, 10 minutes) that is emptied whenever the alerts table changes, so a new or retracted alert is never hidden behind a stale answer.
