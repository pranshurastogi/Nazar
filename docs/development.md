# Development

How to run Nazar yourself (the backend pipeline and API, and the web app), which environment variables exist, how the live deployment is set up, how the tests and CI work, and where things live in the repo. Environment variables are listed by name only; values belong in your own `.env` files, and secrets are never committed.

**Contents**

- [Run it yourself](#run-it-yourself)
- [Environment variables](#environment-variables)
- [Deploy](#deploy)
- [Tests and CI](#tests-and-ci)
- [Project structure](#project-structure)
- [Stack](#stack)
- [Contributing](#contributing)

## Run it yourself

Requires Node 22.5+ (24 recommended) and pnpm 10.

```bash
# 1. Backend: harvest real alerts, then serve the API (and /mcp) on :8787
cd Nazar-backend
pnpm install
cp .env.example .env && pnpm cli wallet:new     # prints only the address; the key stays in .env
pnpm cli run --since 202601 --limit 6           # discover → harvest → extract → resolve (dry-run publish)
pnpm start                                      # API on http://localhost:8787
pnpm worker                                     # optional: the cron worker

# 2. Web app on :3000 (API, then Arkiv directly, then the saved copy, then demo data)
cd ../Nazar-frontend
pnpm install
cp .env.example .env.local
pnpm dev
```

`next dev` uses `http://localhost:8787` when `NEXT_PUBLIC_NAZAR_API_URL` is unset; a production build without it skips the API and answers from Arkiv, then the saved copy.

**More backend commands** (`pnpm cli sources`, `check`, `status`, `arkiv:validate`, `publish --live`, `keep-alive`) are listed in [`Nazar-backend/README.md`](../Nazar-backend/README.md#cli), with where each pipeline stage lives in the code.

**To publish for real:** fund the publisher at <https://hub.arkiv.network/faucet>, run `pnpm cli arkiv:validate`, set `NAZAR_PUBLISH_MODE=live`, then `pnpm cli publish --live`.

## Environment variables

Names only. See `Nazar-backend/.env.example` and `Nazar-frontend/.env.example`; every backend variable is validated in `Nazar-backend/src/config/env.ts`.

### Backend

| Variable | Purpose |
|---|---|
| `ARKIV_RPC_URL`, `ARKIV_WS_URL`, `ARKIV_CHAIN_ID`, `ARKIV_EXPLORER_URL` | Arkiv network |
| `ARKIV_API_KEY` | optional Arkiv access key (higher rate limits) |
| `NAZAR_PUBLISHER_PRIVATE_KEY` | **secret**: the publisher wallet, written by `pnpm cli wallet:new` |
| `NAZAR_ROOT_ADDRESS`, `NAZAR_APP_TAG` | optional wallet and project-tag overrides |
| `NAZAR_PUBLISH_MODE` | `dry-run` (default) or `live` |
| `NAZAR_SOURCES`, `NAZAR_MAX_DOCS_PER_RUN` | which sources run, and how many documents per run |
| `NAZAR_HOST_DELAY_MS`, `NAZAR_HTTP_TIMEOUT_MS`, `NAZAR_HTTP_RETRIES`, `NAZAR_ROBOTS_TIMEOUT_MS`, `NAZAR_DOC_TIMEOUT_MS`, `NAZAR_SOURCE_TIMEOUT_MS`, `NAZAR_USER_AGENT` | politeness and deadlines |
| `NAZAR_INSECURE_TLS_HOSTS`, `NAZAR_HOST_FALLBACK_IPS` | named hosts with broken certificate chains or flaky DNS |
| `NAZAR_OCR_ENABLED`, `NAZAR_OCR_LANG`, `NAZAR_OCR_MAX_PAGES` | OCR fallback |
| `ANTHROPIC_API_KEY`, `NAZAR_LLM_MODEL` | **secret** key for the grounded extraction fallback (optional) |
| `NAZAR_LLM_ENABLED`, `NAZAR_LLM_PROVIDER`, `GEMINI_API_KEY`, `NAZAR_GEMINI_MODEL`, `NAZAR_GEMINI_FALLBACK_MODEL` | "About this medicine" and identify (**secret** key) |
| `NAZAR_LLM_DAILY_CAP`, `NAZAR_LLM_IDENTIFY_DAILY_CAP` | server-wide daily caps for the two AI endpoints |
| `NAZAR_IP_SALT` | salt for rate-limit IP hashes (random per boot when empty) |
| `NAZAR_CRON_CDSCO`, `NAZAR_CRON_STATES`, `NAZAR_CRON_HEARTBEAT` | worker schedules |
| `NAZAR_ROLE`, `NAZAR_RUN_ON_START` | process role (`api`, `worker` or `all`) and a first run at start-up |
| `PORT`, `HOST`, `NAZAR_CORS_ORIGINS`, `NAZAR_SITE_URL` | API port, bind address, allowed web origins, and the site used for feed links |
| `NAZAR_DATA_DIR`, `LOG_LEVEL`, `NODE_ENV` | data directory (ledger, raw store), logging |

### Frontend

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_NAZAR_API_URL` | build | the API URL, tried first (optional; `off` skips it in development) |
| `NAZAR_API_ORIGIN` | server | routes the browser through the same-origin `/api/nazar/*` rewrite, cached at the edge; also used to fetch the snapshot at build time |
| `NEXT_PUBLIC_ARKIV_RPC_URL` | build | browser Arkiv reads |
| `NEXT_PUBLIC_NAZAR_PUBLISHER` | build | the only trusted `$creator` |
| `NEXT_PUBLIC_SITE_URL` | build | absolute links and preview cards (defaults to the page's origin or the live site) |
| `NEXT_PUBLIC_NAZAR_SW` | build | `0` turns off the service worker |
| `NAZAR_DIST_DIR` | build | a separate build directory (used by test runs) |

`NEXT_PUBLIC_*` values are inlined at build time, so rebuild after changing them. None of the frontend variables are secrets.

## Deploy

- **Backend:** Railway, Fly.io, Render or any Docker host; step-by-step in [`Nazar-backend/docs/deploy.md`](../Nazar-backend/docs/deploy.md). The live service runs on Railway in **Singapore** because CDSCO refuses connections from US cloud regions; the region and volume are pinned in [`Nazar-backend/.railway/railway.ts`](../Nazar-backend/.railway/railway.ts) (notes in [`.railway/README.md`](../Nazar-backend/.railway/README.md)). It runs `NAZAR_ROLE=all` with a volume at `/app/data`. **One replica only:** one publisher wallet means one writer. After deploying, `/health` must show `egress.cdsco: "ok"`.
- **Web app:** Vercel, project root `Nazar-frontend`. Set the frontend variables above: either `NAZAR_API_ORIGIN` (the same-origin proxy, no CORS) or `NEXT_PUBLIC_NAZAR_API_URL` (direct calls; then the Vercel domains must be in the backend's `NAZAR_CORS_ORIGINS`). `pnpm build` first fetches the latest snapshot into `public/data/snapshot.json`.

## Tests and CI

| Suite | Count | What it covers | Run |
|---|---|---|---|
| Backend unit + golden | **430 tests** in 36 files | domain rules, sources (real HTML/JSON fixtures), harvest, extraction golden files for every real PDF, resolve, publisher (dry-run, idempotency, chunking, catch-up), reader, Arkiv directory, snapshot and caches, feeds (RSS/Atom/JSON), medicine explain and identify (schema, grounding, guardrails, limits), API, MCP server (tools, stateless HTTP round trip, limits), watchdogs, egress check, secret redaction | `cd Nazar-backend && pnpm test` |
| Scanner parsers | **39 tests** | GS1 element strings and Digital Links, key-value pack text, full pack labels, brand and salt reading, noise | `cd Nazar-frontend && pnpm test:scan` |
| Frontend e2e | **750 checks** (363 with the API down, 387 with a mocked API) | headless Chrome over CDP: onboarding, every result state, look-alikes, the watching eye, the proof sheet, sharing and `/b/` pages, the saved-copy fallback, Alerts (search, new since last visit, India pulse, RSS), the Cabinet (add from a photo, AI guess), Shelf sweep, Hindi, How it works, the AI page, the Arkiv directory, Strip Scan, 360–430 px layouts, dark mode, reduced motion and console errors | `cd Nazar-frontend && pnpm build && pnpm e2e` |
| Backend live | opt-in | hits the real regulator sites | `cd Nazar-backend && pnpm test:live` |

Other commands: `pnpm typecheck` in either package, `pnpm test:coverage` in the backend, and `node e2e/run.mjs live` in the frontend against a local backend. The e2e build needs `NEXT_PUBLIC_NAZAR_API_URL=http://localhost:8787` set (see the header of `Nazar-frontend/e2e/run.mjs`).

**CI** (`.github/workflows/ci.yml`) runs on every push: backend typecheck and tests with coverage; frontend typecheck, scanner tests and build; then the e2e suite. The three scheduled workflows (`pipeline.yml`, `monitor.yml`, `snapshot.yml`) are described in [architecture → how it stays up to date](architecture.md#how-it-stays-up-to-date).

## Project structure

```
Nazar/
├── README.md, llms.txt, LICENSE
├── docs/                   these guides + screenshots/
├── arkiv/                  README (query reference), schema.md (data contract), friction.md,
│                           examples/ (real entities), queries/ (runnable scripts)
├── Nazar-backend/          pipeline, Arkiv publisher/reader/directory, REST API, MCP server, CLI, worker
│   ├── src/
│   │   ├── config/         zod-validated environment
│   │   ├── lib/            polite HTTP, retry, errors, hashing, logging
│   │   ├── domain/         batch keys, dates, vocabularies, severity rules, stage contracts
│   │   ├── sources/        one adapter per regulator + registry
│   │   ├── pipeline/       harvest, run, worker (cron), status, egress check
│   │   ├── extract/        PDF geometry, templates, grammar, confidence, OCR, LLM
│   │   ├── resolve/        drug, manufacturer/plant/state, case, tiers
│   │   ├── arkiv/          entity builders, client, publisher, reader, heartbeat, directory, keep-alive, validate
│   │   ├── storage/        content-addressed raw store, SQLite ledger (FTS5)
│   │   ├── api/            Hono app, DTOs, cache policy, snapshot, feeds
│   │   ├── mcp/            MCP server, stateless HTTP transport, live Arkiv proof
│   │   ├── medicine/       explain and identify: schema, prompts, grounding, guardrails, limits, providers
│   │   └── cli.ts
│   ├── test/               unit/, golden/, fixtures/ (real regulator documents), live/
│   ├── .railway/           Railway infrastructure as code (Singapore)
│   └── Dockerfile, fly.toml, render.yaml, docs/deploy.md
├── Nazar-frontend/         Next.js 16 web app
│   ├── app/(main)/         / (Check), feed, sweep, cabinet, arkiv, ai, more (How it works)
│   ├── app/b/[batch]/      public share pages and their preview images
│   ├── components/nazar/   app shell and nav, result/, scanner/, cabinet/, sweep/, medicine/,
│   │                       feed and India pulse, arkiv/, ai/, more/, onboarding
│   ├── lib/source/         API client, browser Arkiv reader, snapshot, demo fallback, batch matching
│   ├── lib/scan/           GS1 and label parsers, Pack Reader, decoders, OCR
│   ├── lib/i18n/           English and Hindi dictionaries, useT()
│   ├── lib/                cabinet, sweep, seen ("new since your last visit"), badges, share
│   ├── public/data/        snapshot.json (the saved copy, refreshed daily)
│   ├── public/sw.js        service worker
│   └── e2e/                CDP end-to-end suite + runner
└── .github/workflows/      ci.yml, pipeline.yml, monitor.yml, snapshot.yml
```

## Stack

- **Web:** Next.js 16, React 19, Tailwind CSS v4, shadcn/ui on Base UI, Motion, zxing-wasm, tesseract.js.
- **Backend:** Node 24, TypeScript, Hono, pdfjs-dist, tesseract.js, `node:sqlite` (FTS5), Zod, `@modelcontextprotocol/sdk`.
- **Arkiv:** `@arkiv-network/sdk` 0.8 with viem.
- **Hosting:** Vercel (web) and Railway, Singapore (API and worker).

## Contributing

- **Docs:** each topic lives in one place; link to it rather than copying it. The index is [docs/README.md](README.md).
- **Product rule:** never describe a medicine as "safe" in code, copy or docs. Use the four states; "No alert found" is never green and always says it is not a safety certificate.
- **Strings:** add new UI text to `Nazar-frontend/lib/i18n/en.ts` (the source of truth) and `hi.ts`; never put regulator data in the dictionaries.
- **Data:** a new regulator is a new adapter in `Nazar-backend/src/sources/` plus golden fixtures; changes to entity attributes must follow [`arkiv/schema.md`](../arkiv/schema.md).
- **Before a PR:** `pnpm typecheck` and `pnpm test` in the backend; `pnpm typecheck`, `pnpm test:scan` and ideally `pnpm build && pnpm e2e` in the frontend.
- **Secrets:** never commit `.env` files or keys; the publisher key is written by `pnpm cli wallet:new` into your local `.env`.
