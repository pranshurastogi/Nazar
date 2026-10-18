# Nazar documentation

Nazar checks Indian medicine batches against regulator alerts and publishes every alert to Arkiv, so anyone can verify it. These guides cover the product, the data on Arkiv, the interfaces for agents and developers, and how the system is built and run. Start with the [main README](../README.md) for the overview, or the judges' tour for a 2-minute walk-through.

| Guide | Read it for |
|---|---|
| [For judges: a 2-minute tour](for-judges.md) | the track fit, why Arkiv is essential, a click-by-click verification path, real vs demo, numbers and limits |
| [Features](features.md) | every feature in depth (check and scan, alerts, cabinet, shelf sweep, sharing, Hindi, offline) with the screenshot gallery |
| [Use the data on Arkiv](arkiv.md) | the entity types, copy-paste SDK examples, raw query strings and runnable scripts |
| [Use Nazar from AI agents (MCP)](mcp.md) | per-client setup, the six tools, the honesty rules, a worked example, testing and limits |
| [REST API](api.md) | every endpoint with parameters and examples, feeds, errors, rate limits, CORS and caching |
| [How it works](architecture.md) | the diagram, pipeline, extraction tiers, severity, the Arkiv contract in brief, automation, fallback chain and privacy |
| [Development](development.md) | running it yourself, environment variables, deploy, tests and CI, project structure, contributing |

Reference material elsewhere in the repo:

| File | What it is |
|---|---|
| [`arkiv/README.md`](../arkiv/README.md) | the Arkiv query reference and runnable query scripts |
| [`arkiv/schema.md`](../arkiv/schema.md) | the full Arkiv data contract |
| [`arkiv/friction.md`](../arkiv/friction.md) | what was hard while building on Arkiv, with workarounds |
| [`Nazar-backend/README.md`](../Nazar-backend/README.md) | the pipeline internals: sources, extraction, resolve, publishing, CLI |
| [`Nazar-backend/docs/deploy.md`](../Nazar-backend/docs/deploy.md) | step-by-step deployment (Railway, Fly.io, Render, Docker, Vercel) |
| [`llms.txt`](../llms.txt) | a short index of these docs for language models |
