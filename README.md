<div align="center">

<img src="Nazar-frontend/public/brand/nazar-mark.png" width="120" alt="Nazar logo: an eye looking out of a medicine capsule" />

# Nazar

**Har batch par nazar.** An eye on every batch.

Check any Indian medicine batch against CDSCO, state drug regulator and WHO alerts in seconds, with proof anyone can verify on Arkiv.

**[Open the live app →](https://nazar-nu.vercel.app)** · [Arkiv directory](https://nazar-nu.vercel.app/arkiv) · [API](https://nazar-api-production.up.railway.app/health)

[![CI](https://github.com/pranshurastogi/Nazar/actions/workflows/ci.yml/badge.svg)](https://github.com/pranshurastogi/Nazar/actions/workflows/ci.yml)
[![Pipeline](https://github.com/pranshurastogi/Nazar/actions/workflows/pipeline.yml/badge.svg)](https://github.com/pranshurastogi/Nazar/actions/workflows/pipeline.yml)
[![Monitor](https://github.com/pranshurastogi/Nazar/actions/workflows/monitor.yml/badge.svg)](https://github.com/pranshurastogi/Nazar/actions/workflows/monitor.yml)

[Features](#what-you-can-do) · [Screenshots](#screenshots) · [Try it](#try-it) · [How it works](#how-it-works) · [Pipeline](#the-pipeline) · [Arkiv](#arkiv) · [Run it](#run-it-yourself) · [Tests](#tests)

</div>

![A flagged batch: COLDRIF SR-13 with Child Shield, two regulator notices and the on-chain proof chain from the WHO document to the Arkiv alert entity](docs/screenshots/result-onchain-proof-desktop.png)

---

## The problem

India's drug regulators publish failed medicine batches as PDFs, tables and press notes, days apart, in formats no pharmacy billing software can read.

**The Coldrif case**
- **2 October 2025:** Tamil Nadu declared batch **SR-13** of COLDRIF syrup adulterated (48.6% w/v diethylene glycol), after clusters of child deaths.
- **13 October 2025:** WHO's Medical Product Alert N°5/2025 listed it with two more DEG-contaminated syrups, Respifresh TR (`R01GL2523`) and ReLife (`LSL25160`).
- Every state rewrote the same alert by hand, while the batch's printed expiry ran to April 2027.

Nazar turns those scattered notices into one live, verifiable feed that a chemist at the counter, a parent at 11 PM, or an AI agent can check in under three seconds.

> **Nazar never says a medicine is "safe".** It reports what a named regulator published, on which date, with the document. "No alert found" is shown in slate grey, never green, and always says it is not a safety certificate.

## What you can do

| | Feature | What it does |
|---|---|---|
| 🔎 | **Check a batch** | Type the batch number from the pack and get one of four honest answers: **Flagged**, **Retracted**, **No alert found** or **Can't tell**. Look-alike characters (0/O, 1/I/L, 5/S, 8/B) only ever produce "Did you mean…?", never a flag. A watching eye mirrors the check: it looks at the batch box while you type, scans while checking, then turns red, amber or slate (never green). |
| 🔗 | **Share a result** | Every batch has a public page, `/b/SR-13`, with its own preview card for WhatsApp and social apps, the regulator notice, the Arkiv proof and "Check your own batch". Share, Copy link and WhatsApp sit right under "What to do"; `/?batch=` links open a check directly. |
| 📷 | **Strip Scan** | Point the camera at the pack, or upload a photo. QR, Data Matrix and GS1 codes are decoded on the device (BarcodeDetector or zxing-wasm), with an OCR fallback for the printed "B.No." line. If the code and the printed batch disagree you see "Label details don't match. Show this pack to your chemist." Images never leave the phone. |
| 🏷️ | **Pack Reader** | The scanner reads the whole label on the device: product, composition and strengths, form, pack size, manufacturer and state, licence number, MRP and Schedule, each with a confidence you can edit. |
| 🤖 | **About this medicine (opt-in)** | Tap "Show general information" for plain-language notes: what it is for, how it works, common side effects, when to get help, who should be careful, storage and prescription status. It comes from a strictly validated AI answer (Gemini) and is clearly labelled *AI-generated · not from a regulator*, kept apart from the official verdict. No doses, never "safe", and the batch number is never sent. Rate-limited per visitor, with a daily cap. |
| ⚡ | **Instant and offline** | A 57 KB snapshot of every alert lives on the device, so a check answers in about 15 ms, then the live API confirms it with the on-chain proof. It also works offline. API reads are cached at Vercel's edge. |
| 🧒 | **Child Shield** | Paediatric formulations with serious failures get a banner telling parents to contact a doctor now. |
| ⚖️ | **Severity with reasons** | A versioned rule table, not a black box: "Adulterated with a toxic glycol: base 5 · Paediatric formulation: +1 (capped at 5)". |
| 🔗 | **On-chain proof** | Every result shows the chain of custody: regulator document → SHA-256 → Arkiv notice entity → this alert entity. It also shows the transaction link, an "Official Nazar publisher" check against `$creator`, and the Read-only and Anyone-can-keep-alive flags. |
| 📰 | **Feed + India pulse** | Every alert, newest first. On top, the **India pulse**: a tile map of where failed batches were made, a monthly "seismograph" of severity, and headline counts, all from the saved snapshot. Tap a state to filter. Undated rows say "Date not given" and stay off the timeline. Filters sync to the URL. |
| 💊 | **Your shelf, watched** | Save the batches you keep at home. They sit as capsules on a shelf: red flagged, amber can't tell, slate no alert. A watching eye re-checks them whenever you open the page, with a scan beam that settles each capsule as its answer lands. Expiring packs are marked. It lives only in your browser (export and import as JSON). |
| ⛓️ | **Arkiv directory** | Opens with Nazar's mark rebuilt from GPU particles that turn liquid under your cursor. Below it, a structured explorer of everything Nazar has on chain: live counts and breakdowns, filters that turn into Arkiv predicates, the **exact query string and an SDK snippet**, and attributes shown next to the payload. It can query Arkiv straight from your browser. |
| 🤖 | **Nazar in your AI assistant** | A hosted MCP server lets Claude, ChatGPT, Cursor and other assistants check batches with the same four answers, cite the regulator notice and verify the alert on Arkiv. See [MCP server](#mcp-server). |
| 📖 | **How it works** | "The life of one alert": six chapters following COLDRIF SR-13 from the WHO notice to your phone, with a scroll-driven chain of custody. Then live source status, proof on Arkiv, the MCP server, privacy, settings and about. |
| ✨ | **First-run guide** | A short animated guide: where to find "B.No.", the four answers, and how the proof works. |

**It keeps working when Nazar's servers don't.** Every check tries the Nazar API first, then reads Arkiv directly from the browser (filtered by the publisher's `$creator`), then Nazar's saved copy of every published alert: kept on the device, and also served by the website itself (`/data/snapshot.json`, refreshed on every build). Only with none of those, offline on a first visit, does it fall back to built-in demo data. The answer always says which source it came from.

## Screenshots

| Check: the eye watches | Flagged: the eye turns red |
|:---:|:---:|
| ![Check page with the watching eye beside "Check the batch, not just the brand", the batch box and live high-severity alerts](docs/screenshots/home-desktop.png) | ![SR-13 checked: the eye has turned red above a flagged COLDRIF result with Child Shield and What to do](docs/screenshots/home-flagged-eye-desktop.png) |

**Arkiv: every alert, verifiable by anyone.** The Nazar mark is rebuilt from GPU particles; move across it and it turns liquid, then settles back.

| At rest | Under the cursor |
|:---:|:---:|
| ![Arkiv page hero: the Nazar capsule mark made of particles, "Every alert, verifiable by anyone", and the three steps from regulator to Arkiv to anyone](docs/screenshots/arkiv-hero-desktop.png) | ![The same hero with the capsule dissolving into liquid particles under the cursor](docs/screenshots/arkiv-hero-liquid-desktop.png) |

**Feed: India pulse.** Where failed batches were made, and when, counted from the saved snapshot. Tap a state to filter the list.

![India pulse: headline counts, a tile map of Indian states shaded by alert count with severity-5 and Child Shield marks, and a monthly severity seismograph](docs/screenshots/feed-india-pulse-desktop.png)

**Cabinet: your shelf, watched.** Capsules take the colour of their answer; the eye re-checks them every time you open the page.

![Cabinet shelf: COLDRIF SR-13 and Levcon-M as red flagged capsules, three slate "no alert found" capsules, an "Expires soon" chip and the red-eyed sentinel](docs/screenshots/cabinet-shelf-desktop.png)

**How it works: the life of one alert.**

| The story | The chain of custody |
|:---:|:---:|
| ![How it works hero: "How Nazar works, and how to check it", the watching eye and live numbers: sources on, alerts on Arkiv, the publisher wallet](docs/screenshots/how-it-works-desktop.png) | ![Chapter view: the batch becomes a case, with a sticky chain-of-custody stage that lights up as you scroll](docs/screenshots/how-it-works-journey-desktop.png) |

| Arkiv directory | Filtered: Child Shield, severity 4+ | Entity: attributes vs payload |
|:---:|:---:|:---:|
| ![Arkiv directory: live counts of notices, alerts and heartbeat with the live query panel](docs/screenshots/arkiv-directory-desktop.png) | ![Directory filtered to paediatric alerts at severity 4 or above, with the matching Arkiv query](docs/screenshots/arkiv-filtered-desktop.png) | ![Entity drawer: official publisher, flags, expiry estimate and typed attributes](docs/screenshots/arkiv-entity-drawer-desktop.png) |

**Share a result:** every batch has a public page with its own preview card.

| Preview card for /b/SR-13 | The share page |
|:---:|:---:|
| ![Preview card: batch SR-13, COLDRIF, Flagged, WHO, with "Verify on Arkiv"](docs/screenshots/share-card.png) | ![Public share page for SR-13 on mobile: flagged, Child Shield, What to do and the proof](docs/screenshots/mobile-share-page.png) |

**About this medicine (opt-in, AI-generated, kept apart from the official verdict):**

![Medicine card under a flagged SR-13 result: the official "don't use it" banner first, then AI-generated general information in six story cards with a not-medical-advice footer](docs/screenshots/medicine-card-desktop.png)

| Scanner | Pack Reader | QR scan | Label mismatch |
|:---:|:---:|:---:|:---:|
| ![Scanner prompt on mobile with the watching eye: read the pack with your camera, upload a photo or type it](docs/screenshots/mobile-scanner-eye-dark.png) | ![Pack Reader: batch DOBS3975 read from printed text at 91% confidence, with product, composition, form, pack size, maker, state, licence and MRP from the label](docs/screenshots/mobile-pack-reader-dark.png) | ![Scanner read SR-13 from a GS1 QR code, with expiry](docs/screenshots/mobile-scanner-dark.png) | ![Scanner warning that the QR code and the printed batch disagree](docs/screenshots/mobile-scanner-mismatch-dark.png) |

| Flagged on mobile | "How do we know?" | Shelf on mobile | How it works on mobile |
|:---:|:---:|:---:|:---:|
| ![Flagged result for SR-13 on mobile, dark mode](docs/screenshots/mobile-result-dark.png) | ![Proof sheet with publisher, notice, Arkiv entity and source hash](docs/screenshots/mobile-proof-dark.png) | ![Cabinet on mobile: two flagged medicines, the review banner and the watched shelf](docs/screenshots/mobile-cabinet-dark.png) | ![How it works on mobile: hero, live numbers and section chips](docs/screenshots/mobile-more-dark.png) |

## Try it

On **[nazar-nu.vercel.app](https://nazar-nu.vercel.app)**:

| Type this | You get | Where it comes from |
|---|---|---|
| `SR-13` | **Flagged**, severity 5, Child Shield, 2 notices, on-chain proof | COLDRIF, WHO Medical Product Alert N°5/2025 (DEG 48.6% w/v) |
| `R01GL2523`, `LSL25160` | **Flagged**, severity 5 | Respifresh TR and ReLife, same WHO alert |
| `SST25006` | **Flagged** | Salbutamol tablets, CDSCO and Tamil Nadu NSQ lists, Aug 2026 |
| `(N)25567` | **Flagged** | Sodium chloride injection, CDSCO (batches with brackets are kept) |
| `5R-13` | **Can't tell**, "Did you mean SR-13?" | A look-alike is never shown as a flag |
| `AB1234` | **No alert found** | Not a safety certificate |

Or open **[/arkiv](https://nazar-nu.vercel.app/arkiv)** and try filters like Child Shield + severity 4+ to watch the Arkiv query change.

## How it works

```mermaid
flowchart LR
  subgraph Sources
    A[CDSCO online<br/>JSON tables]
    B[CDSCO alert PDFs]
    C[Tamil Nadu NSQ<br/>+ recall PDFs]
    D[Maharashtra FDA<br/>NSQ table]
    E[WHO Medical<br/>Product Alerts]
  end
  subgraph Railway [Nazar-backend · Railway, Singapore]
    H[Harvest<br/>sha256 store]
    X[Extract<br/>ruled tables · OCR ·<br/>grounded LLM]
    R[Resolve<br/>brand · plant · case ·<br/>severity rules]
    P[Publisher<br/>atomic batches]
    L[(SQLite ledger<br/>cache + FTS5)]
    I[Nazar API]
  end
  K[(Arkiv<br/>Tiramisu)]
  W[Web app<br/>Vercel]
  A & B & C & D & E --> H --> X --> R --> P --> K
  R --> L --> I --> W
  K -- "direct read, no backend needed" --> W
  K -- "directory + reconcile" --> I
```

- **Truth on chain, caches off chain.** The ledger and search index can be deleted and rebuilt from Arkiv. A fresh server did exactly that: it adopted every published alert by row id and published zero duplicates.
- **Content-addressed lineage.** Source bytes sha256 → row id → alert entity → case. Any alert traces back to the exact document.
- **Deterministic first, AI at the edges.** A table-geometry parser handles almost every row. An LLM sees only rejected rows, and every value it returns must appear in the source text.
- **No backend needed to check.** The web app can query Arkiv directly, filtered by `$creator`.
- **Privacy by locality.** Checks, the cabinet and photos stay on your device.

## The pipeline

[`Nazar-backend/`](Nazar-backend/README.md) is a TypeScript/Node 24 service with a CLI, a cron worker and a Hono API. It runs on Railway in **Singapore**, because CDSCO refuses connections from US cloud regions; the region is pinned in [`.railway/railway.ts`](Nazar-backend/.railway/railway.ts).

### Sources (live-verified)

| Source | Format | Notes |
|---|---|---|
| CDSCO online (`cdscoonline.gov.in`) | JSON tables | Monthly NSQ and spurious lists, 2019 onwards |
| CDSCO alerts (`cdsco.gov.in`) | PDF, text layer | 2024+ landscape and legacy portrait templates |
| Tamil Nadu Drugs Control | PDF, text layer | NSQ lists (columns change month to month) and recall notices |
| Maharashtra FDA | HTML table | Mixed date formats, flaky DNS (fallback IP) |
| WHO Medical Product Alerts | API + PDF annex | Only India-related alerts |
| Curated seed | JSON | Reviewed rows with source links, e.g. the Oct 2025 DEG syrups |
| Telangana, Karnataka, Kerala | not enabled | Off by default: geo-blocked outside India, or site down |

### Extraction

1. **Text layer first.** pdfjs reads text positions and **the table rules drawn in the PDF** to rebuild cells.
2. **Templates:** CDSCO modern, legacy, state and spurious; TN NSQ and recall; WHO annex; generic.
3. **OCR fallback.** Tesseract on rendered pages, with a batch-only re-read for rejected cells.
4. **LLM fallback.** Claude, grounded: only for rejected rows, and any value not found in the row text is dropped.

| Confidence | Result |
|---|---|
| ≥ 0.90 | auto-publish |
| 0.60–0.89 | "Machine-read, awaiting pharmacist confirmation" |
| below 0.60 | curator queue only |

Rows with no printed batch become drug-level records that can never match a batch check. Every skipped row is counted by reason.

### What the live server holds (18 Oct 2026)

- **23 documents** harvested from 6 sources, **1,438 rows**: **1,404 alerts published to Arkiv**, 33 drug-level records, 1 in the curator queue, 0 failed documents.
- Runs on a schedule: CDSCO every 6 hours, states every 3 hours, heartbeat every 5 minutes. Each run reconciles with Arkiv before sending, so nothing is published twice.
- Watchdogs: every request, document and source has a hard deadline, so one slow government site can't stall a run.

```bash
pnpm cli sources | discover | harvest | extract <sha|file> | run | publish | arkiv:validate | check <batch> | status | heartbeat | keep-alive | worker
```

## Arkiv

Nazar uses Arkiv as its data layer. Everything Arkiv-specific lives in [`arkiv/`](arkiv/README.md):
- the data contract ([`schema.md`](arkiv/schema.md));
- real entities read from the chain ([`examples/`](arkiv/examples));
- runnable queries ([`queries/`](arkiv/queries));
- building notes ([`friction.md`](arkiv/friction.md)).

**On chain:**
- **Publisher wallet:** [`0xd06d85Eb20f126f796E4a341b711B1a757c66bD2`](https://tiramisu.explorer.arkiv.network/address/0xd06d85Eb20f126f796E4a341b711B1a757c66bD2).
- **Live on Tiramisu:** **21 notices, 1,404 alerts and the pipeline heartbeat**, all created by the publisher. Recount them with `cd arkiv/queries && npx tsx count.ts`, or browse them in the [Arkiv directory](https://nazar-nu.vercel.app/arkiv).
- **First transactions:** the [WHO alert N°5/2025 notice + COLDRIF/Respifresh/ReLife](https://tiramisu.explorer.arkiv.network/tx/0x9f12a1ce1e9ea0e34e4f7026ee499c403327d9526d39e3d53b682dfd7d4f898c) and the [curated seed](https://tiramisu.explorer.arkiv.network/tx/0x6a996737a022ef78d5f0dca83204793c260cea33c33410b8c761acfad0c96c9a).
- **Example SR-13 alert entity:** [`0x346f83d7…80fe54`](https://tiramisu.explorer.arkiv.network/entity/0x346f83d7a8bed1003081605c0ad3bc76fa953b4eefea2c8a0cc9128ed180fe54). It is `readonly` with `permissionlessExtension`, severity 5, `peds=1` and `exp_ym=202704`, and its `notice` attribute links to the WHO notice entity.
- **Heartbeat entity:** [`0x43dd6702…8465`](https://tiramisu.explorer.arkiv.network/entity/0x43dd67026c7eb65ffaa1eec0784c6a8576d965f6c35f5b62ca583ef98cb58465). It lives 20 minutes and is renewed every 5 by the worker: a lease that only stays alive while the pipeline does.

**How it is modelled:**
- **Entities:** `notice`, `alert`, `retraction`, `heartbeat`, `snapshot`. Each carries `project=nazar-in-batch-alerts`, `t` and `v`.
- **Typed attributes for what we query:** `batch`, `sev`, `peds`, `exp_ym`, `alert_ym`, `state`, `case`, `rid`, `notice` (key), and more. Display detail goes in the JSON payload.
- **Lifetimes follow product logic.** An alert lives until the batch expires + 180 days, and a notice lives 5 years. A retraction lives for the alert's remaining life + 1 year.
- **Flags:** alerts are `readonly` and allow `permissionlessExtension`. No one can rewrite an alert, but anyone can keep one alive while the batch is still on shelves (`pnpm cli keep-alive <key>`).
- **Writes:** one atomic `executeBatch` per notice, using predicted keys so alerts link to their notice in the same transaction. Writes are idempotent by row id and serialised per wallet.
- **Reads:** always `eq(project)`, `eq(t)` and `.createdBy(publisher)`. Paging pins each page to its first block (`.atBlock(block).cursor(cursor)`).

```ts
client.select({ key: true, attributes: true, payload: true })
  .where(eq('project', str('nazar-in-batch-alerts')), eq('t', str('alert')), eq('batch', str('sr13')))
  .createdBy('0xd06d85Eb20f126f796E4a341b711B1a757c66bD2')
  .fetch()
```

## MCP server

Endpoint: **`https://nazar-api-production.up.railway.app/mcp`** (Streamable HTTP, stateless, read-only, no account).

```bash
claude mcp add --transport http nazar https://nazar-api-production.up.railway.app/mcp
```

Cursor (`~/.cursor/mcp.json`): `{"mcpServers":{"nazar":{"url":"https://nazar-api-production.up.railway.app/mcp"}}}`. VS Code (`.vscode/mcp.json`): `{"servers":{"nazar":{"type":"http","url":"…/mcp"}}}`. Claude Desktop, claude.ai and ChatGPT: add a custom connector with the URL.

Tools: `check_batch`, `search_alerts`, `recent_alerts`, `get_case` (Batch Passport), `list_sources`, and `arkiv_proof`, which reads the alert straight from Arkiv so the answer can be verified without trusting Nazar. The server's instructions carry the same rules as the app: four states, never "safe", always cite the notice and the Arkiv entity. Ask: *"Is batch SR-13 of Coldrif flagged?"* Details: [`Nazar-backend/README.md`](Nazar-backend/README.md#mcp-server).

## Run it yourself

Requires Node 22.5+ (24 recommended) and pnpm 10.

```bash
# 1. Backend: harvest real alerts, then serve the API on :8787
cd Nazar-backend
pnpm install
cp .env.example .env && pnpm cli wallet:new     # prints only the address; the key stays in .env
pnpm cli run --since 202601 --limit 6           # discover → harvest → extract → resolve (dry-run publish)
pnpm start

# 2. Web app on :3000 (reads the API, then Arkiv directly, then the saved copy, then demo data)
cd ../Nazar-frontend
pnpm install
cp .env.example .env.local
pnpm dev
```

To publish for real:
1. Fund the publisher at <https://hub.arkiv.network/faucet>.
2. Run `pnpm cli arkiv:validate`.
3. Run `pnpm cli publish --live`.

**Deploy:**
- **Backend:** Railway, Fly.io or any Docker host. See [`Nazar-backend/docs/deploy.md`](Nazar-backend/docs/deploy.md); keep it in an Asian region.
- **Web app:** Vercel. Set `NEXT_PUBLIC_NAZAR_API_URL`, `NEXT_PUBLIC_NAZAR_PUBLISHER` and `NEXT_PUBLIC_ARKIV_RPC_URL`. Set `NAZAR_API_ORIGIN` (the API's https origin) to route the browser through the same-origin `/api/nazar/*` rewrite, so API reads are cached at Vercel's edge.

## Tests

| Suite | What it covers | Run |
|---|---|---|
| Backend unit + golden | **389 tests.** Domain rules, sources (real HTML/JSON fixtures), harvest, extraction golden files for every real PDF, resolve, publisher (dry-run, idempotency, chunking, catch-up), reader, Arkiv directory, snapshot and caches, medicine explainer (schema, guardrails, limits, Gemini retry and fallback), API, MCP server (tools, stateless HTTP round trip, limits), watchdogs, egress check, secret redaction | `cd Nazar-backend && pnpm test` |
| Scanner parsers | 22 tests: GS1 element strings and Digital Links, pack key-value text, full pack labels, noise | `cd Nazar-frontend && pnpm test:scan` |
| Frontend e2e | **365 checks** (247 with the API down, 118 with a mocked API) in headless Chrome over CDP. Covers onboarding, every result state, look-alikes, the watching eye, the proof sheet, sharing and `/b/` pages, the saved-copy fallback, Feed and the India pulse, the Cabinet shelf, How it works, the Arkiv directory, Strip Scan (upload path), 360–430px layouts, dark mode, reduced motion and console errors | `cd Nazar-frontend && pnpm build && pnpm e2e` |
| Backend live | Hits the real regulator sites (opt-in) | `pnpm test:live` |

**How it stays up to date.** The worker on Railway checks CDSCO every 6 hours and the state regulators every 3 hours (`NAZAR_CRON_CDSCO`, `NAZAR_CRON_STATES`). A new notice is fetched, read, resolved and published to Arkiv with no one in the loop, and the heartbeat entity renews every 5 minutes. The API and its snapshot read the same ledger, so new alerts reach the app on the next check.

GitHub Actions:
- **CI**, on every push: backend typecheck and tests, frontend typecheck, scanner tests and build, then the e2e suite.
- **Pipeline**, every 6 hours: harvest, extract and publish. Dry-run unless `NAZAR_PUBLISH_MODE=live` is set and the publisher key is in the repository secrets.
- **Refresh saved snapshot**, daily: fetches the API's snapshot into `Nazar-frontend/public/data/snapshot.json` and commits it only if the alert set changed, which redeploys the site with a fresh offline copy.
- **Monitor**, hourly: fails, which emails the owner, if the API is down, CDSCO is unreachable from the server's region, the on-chain heartbeat is stale, or SR-13 stops being flagged.

## Project structure

```
Nazar/
├── arkiv/                  README, schema.md, friction.md, examples/ (real entities), queries/ (runnable)
├── Nazar-backend/          pipeline, Arkiv publisher/reader/directory, API, CLI, worker
│   ├── src/{sources,pipeline,extract,resolve,arkiv,api,domain,storage,lib}
│   ├── .railway/railway.ts Railway infrastructure as code (Singapore)
│   ├── Dockerfile, fly.toml, render.yaml, docs/deploy.md
│   └── test/{unit,golden,fixtures,live}
├── Nazar-frontend/         Next.js 16 web app
│   ├── app/(main)/         check, feed, cabinet, arkiv, more
│   ├── components/nazar/   result card modules, scanner, cabinet, feed, arkiv directory, onboarding
│   ├── lib/source/         API client, browser Arkiv reader, demo fallback, batch matching
│   ├── lib/scan/           GS1 / label parsers, decoders, OCR
│   └── e2e/                CDP end-to-end suite + runner
├── docs/screenshots/
└── .github/workflows/      ci.yml, pipeline.yml, monitor.yml
```

**Stack:**
- **Frontend:** Next.js 16, React 19, Tailwind CSS v4, shadcn/ui on Base UI, Motion, zxing-wasm, tesseract.js.
- **Backend:** Node 24, TypeScript, pdfjs-dist, tesseract.js, Hono, node:sqlite (FTS5), Zod.
- **Arkiv:** `@arkiv-network/sdk` 0.8 with viem.
- **Hosting:** Vercel (web) and Railway, Singapore (API + worker).

## Roadmap

- [x] Batch check with four result states, severity reasons, Child Shield, look-alike guard
- [x] Real pipeline: CDSCO (API + PDFs), Tamil Nadu, Maharashtra, WHO; OCR and grounded LLM fallback
- [x] Arkiv data contract, atomic and idempotent publisher, reader, heartbeat, keep-alive
- [x] Live on Tiramisu: 21 notices, 1,404 alerts, heartbeat; backend on Railway with monitoring
- [x] Strip Scan, Feed, medicine cabinet, Arkiv directory, on-chain proof module
- [x] Pack Reader and opt-in "About this medicine" (structured, guard-railed Gemini answer, rate-limited)
- [x] Instant snapshot checks, edge caching, offline service worker
- [ ] Telangana and Karnataka adapters from an Indian host; Kerala when its site is back
- [x] MCP server for AI assistants (stateless Streamable HTTP, live Arkiv proof tool)
- [ ] Batch Passport timeline, Shelf Sweep CSV for pharmacies
- [ ] Hindi and Kannada, then 10 languages with read-aloud

## Author

Built by **Pranshu Rastogi**.

## License

[MIT](LICENSE)
