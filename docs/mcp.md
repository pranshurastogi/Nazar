# Use Nazar from AI agents (MCP)

Nazar runs a hosted [Model Context Protocol](https://modelcontextprotocol.io) server, so an assistant (Claude, ChatGPT, Cursor, VS Code or any MCP client) can answer "is this batch flagged?" with the same four states as the app, cite the regulator notice, and prove the alert on Arkiv. It is **read-only**, needs **no sign-in or API key**, and tells the model never to call a medicine "safe". The web guide with a live demo is at **[nazar-nu.vercel.app/ai](https://nazar-nu.vercel.app/ai)**.

```
https://nazar-api-production.up.railway.app/mcp
```

**Contents**

- [What it gives an agent](#what-it-gives-an-agent)
- [One-step setup](#one-step-setup)
- [Tools](#tools)
- [Resources and prompt](#resources-and-prompt)
- [The rules the server gives the model](#the-rules-the-server-gives-the-model)
- [A worked example](#a-worked-example)
- [Test it from a terminal](#test-it-from-a-terminal)
- [Transport, limits and privacy](#transport-limits-and-privacy)
- [Without MCP](#without-mcp)

## What it gives an agent

- **Six read-only tools:** check a batch, search, the recent feed, the Batch Passport, the sources, and a live Arkiv proof.
- **Two resources** (`nazar://about`, `nazar://schema`) and **one prompt** (`check_my_medicine`).
- **Server instructions** that tell the model how to repeat answers honestly ([below](#the-rules-the-server-gives-the-model)).
- Every alert comes with the regulator, notice title, date and URL, the severity rules that fired, and the Arkiv entity key and explorer link.

## One-step setup

| Client | Do this |
|---|---|
| **Claude Code** | Run once in a terminal: `claude mcp add --transport http nazar https://nazar-api-production.up.railway.app/mcp`. Then run `/mcp`: nazar should be listed as connected. |
| **Project `.mcp.json`** | Save the file below at a project's root, so everyone who opens it gets Nazar. Claude Code asks you to approve project servers the first time. |
| **Cursor** | Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in one project). Cursor Settings → MCP shows nazar with its six tools. |
| **VS Code** | Add `.vscode/mcp.json` to your workspace, start the server from the file, then ask in Copilot Chat in Agent mode. |
| **Claude Desktop and claude.ai** | Settings → Connectors → Add custom connector → paste the endpoint URL. |
| **ChatGPT** | Settings → Apps & Connectors → Advanced → turn on Developer mode → Create connector → paste the URL, with no authentication. |

`.mcp.json`:

```json
{
  "mcpServers": {
    "nazar": {
      "type": "http",
      "url": "https://nazar-api-production.up.railway.app/mcp"
    }
  }
}
```

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nazar": {
      "url": "https://nazar-api-production.up.railway.app/mcp"
    }
  }
}
```

`.vscode/mcp.json`:

```json
{
  "servers": {
    "nazar": {
      "type": "http",
      "url": "https://nazar-api-production.up.railway.app/mcp"
    }
  }
}
```

## Tools

| Tool | Use it for | Inputs | Sample output (first line, live server) |
|---|---|---|---|
| `check_batch` | Is this batch named in an official alert? | `batch` (string, 1–64 chars, as printed, e.g. `SR-13`) | `FLAGGED: batch SR-13 is named in 2 official regulator alert(s) (as of 2026-10-18 11:52 UTC).` |
| `search_alerts` | Alerts mentioning a brand, product, generic, maker or reason | `query` (2–100 chars), `limit?` (1–50, default 10) | `2 alert(s) matching "coldrif":` |
| `recent_alerts` | What has been flagged lately | `minSeverity?` (1–5), `childShield?` (bool: paediatric at severity 4+), `state?` (`IN-TN`), `source?` (`cdsco-online`), `limit?` (1–50, default 10) | `2 of 17 alert(s), newest first:` (with `childShield: true`) |
| `get_case` | Batch Passport: every notice that named the same batch | `caseId` (hex, from another result) | `Batch Passport for SR-13: named in 2 notice(s).` |
| `list_sources` | Which regulators Nazar reads, on or off, last checked | none | `9 sources:` then `- cdsco-online: CDSCO (IN), enabled, last checked …` |
| `arkiv_proof` | Prove an alert is genuine and unaltered, read live from Arkiv | `entityKey` (`0x` + 64 hex, the `arkiv.entityKey` of an alert) | `OFFICIAL: a live Nazar alert created by the Nazar publisher wallet 0xd06d…6bD2, read directly from Arkiv at block 737375.` |

Each tool returns a short text answer plus `structuredContent`, and is annotated read-only. For `check_batch` the structured content is `state` (`flagged` / `retracted` / `no_alert` / `unreadable`), `batch`, `asOf`, `answeredFrom`, the `alerts` (brand, product, manufacturer, reason, severity and rules, Child Shield, regulator, notice, `arkiv.entityKey` and explorer link, `caseId`), a `suggestion` for look-alikes, and links to the app and the Arkiv directory. `check_batch` shares one code path and cache with [`GET /v1/check`](api.md#get-v1check).

## Resources and prompt

- **`nazar://about`:** what Nazar is, the four answers, how severity is scored, what is out of scope.
- **`nazar://schema`:** the Arkiv data contract in brief (full version: [`arkiv/schema.md`](../arkiv/schema.md)).
- **Prompt `check_my_medicine`** (optional `medicine` argument): walks a person through finding "B. No." on the pack, typing it exactly, and reading the answer honestly.

## The rules the server gives the model

The server sends these as its MCP `instructions` (verbatim in [`Nazar-backend/src/mcp/server.ts`](../Nazar-backend/src/mcp/server.ts)):

1. Exactly one of four states. Report it as given; never upgrade or soften it.
2. Never say a medicine is "safe", "genuine", "fine" or "approved". "No alert found" is not a safety certificate.
3. When flagged, name the regulator, the notice title and date, link the notice and the Arkiv entity, and give the reason in the regulator's words. Advise: stop using it, keep the pack, return it to the chemist, see a doctor if it was taken.
4. A "did you mean" suggestion is never a flag: ask the person to re-read the pack.
5. The same batch number can be used by different makers: confirm the brand and manufacturer on the pack match.
6. Use `arkiv_proof` to show the alert can be verified without trusting Nazar.
7. Out of scope: general medicine information, dosing and medical advice.

## A worked example

> **User:** Is batch SR-13 of Coldrif safe for my child?

The agent calls `check_batch({ "batch": "SR-13" })` and gets (trimmed):

```text
FLAGGED: batch SR-13 is named in 2 official regulator alert(s) (as of 2026-10-18 11:52 UTC).
- COLDRIF (paracetamol, chlorpheniramine maleate, phenylephrine, sodium citrate) (batch SR-13) | Sresan Pharmaceutical | Adulterated: Contaminated: 48.6% w/v DEG | severity 5/5, Child Shield | WHO, "WHO Medical Product Alert N°5/2025: Substandard (contaminated) oral liquid medicines" (2025-10-13) https://cdn.who.int/… | Arkiv https://tiramisu.explorer.arkiv.network/entity/0x346f83d7…80fe54
- … (the same batch in the WHO / CDSCO curated notice)
Confirm the brand and manufacturer on the pack match. If they do: stop using it, keep the pack, return it to the chemist, and see a doctor if it was taken.
```

> **Agent:** **Flagged.** Batch SR-13 of COLDRIF is named in 2 official regulator alerts. WHO listed it in Medical Product Alert N°5/2025 (13 Oct 2025) as adulterated: "Contaminated: 48.6% w/v DEG". The maker on the alert is Sresan Pharmaceutical. Severity 5/5, with Child Shield because it is a children's medicine. First check that the brand and manufacturer on your pack match. If they do: stop giving it, keep the pack, return it to the chemist, and see a doctor if your child has taken it. Notice: [WHO PDF] · Proof: [Arkiv entity]. This is not medical advice.

For independent verification, the agent then calls `arkiv_proof({ "entityKey": "0x346f83d7a8bed1003081605c0ad3bc76fa953b4eefea2c8a0cc9128ed180fe54" })`. It reads the entity live from Arkiv with `getEntity`, never from Nazar's database, and returns its attributes, payload, creator, whether that creator is the Nazar publisher, its flags and its expiry. The verdict is `OFFICIAL`, `NOT NAZAR` (no project tag), `NOT OFFICIAL` (the tag copied by another wallet) or `NOT FOUND` (never existed, or expired).

## Test it from a terminal

The server is stateless, so any single JSON-RPC call works on its own (no `initialize` needed first). The `Accept` header should list both types; the server completes it for clients that send only one.

```bash
# initialize: server info and the instructions
curl -s https://nazar-api-production.up.railway.app/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# tools/list
curl -s https://nazar-api-production.up.railway.app/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# tools/call check_batch: the reply should start with "FLAGGED: batch SR-13"
curl -s https://nazar-api-production.up.railway.app/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"check_batch","arguments":{"batch":"SR-13"}}}'
```

With the MCP Inspector CLI:

```bash
npx -y @modelcontextprotocol/inspector@0.17.2 --cli https://nazar-api-production.up.railway.app/mcp --transport http --method tools/list
npx -y @modelcontextprotocol/inspector@0.17.2 --cli https://nazar-api-production.up.railway.app/mcp --transport http --method tools/call --tool-name check_batch --tool-arg batch=SR-13
```

Locally, run `pnpm start` in `Nazar-backend` and use `http://localhost:8787/mcp` ([development](development.md#run-it-yourself)).

**If something looks off:** opening the URL in a browser returns **405** (expected: only POST is answered). If a client asks for OAuth, choose no authentication. If tools do not show up, check the URL ends in `/mcp` and restart the client.

## Transport, limits and privacy

- **Transport:** Streamable HTTP, **stateless**: every POST gets a fresh server and transport, no sessions, JSON responses (no SSE). `GET` and `DELETE` return 405. CORS is open to every origin on `/mcp`.
- **Read-only.** Every tool is annotated read-only; nothing can be written through the server.
- **No personal data.** No account, sign-in or key. Nazar receives only tool arguments (a batch number, search words or an id), never the conversation. Logs keep the tool name, outcome and duration, never the arguments.
- **Limits:** 60 tool calls per minute and 240 requests per minute per client, where a client is a salted hash of its IP held in memory; request bodies up to 64 KB (413 above). Over the request limit the server answers HTTP 429 with `Retry-After`; over the tool limit, a tool answers "Rate limited: Nazar allows 60 tool calls per minute per client. Try again in N s."
- **Not exposed:** the app's AI medicine explainer, pack identification and the RSS feeds. Dosing and medical questions belong with a pharmacist or doctor.

Code: `src/mcp/server.ts` (tools, resources, prompt, instructions), `src/mcp/http.ts` (stateless transport, limits), `src/mcp/proof.ts` (live Arkiv read). Tests: `test/unit/mcp.test.ts`.

## Without MCP

Agents and scripts can call the same [REST API](api.md) the app uses, or read [Arkiv directly](arkiv.md):

```bash
curl -s 'https://nazar-api-production.up.railway.app/v1/check?batch=SR-13' | jq '{state, batch, alerts: [.alerts[] | {brand, authority, noticeTitle, severity, entityKey}]}'
```

The whole publishable alert set is also a static file, [`nazar-nu.vercel.app/data/snapshot.json`](https://nazar-nu.vercel.app/data/snapshot.json) (format in [docs/api.md](api.md#get-v1snapshot)).
