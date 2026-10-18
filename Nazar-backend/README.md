# Nazar backend

This is Nazar's pipeline and API. It fetches medicine alert documents from Indian drug regulators, reads the batch rows out of them (from the PDF text layer, by OCR, or with a grounded LLM fallback), resolves each row into an alert, and publishes the alerts to **Arkiv** (Tiramisu testnet). It also serves the read API for the web app and a hosted MCP server for AI assistants. Project overview, screenshots and the Arkiv/MCP guides: [root README](../README.md).

```
discover → harvest → extract → resolve → publish → Arkiv
 (sources)  (sha256)  (text/OCR/LLM)  (rules)   (atomic batches)
```

Each stage reads and writes a typed contract (`src/domain/types.ts`), so you can re-run, test or replace any stage on its own. The local SQLite ledger is only a cache and a work queue. Everything published can be rebuilt from Arkiv.

## Sources

| Id | Regulator | What it reads | Status |
|---|---|---|---|
| `cdsco-online` | CDSCO | `cdscoonline.gov.in` JSON tables: monthly NSQ and spurious lists, 2019 onwards | on |
| `cdsco-pdf` | CDSCO | Alert PDFs from `cdsco.gov.in` (NSQ, State NSQ, Spurious, legacy Drug Alerts) | on |
| `tn-dc` | Tamil Nadu Drugs Control | Monthly NSQ list PDFs and NSQ recall PDFs | on |
| `mh-fda` | Maharashtra FDA | The NSQ alerts HTML table | on |
| `who-mpa` | WHO | Medical Product Alerts that mention India, including the PDF annex | on |
| `curated` | Nazar curators | Reviewed seed rows with source links (e.g. the Oct 2025 COLDRIF / DEG case) | on |
| `tg-dca`, `ka-dc`, `kl-dc` | Telangana, Karnataka, Kerala | | off: geo-blocked outside India, or site down |

Harvesting is polite:
- one request per host every 10 s by default;
- honours `robots.txt`;
- timeouts, and bounded retries with jitter;
- size caps;
- relaxed TLS only for named hosts that serve broken certificate chains;
- a fallback IP only when a host's DNS fails.

Documents are stored content-addressed (`data/raw/sha256/ab/<hash>.pdf`). Every alert can be traced to the exact bytes it came from.

## Extraction

1. **Text layer first.** `pdfjs-dist` gives text positions and the table borders drawn in the PDF. Columns come from the vertical rules and rows from the horizontal ones. Borderless pages fall back to header labels plus `S.No` anchors.
2. **Templates:**
   - `cdsco-modern` (NSQ, State, Spurious);
   - `cdsco-legacy` (one cell holding "B. No. / Mfg dt / Exp dt / Mfd by");
   - `tn-nsq` (columns mapped from each month's header);
   - `tn-recall`;
   - `who-annex` (products as columns);
   - `generic`.
3. **Grammar.** Batch labels, YYYYMM dates, firm names after "M/s", 6-digit PIN codes.
4. **Confidence scoring** with the issues listed. A row with an implausible batch is rejected, never guessed.
5. **OCR fallback.** Pages without text are rendered with `@napi-rs/canvas` and read with `tesseract.js`. Rejected batch cells are re-read with a batch-only character set.
6. **LLM fallback.** Only for rejected rows, and only when `ANTHROPIC_API_KEY` is set. The model returns strict JSON. **Every value must appear in the row's own source text, or it is dropped.** These rows are marked `llm` and capped at confidence 0.85.

Golden tests check every real fixture: row counts, rejected rows, and field-by-field values.

## Resolve

- Splits brand from generic name.
- Normalises the manufacturer. The plant id is the company slug plus PIN code, and the state comes from the PIN prefix.
- Spurious batches record the named maker as `label_claim`, because that maker is the one being impersonated.
- Joins the same batch across notices into one **case**.
- Severity comes from a versioned rule table (`src/domain/severity.ts`), and the fired rules are kept. For example:
  - "Adulterated with a toxic glycol: base 5"
  - "Paediatric formulation: +1"
- Publish tiers by confidence:

  | Confidence | Tier |
  |---|---|
  | ≥ 0.90 | `auto` |
  | 0.60–0.89 | `machine_read` ("awaiting pharmacist confirmation") |
  | below 0.60 | curator queue only |

## Publishing to Arkiv

The data contract is in [`/arkiv/schema.md`](../arkiv/schema.md).

- **One atomic `executeBatch` per notice.** The notice and its alerts land in one transaction, at most 12 creates each. The notice key is predicted, so every alert links to it.
- **Idempotent.** Each row has an id, `rid = hash(source sha, row, parser)`. Before sending, the publisher reads Arkiv for rids that already exist, and after a timeout it reconciles by rid. It never resends blindly.
- **One writer per wallet**, serialised.
- **Dry-run by default.** It builds every entity, then runs `eth_estimateGas` on the real calldata. Nothing can be broadcast.
- **Live mode** (`NAZAR_PUBLISH_MODE=live`) checks the balance first and points to the faucet when it is short.
- **Heartbeat entity.** Lifetime 20 minutes, renewed every 5 by the worker. If the pipeline dies, the heartbeat expires.

## Quick start

Requires Node 22.5+ (24 recommended) and pnpm 10.

```bash
cd Nazar-backend
pnpm install
cp .env.example .env              # then: pnpm cli wallet:new  (writes a key into .env, prints only the address)

pnpm cli sources                  # list adapters
pnpm cli run --since 202601 --limit 6           # discover → harvest → extract → resolve (dry-run)
pnpm cli run --publish                           # also build + simulate Arkiv writes
pnpm cli check SR-13              # same answer as the API
pnpm cli status                   # ledger stats, runs, heartbeat, wallet balance
pnpm start                        # API on http://localhost:8787
pnpm worker                       # cron: CDSCO every 6 h, states every 3 h, heartbeat every 5 min
```

To publish for real:
1. Fund the publisher address at <https://hub.arkiv.network/faucet>.
2. Set `NAZAR_PUBLISH_MODE=live`.
3. Run `pnpm cli publish --live`.

## API

Live at `https://nazar-api-production.up.railway.app` (Railway, Singapore). How agents and scripts use it, with examples: [root README → Without MCP](../README.md#without-mcp-the-rest-api-and-the-snapshot-file).

| Endpoint | Returns |
|---|---|
| `GET /health` | version, mode, publisher, chain id, ledger stats, egress check (region, CDSCO reachability) |
| `GET /v1/check?batch=SR-13` | `flagged`, `retracted`, `no_alert` or `unreadable`, with alerts and `source` (`ledger` or `arkiv`). A printed label ("B.No. SR-13") is stripped first. A look-alike only ever returns a `suggestion`, never a flag |
| `GET /v1/alerts?limit=&offset=&state=&minSeverity=&peds=&sinceYm=&source=&productClass=` | the feed, `{ items, total }`. `limit` 1–200; `productClass` is `medicine`, `cosmetic` or `hygiene` |
| `GET /v1/alerts/:rid` | one alert |
| `GET /v1/search?q=&limit=` | full-text search (FTS5) over brand, product, generic, manufacturer and reason |
| `GET /v1/cases/:caseId` | Batch Passport: every alert in one case |
| `GET /v1/notices?limit=` | source documents, with their Arkiv entity keys and explorer links |
| `GET /v1/sources` | adapter status, schedule and last run |
| `GET /v1/snapshot` | every publishable alert in one pre-compressed file, for on-device checks (format in `src/api/snapshot.ts`) |
| `GET /v1/pipeline/status` | heartbeat, recent runs, wallet balance |
| `GET /v1/arkiv/summary` | live entity counts and breakdowns, read from Arkiv (not the ledger) |
| `GET /v1/arkiv/entities?type=&src=&state=&cat=&fail=&form=&sevMin=&sevMax=&peds=&expFrom=&expTo=&alertFrom=&alertTo=&batch=&notice=&noticeYm=&alert=&limit=&cursor=&block=` | one page of entities straight from Arkiv, with the exact query string; pass `cursor` and `block` back for the next page |
| `POST /v1/medicine/explain` | "About this medicine": general reference card from the LLM (no doses, never "safe") plus Nazar's own alert counts. The batch, if sent, is only looked up in Nazar's alerts, never sent to the model. 5/min and 30/day per client, `NAZAR_LLM_DAILY_CAP` per day overall |
| `POST /v1/medicine/identify` | "Add to cabinet from a photo": `{ text, hints? }` (OCR'd label text, never the image) → `{ guess, confidence, evidence }`. Every value is grounded in the text: a batch or expiry not printed on the label is dropped. 10/min and 50/day per client, `NAZAR_LLM_IDENTIFY_DAILY_CAP` per day overall |
| `POST /mcp` | the MCP server (below) |

`/v1/check` answers from the ledger first. If the ledger has nothing, it falls back to the Arkiv reader, which always filters by the `project` tag and the publisher's `$creator`. The MCP `check_batch` tool shares the same code path and cache. CORS on `/v1/*` is limited to `NAZAR_CORS_ORIGINS`; `/mcp` is open to every origin.

## MCP server

AI assistants (Claude, ChatGPT, Cursor, VS Code, any MCP client) can use Nazar through a hosted [Model Context Protocol](https://modelcontextprotocol.io) server on the same API:

```
https://nazar-api-production.up.railway.app/mcp
```

The user-facing guide (per-client setup, the tools table, a worked example, curl and Inspector tests) is in the root README: [**Use Nazar from AI agents (MCP)**](../README.md#use-nazar-from-ai-agents-mcp), and on the web at [nazar-nu.vercel.app/ai](https://nazar-nu.vercel.app/ai). This section covers the server itself.

- **Transport:** Streamable HTTP, **stateless**: every POST gets a fresh server and transport, no sessions, JSON responses (no SSE). `GET` and `DELETE` return 405. Clients that send only one of `application/json` / `text/event-stream` in `Accept` have the header completed for them. CORS is open on `/mcp` only. No auth; read-only.
- **Limits:** 60 tool calls per minute and 240 requests per minute per client (a salted, in-memory IP hash, as for the medicine explainer), 64 KB request bodies. Logs record the tool name, outcome and duration, never arguments.
- **Honesty rules** are sent as the server `instructions`: four states, never "safe", "No alert found" is not a safety certificate, cite the regulator notice and the Arkiv entity, a look-alike is never a flag, confirm the brand and maker on the pack. General medicine information (the Gemini explainer) and pack identification are deliberately **not** exposed.

| Tool | Does |
|---|---|
| `check_batch({ batch })` | `flagged` / `retracted` / `no_alert` / `unreadable`, every matching alert (brand, product, manufacturer, reason, severity + rules, Child Shield, regulator, notice title/date/URL, Arkiv entity key + explorer link, `caseId`) and the look-alike `suggestion`. Same code path and cache as `/v1/check` |
| `search_alerts({ query, limit? })` | full-text search over brand, product, generic, manufacturer and reason (`limit` 1–50, default 10) |
| `recent_alerts({ minSeverity?, childShield?, state?, source?, limit? })` | the feed, newest first; `childShield` means paediatric at severity 4+ |
| `get_case({ caseId })` | Batch Passport: every notice naming the batch |
| `list_sources()` | regulators, enabled or why not, last checked |
| `arkiv_proof({ entityKey })` | reads the entity **live from Arkiv** (`getEntity`), not from the ledger: attributes, payload, creator, official-publisher check, flags, expiry, and a verdict (`OFFICIAL`, `NOT NAZAR`, `NOT OFFICIAL`, `NOT FOUND`) |

Every tool returns a text answer plus `structuredContent`, and is annotated read-only. Resources: `nazar://about`, `nazar://schema`. Prompt: `check_my_medicine` (walks a person through finding "B. No." on the pack).

Quick setup (exact configs for every client are in the root README):

```bash
claude mcp add --transport http nazar https://nazar-api-production.up.railway.app/mcp
```

Try it locally with the MCP Inspector or curl (the server is stateless, so `tools/list` works without an `initialize` first):

```bash
pnpm start   # API and /mcp on :8787
npx -y @modelcontextprotocol/inspector@0.17.2 --cli http://localhost:8787/mcp --transport http --method tools/list
npx -y @modelcontextprotocol/inspector@0.17.2 --cli http://localhost:8787/mcp --transport http --method tools/call --tool-name check_batch --tool-arg batch=SR-13

curl -s http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Code: `src/mcp/server.ts` (tools, resources, prompt, instructions), `src/mcp/http.ts` (stateless transport, limits), `src/mcp/proof.ts` (live Arkiv read). Tests: `test/unit/mcp.test.ts`.

## Tests

```bash
pnpm typecheck
pnpm test             # 415 unit + golden tests (offline)
pnpm test:coverage
pnpm test:live        # hits the real regulator sites (opt-in)
```

CI runs typecheck and tests (with coverage) on every push. Scheduled GitHub Actions run the pipeline every 6 hours (`pipeline.yml`), check the live API, CDSCO egress, the heartbeat and SR-13 hourly (`monitor.yml`), and refresh the web app's saved snapshot daily (`snapshot.yml`). See [How it stays up to date](../README.md#how-it-stays-up-to-date).

## Layout

```
src/
  config/env.ts        zod-validated configuration
  lib/                 polite HTTP, retry, errors, hashing, logging
  domain/              batch keys, dates, vocabularies, severity rules, stage contracts
  sources/             one adapter per regulator + registry
  pipeline/            harvest, run (orchestrator), worker (cron), status
  extract/             pdf geometry, layout, templates, grammar, confidence, OCR, LLM
  resolve/             drug, manufacturer/plant/state, case, tiers
  arkiv/               schema (entity builders), client, publisher, reader, heartbeat, directory, keep-alive, validate
  storage/             content-addressed raw store, SQLite ledger (FTS5)
  api/                 Hono app, DTOs, cache policy, snapshot
  mcp/                 MCP server (tools, stateless Streamable HTTP, live Arkiv proof)
  medicine/            "About this medicine" and identify: schema, prompts, guardrails, limits
  cli.ts               commander CLI
test/
  unit/, golden/, fixtures/ (real CDSCO, TN, MH and WHO documents), live/
```
