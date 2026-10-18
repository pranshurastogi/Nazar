# For judges: a 2-minute tour

Nazar checks any Indian medicine batch number against the alerts published by CDSCO, state drug regulators and WHO, and answers in seconds with the regulator's own notice. Every alert is a public entity on Arkiv, so anyone can verify the answer without trusting Nazar.

**Contents:** [Track fit](#track-fit) · [Why Arkiv is essential](#why-arkiv-is-essential) · [The 2-minute path](#the-2-minute-path) · [Real vs demo](#real-vs-demo) · [Engineering depth](#engineering-depth) · [Honesty rules](#honesty-rules) · [Known limits](#known-limits)

## Track fit

Built for the **Arkiv Global Tour, Best Indian Use Case** track.

- **Indian regulators:** CDSCO (its online NSQ portal and its alert PDFs), Tamil Nadu Drugs Control and Maharashtra FDA, plus WHO alerts that name India.
- **A real Indian harm:** on 2 Oct 2025 Tamil Nadu declared batch **SR-13** of COLDRIF syrup adulterated (48.6% w/v diethylene glycol) after child deaths; WHO listed it on 13 Oct 2025. Every state rewrote the alert by hand while the pack's printed expiry ran to April 2027. In Nazar, SR-13 is flagged with Child Shield and both notices.
- **For Indian users:** a chemist at the counter, a parent at night, a pharmacy sweeping a stock CSV. The app has a **Hindi** mode (EN | हिं) for checking, results, alerts, the scanner and the cabinet.

## Why Arkiv is essential

Arkiv is the database, not a badge on a dashboard.

- **Every alert is a public entity** with a creator (Nazar's publisher wallet), `readonly` flags (nobody can rewrite it, Nazar included) and an expiry tied to the batch's shelf life (+180 days). Corrections are separate `retraction` entities.
- **Anyone can verify without Nazar:** filter by the project tag and `$creator`, or read one entity by key ([SDK examples](arkiv.md)).
- **The app falls back to Arkiv:** when the Nazar API is down, the browser queries Arkiv directly ([fallback chain](architecture.md#the-fallback-chain)).
- **AI agents can prove it:** the MCP tool `arkiv_proof` reads the entity live from Arkiv and says `OFFICIAL`, `NOT NAZAR`, `NOT OFFICIAL` or `NOT FOUND` ([MCP](mcp.md)).
- **The `/arkiv` directory** turns filters into Arkiv predicates, shows the query string and SDK code, and can run "From my browser" with no Nazar server.
- **Nazar's servers are caches:** a fresh server rebuilt its ledger from Arkiv and published zero duplicates. Alerts allow `permissionlessExtension`, so a chemist or an NGO can keep one alive.

## The 2-minute path

| # | Do this | You should see |
|---|---|---|
| 1 | Open **[nazar-nu.vercel.app](https://nazar-nu.vercel.app)**, type `SR-13`, press **Check batch** | **Flagged**, COLDRIF, severity 5, a **Child Shield** banner, "2 notices name this batch", What to do |
| 2 | Click **How do we know?** | The publisher wallet, the regulator notice, the source document's SHA-256 and the Arkiv entity |
| 3 | Open the entity on the explorer: [`0x346f…fe54`](https://tiramisu.explorer.arkiv.network/entity/0x346f83d7a8bed1003081605c0ad3bc76fa953b4eefea2c8a0cc9128ed180fe54) (publisher: [`0xd06d…6bD2`](https://tiramisu.explorer.arkiv.network/address/0xd06d85Eb20f126f796E4a341b711B1a757c66bD2)) | The same alert on Arkiv Tiramisu, created by Nazar's publisher |
| 4 | Type `B.No. SR-13`, then `5R-13` | The label is ignored (still **Flagged**); `5R-13` is **Can't tell** with "Did you mean SR-13?", never a flag |
| 5 | Open **[/arkiv](https://nazar-nu.vercel.app/arkiv)**, switch the run mode to **From my browser**, set **Child Shield** and severity 4+ | The query string and SDK code change with each filter; results come straight from the Arkiv RPC |
| 6 | Open **[/ai](https://nazar-nu.vercel.app/ai)**, or run `claude mcp add --transport http nazar https://nazar-api-production.up.railway.app/mcp` and ask "Is batch SR-13 of Coldrif flagged?" | The same four-state answer, with the notice and the Arkiv proof |
| 7 | Open **[/b/SR-13](https://nazar-nu.vercel.app/b/SR-13)** | The public share page with its preview card, the notice and "Verify on Arkiv" |
| 8 | Open **[Alerts](https://nazar-nu.vercel.app/feed)** → **Subscribe (RSS)**, or the feed itself: [`/v1/alerts.rss`](https://nazar-api-production.up.railway.app/v1/alerts.rss) | An RSS feed that follows your filters; items link to `/b/` pages |

More batches to try: `TG25-2281A` (Levcon-M, CDSCO spurious), `R01GL2523` and `LSL25160` (Respifresh TR and ReLife, the same WHO alert), `AB1234` (**No alert found**, "not a safety certificate"). Optional: **EN | हिं** in the header switches to Hindi.

## Real vs demo

- **Real:** every alert comes from a regulator document Nazar downloaded and read; the live API holds 23 documents from 6 sources and **1,404 alerts published to Arkiv** in 21 notices (18 Oct 2026; [`/health`](https://nazar-api-production.up.railway.app/health), [`/v1/arkiv/summary`](https://nazar-api-production.up.railway.app/v1/arkiv/summary)). A heartbeat entity on Arkiv is renewed every 5 minutes.
- **Curated, and labelled:** a small seed of reviewed rows with source links (for example the Oct 2025 DEG syrups) is its own source, `curated`.
- **Demo data:** only when the device is offline on a first visit and none of the API, Arkiv or the saved copy can answer. The status pill then says "Offline · demo data".

## Engineering depth

| Area | Numbers |
|---|---|
| Sources | 9 adapters, 6 enabled: CDSCO online (JSON) and PDFs, Tamil Nadu, Maharashtra, WHO, curated |
| Extraction | PDF table geometry first, 6 templates, OCR fallback, a grounded LLM only for rejected rows (every value must appear in the source text); confidence tiers ≥ 0.90 auto, 0.60–0.89 "machine-read", below 0.60 curator queue |
| Publishing | one atomic `executeBatch` per notice with predicted keys, idempotent by row id, dry-run by default |
| Tests | **430** backend unit and golden tests, **39** scanner parser tests, **750** e2e checks in headless Chrome (363 with the API down, 387 with a mocked API) |
| Automation | Railway worker (CDSCO every 6 h, states and WHO every 3 h, heartbeat every 5 min) and 4 GitHub workflows: CI, Pipeline, Monitor (hourly: API, CDSCO egress, heartbeat, SR-13 still flagged), daily snapshot refresh |
| On the device | QR, Data Matrix and GS1 decoding, a Pack Reader that reads the brand and salts, a saved copy for instant and offline checks, a 500-row Shelf sweep |
| Interfaces | web app, REST API with RSS/Atom/JSON feeds, read-only MCP server with 6 tools |
| Quality | WebGL2 particle hero with a still-image fallback (software renderer, performance caveat, reduced motion); 44 px touch targets; reduced motion respected; skip link and ARIA labels; 360–430 px layouts and dark mode tested |

Details: [features](features.md), [architecture](architecture.md), [API](api.md), [development](development.md).

## Honesty rules

- **Four answers only:** Flagged, Retracted, No alert found, Can't tell.
- **Never "safe".** "No alert found" is slate grey, never green, and always says "This is not a safety certificate."
- **A look-alike is never a flag** (0/O, 1/I/L, 5/S, 8/B): it asks you to re-read the pack.
- **Severity shows its reasons** from a versioned rule table.
- **AI is opt-in and labelled:** "About this medicine" is marked AI-generated, kept apart from the verdict, never gets the batch number and gives no doses. The MCP server sends the same rules to assistants.

## Known limits

- **Coverage:** Telangana, Karnataka and Kerala are not enabled (geo-blocked outside India, or the site is down). Alerts lag the regulators' own publication.
- **A batch number is not a pack:** different makers can reuse a batch number, and a fake pack can carry a clean number, so Nazar asks you to confirm the brand and maker.
- **Machine-read rows** (confidence 0.60–0.89) are published but labelled "awaiting pharmacist confirmation".
- **Testnet:** the data lives on Arkiv's Tiramisu testnet; no `retraction` or `snapshot` entities are live yet.
- **On-device reading** can misread a blurred label; every value can be edited, and the AI guess is opt-in and text-only.
- **Hindi** covers the everyday surfaces; the Arkiv directory and the How it works story are in English, and regulator text stays as published.
- **Not medical advice:** Nazar does not give doses or diagnoses.
