# Nazar backend

This is Nazar's pipeline and API. It fetches medicine alert documents from Indian drug regulators, reads the batch rows out of them (from the PDF text layer, by OCR, or with a grounded LLM fallback), resolves each row into an alert, and publishes the alerts to **Arkiv** (Tiramisu testnet). It also serves the read API for the web app and a hosted MCP server for AI assistants. Project overview: [root README](../README.md). User and developer guides: [features](../docs/features.md), [REST API](../docs/api.md), [MCP](../docs/mcp.md), [Arkiv](../docs/arkiv.md), [architecture](../docs/architecture.md) and [development](../docs/development.md).

```
discover → harvest → extract → resolve → publish → Arkiv
 (sources)  (sha256)  (text/OCR/LLM)  (rules)   (atomic batches)
```

Each stage reads and writes a typed contract (`src/domain/types.ts`), so you can re-run, test or replace any stage on its own. The local SQLite ledger is only a cache and a work queue. Everything published can be rebuilt from Arkiv.

## Where each stage lives

The concepts (sources, extraction tiers, confidence tiers, severity rules, publishing) are explained once in [**docs/architecture.md**](../docs/architecture.md); the data contract is [`arkiv/schema.md`](../arkiv/schema.md). This table maps each stage to its code.

| Stage | Code | Notes |
|---|---|---|
| Discover | `src/sources/` (one adapter per regulator, `registry.ts`) | ids `cdsco-online`, `cdsco-pdf`, `tn-dc`, `mh-fda`, `who-mpa`, `curated` on; `tg-dca`, `ka-dc`, `kl-dc` off ([sources](../docs/architecture.md#sources)) |
| Harvest | `src/pipeline/harvest.ts`, `src/lib/` (polite HTTP, retry), `src/storage/raw-store.ts` | one request per host every 10 s by default, `robots.txt`, bounded retries, size caps; bytes stored at `data/raw/sha256/ab/<hash>.pdf` |
| Extract | `src/extract/` (`pdf.ts`, `layout.ts`, `rows.ts`, `templates/`, `grammar.ts`, `confidence.ts`, `ocr.ts`, `llm.ts`) | templates `cdsco-modern`, `cdsco-legacy`, `tn-nsq`, `tn-recall`, `who-annex`, `generic` ([extraction tiers](../docs/architecture.md#extraction-tiers)) |
| Resolve | `src/resolve/` (`drug.ts`, `manufacturer.ts`, `case.ts`, `reresolve.ts`), `src/domain/severity.ts` | brand vs generic, plant and state from the PIN code, cases, severity ([resolution and severity](../docs/architecture.md#resolution-and-severity)) |
| Publish | `src/arkiv/` (`schema.ts`, `publisher.ts`, `validate.ts`, `heartbeat.ts`, `keepalive.ts`, `funding.ts`) | atomic batches, idempotent by row id, dry-run by default ([publishing](../docs/architecture.md#publishing-to-arkiv)) |
| Read | `src/arkiv/reader.ts`, `src/arkiv/directory.ts`, `src/storage/ledger.ts` | the Arkiv fallback for checks, the `/v1/arkiv/*` directory, the SQLite ledger with FTS5 |
| Orchestrate | `src/pipeline/run.ts`, `worker.ts`, `status.ts`, `egress.ts` | runs with deadlines, the cron worker, status, the startup CDSCO egress check |

Each stage reads and writes a typed contract (`src/domain/types.ts`), and golden tests check every real fixture field by field.

## CLI

Requires Node 22.5+ (24 recommended) and pnpm 10. Running the whole stack (backend and web app) and every environment variable: [docs/development.md](../docs/development.md).

```bash
cd Nazar-backend
pnpm install
cp .env.example .env              # then: pnpm cli wallet:new  (writes a key into .env, prints only the address)

pnpm cli sources                  # list adapters
pnpm cli run --since 202601 --limit 6           # discover → harvest → extract → resolve (dry-run)
pnpm cli run --publish                           # also build + simulate Arkiv writes
pnpm cli check SR-13              # same answer as the API
pnpm cli status                   # ledger stats, runs, heartbeat, wallet balance
pnpm cli arkiv:validate           # build every entity as the publisher would and check it, then estimate gas
pnpm cli keep-alive <entityKey> --days 180      # extend an alert (dry-run unless --live)
pnpm start                        # API on http://localhost:8787
pnpm worker                       # cron: CDSCO every 6 h, states every 3 h, heartbeat every 5 min
```

To publish for real:
1. Fund the publisher address at <https://hub.arkiv.network/faucet>.
2. Set `NAZAR_PUBLISH_MODE=live`.
3. Run `pnpm cli publish --live`.

Deploying: [`docs/deploy.md`](docs/deploy.md) (Railway in Singapore, Fly.io, Render, any Docker host).

## API

Live at `https://nazar-api-production.up.railway.app` (Railway, Singapore). The Hono app is `src/api/app.ts`; every endpoint, its parameters, errors, rate limits, CORS and caching are documented in [**docs/api.md**](../docs/api.md).

- `/v1/check` answers from the ledger first. If the ledger has nothing, it falls back to the Arkiv reader, which always filters by the `project` tag and the publisher's `$creator`. A look-alike only ever returns a `suggestion`, never a flag.
- `/v1/alerts`, its feeds (`/v1/alerts.rss`, `.atom`, `.json`, rendered in `src/api/feeds.ts`), `/v1/search`, `/v1/cases/:caseId`, `/v1/notices`, `/v1/sources` and `/v1/snapshot` read the ledger; `/v1/arkiv/summary` and `/v1/arkiv/entities` read Arkiv only (`src/arkiv/directory.ts`).
- `POST /v1/medicine/explain` and `POST /v1/medicine/identify` (`src/medicine/`) are the opt-in AI endpoints: strict schemas, grounding, guardrails and per-client limits.
- CORS on `/v1/*` is limited to `NAZAR_CORS_ORIGINS`; `/mcp` and the three feeds are open to every origin.

## MCP server

`POST /mcp` is a hosted, read-only [Model Context Protocol](https://modelcontextprotocol.io) server on the same API: stateless Streamable HTTP (a fresh server and transport per POST, JSON responses), six tools (`check_batch`, `search_alerts`, `recent_alerts`, `get_case`, `list_sources`, `arkiv_proof`), two resources and one prompt. The user guide (per-client setup, tools, rules, a worked example, curl and Inspector tests, limits) is [**docs/mcp.md**](../docs/mcp.md), and on the web at [nazar-nu.vercel.app/ai](https://nazar-nu.vercel.app/ai).

Code: `src/mcp/server.ts` (tools, resources, prompt, instructions), `src/mcp/http.ts` (stateless transport, limits), `src/mcp/proof.ts` (live Arkiv read). Tests: `test/unit/mcp.test.ts`. Try it locally:

```bash
pnpm start   # API and /mcp on :8787
npx -y @modelcontextprotocol/inspector@0.17.2 --cli http://localhost:8787/mcp --transport http --method tools/list
```

## Tests

```bash
pnpm typecheck
pnpm test             # 430 unit + golden tests (offline)
pnpm test:coverage
pnpm test:live        # hits the real regulator sites (opt-in)
```

CI runs typecheck and tests (with coverage) on every push. Scheduled GitHub Actions run the pipeline every 6 hours (`pipeline.yml`), check the live API, CDSCO egress, the heartbeat and SR-13 hourly (`monitor.yml`), and refresh the web app's saved snapshot daily (`snapshot.yml`). See [How it stays up to date](../docs/architecture.md#how-it-stays-up-to-date) and [Tests and CI](../docs/development.md#tests-and-ci).

## Layout

```
src/
  config/env.ts        zod-validated configuration
  lib/                 polite HTTP, retry, errors, hashing, logging
  domain/              batch keys, dates, vocabularies, severity rules, stage contracts
  sources/             one adapter per regulator + registry
  pipeline/            harvest, run (orchestrator), worker (cron), status, egress check
  extract/             pdf geometry, layout, templates, grammar, confidence, OCR, LLM
  resolve/             drug, manufacturer/plant/state, case, tiers
  arkiv/               schema (entity builders), client, publisher, reader, heartbeat, directory, keep-alive, validate
  storage/             content-addressed raw store, SQLite ledger (FTS5)
  api/                 Hono app, DTOs, cache policy, snapshot, feeds (RSS/Atom/JSON)
  mcp/                 MCP server (tools, stateless Streamable HTTP, live Arkiv proof)
  medicine/            "About this medicine" and identify: schema, prompts, grounding, guardrails, limits, providers
  cli.ts               commander CLI
test/
  unit/, golden/, fixtures/ (real CDSCO, TN, MH and WHO documents), live/
```
