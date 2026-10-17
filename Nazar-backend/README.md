# Nazar backend

This is Nazar's pipeline and API. It fetches medicine alert documents from Indian drug regulators, reads the batch rows out of them (from the PDF text layer, by OCR, or with a grounded LLM fallback), resolves each row into an alert, and publishes the alerts to **Arkiv** (Tiramisu testnet). It also serves a read API for the web app.

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

| Endpoint | Returns |
|---|---|
| `GET /health` | version, mode, publisher, ledger stats |
| `GET /v1/check?batch=SR-13` | `flagged`, `retracted`, `no_alert` or `unreadable`, with alerts. A look-alike only ever returns a `suggestion`, never a flag |
| `GET /v1/alerts?limit=&offset=&state=&minSeverity=&peds=&sinceYm=` | the feed |
| `GET /v1/alerts/:rid`, `GET /v1/search?q=`, `GET /v1/cases/:caseId` | one alert, full-text search, Batch Passport |
| `GET /v1/notices`, `GET /v1/sources` | source documents, adapter status |
| `GET /v1/pipeline/status` | heartbeat, recent runs, wallet balance |

`/v1/check` answers from the ledger first. If the ledger has nothing, it falls back to the Arkiv reader, which always filters by the `project` tag and the publisher's `$creator`.

## Tests

```bash
pnpm typecheck
pnpm test             # unit + golden tests (offline, about 2 s)
pnpm test:coverage
pnpm test:live        # hits the real regulator sites (opt-in)
```

CI runs typecheck and tests on every push. A scheduled GitHub Actions workflow runs the pipeline every 6 hours (`.github/workflows/pipeline.yml`).

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
  arkiv/               schema (entity builders), client, publisher, reader, heartbeat
  storage/             content-addressed raw store, SQLite ledger (FTS5)
  api/                 Hono app + DTOs
  cli.ts               commander CLI
test/
  unit/, golden/, fixtures/ (real CDSCO, TN, MH and WHO documents), live/
```
