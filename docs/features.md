# Features

Everything the Nazar web app does, grouped by what you came to do: check a batch, follow alerts, watch your own medicines, sweep a shelf, share a result, or verify the record yourself. Every surface follows one rule: **Nazar never says a medicine is "safe".** It repeats what a named regulator published, on which date, with the document, and "No alert found" is never shown in green.

**Contents**

- [Where things are](#where-things-are)
- [The four answers](#the-four-answers)
- [Check and scan](#check-and-scan): [check a batch](#check-a-batch) · [look-alikes](#look-alikes) · [Strip Scan](#strip-scan) · [Pack Reader](#pack-reader) · [the result card](#the-result-card) · [Child Shield](#child-shield) · [severity with reasons](#severity-with-reasons) · [on-chain proof](#on-chain-proof)
- [Alerts](#alerts): [search](#search-by-medicine-or-maker) · [new since your last visit](#new-since-your-last-visit) · [India pulse](#india-pulse) · [filters](#filters) · [RSS](#subscribe-rss-atom-json-feed)
- [Cabinet](#cabinet): [your shelf, watched](#your-shelf-watched) · [add from a photo](#add-from-a-photo) · [nav badges](#nav-badges)
- [Shelf sweep](#shelf-sweep)
- [Sharing](#sharing)
- [About this medicine](#about-this-medicine)
- [Hindi](#hindi)
- [How it works page](#how-it-works-page)
- [AI assistant page](#ai-assistant-page)
- [Arkiv directory](#arkiv-directory)
- [Offline and fallback](#offline-and-fallback)
- [Accessibility and performance](#accessibility-and-performance)
- [Screenshot gallery](#screenshot-gallery)

## Where things are

| Route | Page | Desktop rail | Phone bar |
|---|---|---|---|
| `/` | Check | Look up → Check | Check |
| `/feed` | Alerts | Look up → Alerts | Alerts |
| `/sweep` | Shelf sweep | Look up → Shelf sweep | (linked from Check and More) |
| `/cabinet` | My cabinet | Yours → My cabinet | Cabinet |
| `/arkiv` | On-chain (Arkiv directory) | Verify → On-chain | (linked from every proof and from More) |
| `/ai` | AI assistant | Verify → AI assistant | AI |
| `/more` | How it works | Learn → How it works | More |
| `/b/[batch]` | Public share page for one batch | | |

`/?batch=SR-13` (or `/?b=SR-13`) opens a check directly.

## The four answers

| Answer | Colour | Meaning |
|---|---|---|
| **Flagged** | red | A named regulator listed this exact batch as not of standard quality, spurious, adulterated or misbranded. You get the notice, its date and the reason in the regulator's words. |
| **Retracted** | amber | An alert on this batch was withdrawn or corrected. The original stays on record. |
| **No alert found** | slate grey | No regulator alert Nazar reads names this batch yet. Always shown with "This is not a safety certificate." |
| **Can't tell** | amber | The batch could not be read, or only a look-alike matched. It offers "Did you mean…?" and never a flag. |

The same four states come back from the [REST API](api.md#get-v1check) (`flagged`, `retracted`, `no_alert`, `unreadable`) and the [MCP server](mcp.md#tools).

## Check and scan

### Check a batch

Type the batch number from the pack and press **Check batch**. A printed label is ignored, so `B.No. SR-13` works the same as `SR-13`. Batch numbers use letters, digits and `- / . ( )`; anything else is answered "Can't tell" on the device, before any network call. Brackets are kept: `(N)25567` is a real CDSCO batch.

While you type, the watching eye beside the heading looks at the batch box; while it checks, it scans; then it turns red, amber or slate. It never turns green.

Below the box: live **High-severity alerts**, the latest **Child Shield** alerts, **Recent checks** (kept only on this device), and a link to [Shelf sweep](#shelf-sweep) for long lists. A first-run guide shows where to find "B.No." on a pack, the four answers, and how the proof works.

### Look-alikes

Printed batches are easy to misread: 0/O, 1/I/L, 5/S, 8/B. When the exact batch has no alert but a look-alike does, Nazar answers **Can't tell**: "5R-13 has no alert, but it is one character away from SR-13, which is named in a regulator alert. Check the batch number on the pack again." It offers **Check SR-13** as a button. A look-alike is never shown as a flag.

### Strip Scan

**Scan the pack** reads the code or the printed batch line with the camera, or from a photo you upload.

- **Codes first.** QR, Data Matrix and GS1 codes (element strings and Digital Link URLs) are decoded on the device with the browser's `BarcodeDetector`, or with `zxing-wasm` served from the site itself when the browser has none.
- **Printed text next.** Without a code, `tesseract.js` reads the label in a Web Worker and the "B.No." line is parsed.
- **Mismatch warning.** If the code and the printed batch disagree: "Label details don't match. Show this pack to your chemist."
- **Private.** Images are read on this device and never leave it.

### Pack Reader

The Pack Reader reads the whole label on the device, not only the batch: **brand**, the product (generic) line, **composition (salts with strengths)**, dosage form, pack size, manufacturer and its state, manufacturing licence, MRP and Schedule H/H1 warnings, plus batch, manufacture and expiry dates. Every field carries a confidence and can be edited.

- **Brand, not the generic line.** Tesseract returns each line's letter height and confidence. The reader scores lines by ®/™ marks, letter height, brand-like words (ALL-CAPS or Title-case with digits or suffixes like CV, D, Plus), repetition and position above the generic line, and accepts only a clear winner. About 330 Indian salts, dosage forms, units, company and label words, addresses and batch-like codes can never be the brand. A GS1 AI 240/241 field, "Brand Name:" text or a `?product=` link supplies the brand when present.
- **Salts.** Composition is read with or without a heading, with OCR fixes inside strengths (`65O rng` → `650 mg`, `lO` → `10`, `1P` → `IP`), multi-line names, vitamins such as D3 and B12, IU and `% w/v`, and misspelled salts snapped to the known spelling.
- **A batch never comes from a name.** Batch and dates come only from the batch grammar.

The parsers are pure functions with 39 unit tests (`pnpm test:scan`; see [development](development.md#tests-and-ci)).

### The result card

A flagged answer shows, top to bottom:

1. **Verdict header:** the state, batch, product and maker, "Official · from regulator notices, verified on Arkiv", and the time checked.
2. **[Child Shield](#child-shield)** when it applies.
3. **What to do:** stop using it, keep the pack, return it to your chemist, and talk to a doctor if it was already taken.
4. **Notice timeline:** "2 notices name this batch", each with the regulator, date, reason as printed, and a link to the document.
5. **[Why severity N](#severity-with-reasons).**
6. **Save and share:** Save to cabinet (or "In cabinet"), Share, Copy link and WhatsApp.
7. **How do we know?** opens the proof drawer ([on-chain proof](#on-chain-proof)).

"No alert found" always says "This is not a safety certificate. It only means no regulator has published an alert for this batch yet." "Retracted" says "The original alert stays on record."

### Child Shield

When a flagged alert is for a children's formulation, the card shows a red **Child Shield** banner: "This is a children's formulation. If a child has taken it, contact a doctor now." The Check page and the [Alerts filters](#filters) also list Child Shield alerts; the Check page's list, the Arkiv query (Q4) and the MCP `childShield` option mean paediatric **and** severity 4 or above.

### Severity with reasons

Severity (1 to 5) comes from a versioned rule table (`sev-2026.10.1`), not a black box, and the card shows the rules that fired, for example:

> Adulterated with a toxic glycol: base 5 · Paediatric formulation: +1 (capped at 5)

The full table is in [architecture](architecture.md#severity).

### On-chain proof

Every alert carries its chain of custody: **regulator document → SHA-256 → Arkiv `notice` entity → Arkiv `alert` entity**, created by Nazar's publisher wallet. **How do we know?** shows the publisher, the notice, the source hash and the Arkiv entity, with links to the regulator's document and to the entity on the [Tiramisu explorer](https://tiramisu.explorer.arkiv.network/address/0xd06d85Eb20f126f796E4a341b711B1a757c66bD2). You can check the same entity yourself with the SDK ([example 5 in docs/arkiv.md](arkiv.md#5-verify-one-entity)) or the MCP `arkiv_proof` tool.

## Alerts

`/feed` lists every regulator alert, newest first. Rows show the brand, batch, maker, regulator, severity and "Child" where it applies; open one for the proof. Undated rows say "Date not listed" and sort after dated ones.

### Search by medicine or maker

Search by brand, product, generic name or manufacturer (`Coldrif`, `Dolo`, `Sresan`). It uses the API's full-text search, and Nazar's saved copy when the API cannot answer. If the words look like a batch number, it offers "Check this batch". When filters hide some matches, it says how many and offers to reset them.

### New since your last visit

Alerts you have not seen on this device get a **New** pill, with "N new alerts since your last visit" and **Mark all seen**. The state lives only in this browser's `localStorage` (nothing is sent anywhere). Your first visit marks nothing as new, and old notices published late are not called new.

### India pulse

Above the list: headline counts, a tile map of Indian states shaded by how many failed batches were made there (with severity-5 and Child Shield marks), and a monthly severity "seismograph". Tap a state to filter the list.

### Filters

Severity (**All** or **Serious 4–5**), **Child Shield only**, **Made in** (state) and **Source**. Filters are kept in the URL, so a filtered view can be shared. The API also accepts `productClass` (`medicine`, `cosmetic`, `hygiene`) and `sinceYm`; see [`GET /v1/alerts`](api.md#get-v1alerts).

### Subscribe (RSS, Atom, JSON Feed)

**Subscribe (RSS)** opens a panel with a feed link that follows your current filters, in RSS 2.0, Atom 1.0 or JSON Feed 1.1, with Copy link and Open. Items link to the batch's [share page](#sharing). Details: [feeds in docs/api.md](api.md#feeds-rss-atom-json-feed).

## Cabinet

### Your shelf, watched

`/cabinet` keeps the medicines you have at home. Each saved batch sits on a shelf as a capsule: **red** flagged, **amber** can't tell or retracted, **slate** no alert found or not checked yet. Every batch is re-checked each time you open the page (or with **Re-check all**), and the shelf says when ("as of 14:05"). Expired packs and packs that expire soon get a chip. "Show only what needs a look" hides the rest.

The cabinet lives in this browser's `localStorage` and is never sent to any server; a re-check sends each batch number on its own, never names, notes or the list. **Export** and **Import** move it as a JSON file.

### Add from a photo

**Add a medicine** offers **Take a photo of the pack**, **Upload a photo** or **Type it in**. A photo is read on the device: codes first, then the whole label with the [Pack Reader](#pack-reader). The form shows each value with where it came from ("From the QR code · high confidence", "Read from the label · 91%") so you can compare it with the pack before you save. If the code and the printed batch disagree, you choose.

When the name or batch is missing, an **opt-in AI guess** can help:

- **Guess with AI** (or the switch **Use AI to fill missing details**) sends **only the text read from the label** to Nazar's server, which asks Gemini to fill the gaps. **The photo stays on the phone.** "See exactly what is sent" shows the text.
- **Get salts and details** fills an empty composition and maker the same way.
- Every value must be quoted from the label text, or the server drops it, so a batch or expiry not printed on the label is never invented. AI values are marked **AI guess · check this**, with the quote they came from; suggestions for fields you already filled change nothing unless you tap **Use this**.
- Rate-limited per client and capped per day; see [`POST /v1/medicine/identify`](api.md#post-v1medicineidentify).

### Nav badges

Badges are computed on the device with no network call of their own:

- **Alerts:** how many alerts in the saved copy this device has not seen (cleared on the Alerts page).
- **Cabinet:** how many saved medicines were flagged at their last check.

## Shelf sweep

`/sweep` checks a whole shelf at once, for chemists, pharmacies and NGOs.

- **Input:** paste batch numbers (one per line or comma-separated), upload a `.csv` or `.tsv` (up to 2 MB), or **Try a sample**. Up to 500 batches per sweep. A header row is detected (`Batch`, `B.No`, `Lot`…), and product, quantity and expiry columns are kept for the export. Duplicates are merged; unreadable lines are listed.
- **Matching:** every batch is matched on the device against Nazar's saved copy of every published alert. Only the flagged and look-alike batches are then confirmed with the live API, three at a time, the same request a single check sends. If the saved copy is not available, each batch is checked with the API.
- **Results:** flagged first, with filters by result and a search box; look-alikes say "Did you mean SR-13? Check the pack again."
- **Export:** **Download CSV** (every row, with regulator, notice and proof links), **Copy flagged list** (text with links) and **Print counter sheet** (flagged first, plain black and white). All are made in the browser.
- **Private:** the list, file, product names and quantities never leave the browser.

## Sharing

- Every batch has a public page, **`/b/SR-13`**, rendered on the server with the current answer: the state, product, manufacturer, authority, notice date, the notice and "Verify on Arkiv", plus "Check your own batch". It never shows anything from the sender's device. If the API cannot be reached, it offers to check in the app instead of an error.
- Each share page has its own **preview card** image for WhatsApp and social apps.
- From a result: **Share** (the system share sheet), **Copy link** and **WhatsApp**. The shared text matches the answer: "{brand} batch {batch}: Flagged by {authority} ({date}). Checked on Nazar." for a flag, and "Batch {batch}: No alert found on Nazar as of {date}. This is not a safety certificate." when nothing names it.

## About this medicine

Under a result and in the scanner's result, **Show general information** asks for plain-language general information about the medicine: what it is for, how it works, common side effects, warning signs, who should be careful, interactions, storage and prescription status, in six story cards.

- **Opt-in:** nothing is asked until you tap.
- **Labelled and separate:** marked *AI-generated · Not from a regulator · may be wrong*, kept apart from the verdict, with a not-medical-advice footer. On a flagged batch the official "don't use it" banner comes first.
- **Guard-railed:** a strict schema; no doses; never "safe". The batch number is never sent to the model (it is only looked up in Nazar's own alerts).
- **Context, honestly:** it can add Nazar's own counts ("Nazar has 2 regulator alerts for COLDRIF (any batch)"), and says that only a match on your batch number means your pack is affected.
- **Limits:** 5 per minute and 30 per day per client, plus a daily cap for the whole server. See [`POST /v1/medicine/explain`](api.md#post-v1medicineexplain).

## Hindi

The **EN | हिं** switch in the header (and in How it works → Settings) changes the language. The choice is kept on the device; URLs never carry the language, so links and `/b/` pages stay the same.

| Translated into Hindi | Stays as published |
|---|---|
| Navigation, Check, every result state, What to do, Child Shield, severity reasons | Regulator data: product names, makers, reasons, notice titles and authorities |
| Alerts (filters, search, India pulse, RSS panel), state names and failure reasons | Batch numbers and Arkiv keys |
| Scanner, Pack Reader, Cabinet (including add from a photo and the AI guess), onboarding | "About this medicine": the AI text is written in English, and says so |
| Shelf sweep, the AI assistant page, the share page, settings | The Arkiv directory and the How it works story, which are in English |

Dates use Indian formatting (`hi-IN`, Latin digits). Strings live in `Nazar-frontend/lib/i18n/` (`en.ts` is the source of truth, `hi.ts` mirrors it) and components read them with `useT()`.

## How it works page

`/more` tells the life of one real alert, COLDRIF SR-13, in six chapters: **Source** (a regulator publishes a notice), **Read** (Nazar reads it), **Case** (it becomes a case), **Publish** (it is written to Arkiv), **Check** (you check your batch) and **Verify** (anyone can verify). On desktop a sticky chain-of-custody stage lights up as you scroll; on phones it is a vertical stepper.

Then: live source status (which regulators are on, last checked), proof on Arkiv, using Nazar from an AI assistant, privacy, settings (language, theme, clear recent checks, clear cabinet) and about. Every section has an anchor (`/more#proof`).

## AI assistant page

`/ai` is the setup guide for the [MCP server](mcp.md): one tab per client (Claude Code, a project `.mcp.json`, Cursor, VS Code, and Claude/ChatGPT apps), each with where it goes, what to paste and how to see it worked; curl and MCP Inspector test commands; a chat demo replaying real answers for flagged, can't tell and no alert; the tools; the honesty rules the server sends; and the limits.

## Arkiv directory

`/arkiv` shows everything Nazar has on chain.

- **Hero:** the Nazar mark rebuilt from about 100k GPU particles; move across it and it turns liquid, then settles back.
- **Overview:** live counts and breakdowns (by source, state, category, failure, form, severity, Child Shield, still in date).
- **Filters → predicates:** every filter becomes an Arkiv predicate; the panel shows the exact query string and a copyable SDK program.
- **Two run modes:** **Via Nazar API** (`GET /v1/arkiv/entities`, which reads Arkiv, never Nazar's ledger) and **From my browser**, which sends the same query straight to the public Arkiv RPC with no Nazar server involved.
- **Entity drawer:** creator (and whether it is the official publisher), flags, expiry estimate and typed attributes next to the JSON payload.

The same queries as code: [docs/arkiv.md](arkiv.md).

## Offline and fallback

Every check tries these in order, and the answer says which one it came from:

1. **Nazar API** (through the same-origin `/api/nazar/*` rewrite, cached at Vercel's edge).
2. **Arkiv, from the browser**, filtered by the publisher's `$creator`. No Nazar server needed.
3. **Nazar's saved copy:** the snapshot kept on the device (IndexedDB), else the site's own [`/data/snapshot.json`](https://nazar-nu.vercel.app/data/snapshot.json), refreshed daily.
4. **Demo data**, only offline on a first visit with none of the above.

When the saved copy is loaded, it answers instantly (before any network call) and the live source then confirms or corrects the card. A service worker (production only) keeps pages and API reads available offline (network first, then the last good copy), so Alerts and the snapshot keep working; a small notice shows while the device is offline. More: [architecture → the fallback chain](architecture.md#the-fallback-chain).

## Accessibility and performance

- **Reduced motion:** the watching eye, shelf, pulse, story and particle hero all respect `prefers-reduced-motion`.
- **Touch targets:** interactive controls are at least 44 px tall; phone tabs are 56 px.
- **WebGL fallback:** the particle hero needs WebGL2; on a software renderer, with a major performance caveat, or with reduced motion it shows the still mark, and it only animates while on screen and the tab is visible.
- **Screen readers:** a skip link, labelled navigation, badge counts in the link's name, tabs and radio groups with ARIA roles.
- **Layouts:** the e2e suite checks 360–430 px widths, dark mode, reduced motion and console errors.
- **Speed:** snapshot checks answer on the device; routes prefetch on hover, focus or touch; list responses are edge-cached; the snapshot is pre-compressed (brotli or gzip).

## Screenshot gallery

### Check

| The eye watches | Flagged: the eye turns red |
|:---:|:---:|
| ![Check page with the watching eye beside "Check the batch, not just the brand", the batch box and live high-severity alerts](screenshots/home-desktop.png) | ![SR-13 checked: the eye has turned red above a flagged COLDRIF result with Child Shield and What to do](screenshots/home-flagged-eye-desktop.png) |

![A flagged batch: COLDRIF SR-13 with Child Shield, two regulator notices and the on-chain proof chain from the WHO document to the Arkiv alert entity](screenshots/result-onchain-proof-desktop.png)

| Flagged, on a phone | "How do we know?" |
|:---:|:---:|
| ![Flagged result for SR-13 on mobile, dark mode](screenshots/mobile-result-dark.png) | ![Proof sheet with publisher, notice, Arkiv entity and source hash](screenshots/mobile-proof-dark.png) |

### Strip Scan and Pack Reader

| Scanner | Pack Reader | QR scan | Label mismatch |
|:---:|:---:|:---:|:---:|
| ![Scanner prompt on mobile with the watching eye: read the pack with your camera, upload a photo or type it](screenshots/mobile-scanner-eye-dark.png) | ![Pack Reader: batch DOBS3975 read from printed text at 91% confidence, with product, composition, form, pack size, maker, state, licence and MRP from the label](screenshots/mobile-pack-reader-dark.png) | ![Scanner read SR-13 from a GS1 QR code, with expiry](screenshots/mobile-scanner-dark.png) | ![Scanner warning that the QR code and the printed batch disagree](screenshots/mobile-scanner-mismatch-dark.png) |

### Alerts: India pulse

![India pulse: headline counts, a tile map of Indian states shaded by alert count with severity-5 and Child Shield marks, and a monthly severity seismograph](screenshots/feed-india-pulse-desktop.png)

### Cabinet

| Your shelf, watched | On a phone |
|:---:|:---:|
| ![Cabinet shelf: COLDRIF SR-13 and Levcon-M as red flagged capsules, three slate "no alert found" capsules, an "Expires soon" chip and the red-eyed sentinel](screenshots/cabinet-shelf-desktop.png) | ![Cabinet on mobile: two flagged medicines, the review banner and the watched shelf](screenshots/mobile-cabinet-dark.png) |

### Sharing

| Preview card for /b/SR-13 | The share page |
|:---:|:---:|
| ![Preview card: batch SR-13, COLDRIF, Flagged, WHO, with "Verify on Arkiv"](screenshots/share-card.png) | ![Public share page for SR-13 on mobile: flagged, Child Shield, What to do and the proof](screenshots/mobile-share-page.png) |

### About this medicine

![Medicine card under a flagged SR-13 result: the official "don't use it" banner first, then AI-generated general information in six story cards with a not-medical-advice footer](screenshots/medicine-card-desktop.png)

### How it works

| The story | The chain of custody | On a phone |
|:---:|:---:|:---:|
| ![How it works hero: "How Nazar works, and how to check it", the watching eye and live numbers: sources on, alerts on Arkiv, the publisher wallet](screenshots/how-it-works-desktop.png) | ![Chapter view: the batch becomes a case, with a sticky chain-of-custody stage that lights up as you scroll](screenshots/how-it-works-journey-desktop.png) | ![How it works on mobile: hero, live numbers and section chips](screenshots/mobile-more-dark.png) |

### Arkiv directory

| Hero at rest | Under the cursor |
|:---:|:---:|
| ![Arkiv page hero: the Nazar capsule mark made of particles, "Every alert, verifiable by anyone", and the three steps from regulator to Arkiv to anyone](screenshots/arkiv-hero-desktop.png) | ![The same hero with the capsule dissolving into liquid particles under the cursor](screenshots/arkiv-hero-liquid-desktop.png) |

| Directory | Filtered: Child Shield, severity 4+ | Entity: attributes vs payload |
|:---:|:---:|:---:|
| ![Arkiv directory: live counts of notices, alerts and heartbeat with the live query panel](screenshots/arkiv-directory-desktop.png) | ![Directory filtered to paediatric alerts at severity 4 or above, with the matching Arkiv query](screenshots/arkiv-filtered-desktop.png) | ![Entity drawer: official publisher, flags, expiry estimate and typed attributes](screenshots/arkiv-entity-drawer-desktop.png) |
