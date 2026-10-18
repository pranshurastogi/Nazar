# Deploying the Nazar backend

One Docker image runs everything: the read API, the pipeline worker, or both. It runs on Fly.io, Render, Railway or any Docker host.

| `NAZAR_ROLE` | Runs | Use it for |
|---|---|---|
| `api` (default) | the read API on `PORT` (8787) | extra API replicas |
| `worker` | crons: harvest, publish, heartbeat every 5 min | a separate pipeline box |
| `all` | both in one process, sharing one SQLite ledger | the simple single-machine deploy (recommended) |

Run **at most one worker per publisher wallet**. Entity keys are predicted from the wallet's nonce, so two writers would collide.

## Where to host: pick an Indian region

Some Indian state regulator sites refuse non-Indian IPs. Telangana DCA (`dca.telangana.gov.in`) and Karnataka Drugs Control (`drugs.karnataka.gov.in`) both do. CDSCO, Tamil Nadu, Maharashtra and WHO answer from anywhere. Host in India so the state sources can be switched on:

- **Fly.io, region `bom` (Mumbai).** `fly.toml` is set up for this. The volume is created in the same region.
- **DigitalOcean droplet in BLR1 (Bengaluru)** or **AWS Lightsail in ap-south-1 (Mumbai)**, running the same image with `docker run` (see [Any Docker host](#any-docker-host)).
- Render and Railway have no Indian region. They work, but keep `tg-dca` and `ka-dc` off.

An Indian IP is necessary but may not be enough: government sites sometimes block data-centre ranges too. Test from the box before enabling a source:

```bash
# On Fly: fly ssh console; on a VM: ssh in. Expect HTTP 200 (or 30x), not a timeout or connection refused.
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 20 https://dca.telangana.gov.in/
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 20 https://drugs.karnataka.gov.in/
# Then exercise the adapter itself (listings only, no downloads):
nazar discover --source tg-dca,ka-dc --limit 3
```

If both answer, enable them with `NAZAR_SOURCES=cdsco-online,cdsco-pdf,tn-dc,mh-fda,who-mpa,curated,tg-dca,ka-dc`. Leave `NAZAR_SOURCES` empty to keep the default set.

## Environment

| Variable | Secret? | Value |
|---|---|---|
| `NAZAR_CORS_ORIGINS` | no | Comma list of allowed origins. **Must include the Vercel domain**, e.g. `https://nazar.vercel.app,https://nazar-git-main-you.vercel.app`. `*` allows any origin; the API is read-only (`GET`/`HEAD`/`OPTIONS`). |
| `NAZAR_PUBLISHER_PRIVATE_KEY` | **yes** | The publisher key (`0x` + 64 hex). It is needed for `live` publishing and the heartbeat. Without it the API still serves the ledger, but skips the Arkiv fallback for `/v1/check`. |
| `NAZAR_PUBLISH_MODE` | no | `dry-run` (default) or `live`. |
| `NAZAR_ROLE` | no | `api`, `worker` or `all`. |
| `NAZAR_RUN_ON_START` | no | `true`: the worker runs every source once at boot. Use it to fill an empty volume. |
| `ARKIV_API_KEY` | yes | Optional Arkiv access key (raises RPC rate limits). |
| `ANTHROPIC_API_KEY` | yes | Optional. Enables the grounded LLM fallback for rows the parser rejects. |
| `NAZAR_SOURCES` | no | Optional comma list of source ids. Empty means the default set. |
| `PORT`, `HOST` | no | `8787` and `0.0.0.0` by default. Render injects its own `PORT`, which is honoured. |
| `NAZAR_DATA_DIR` | no | `/app/data`. Mount a persistent volume here: it holds the ledger, raw documents and OCR data. |

Never bake `.env` into the image; `.dockerignore` excludes it. Set secrets with your host's secret store.

## Fly.io (recommended)

From `Nazar-backend/`:

```bash
fly launch --no-deploy --copy-config --name nazar-api      # or edit `app` in fly.toml
fly volumes create nazar_data --region bom --size 1
fly secrets set NAZAR_PUBLISHER_PRIVATE_KEY=0x... \
                NAZAR_CORS_ORIGINS=https://<your-app>.vercel.app
fly deploy
curl https://nazar-api.fly.dev/health
curl 'https://nazar-api.fly.dev/v1/check?batch=SR-13'
```

`fly.toml` runs one always-on machine with `NAZAR_ROLE=all`, health checks `/health`, and mounts the volume at `/app/data`. Machines never auto-stop, because the worker's heartbeat must keep renewing.

To start from an existing ledger instead of re-harvesting:

```bash
fly ssh sftp shell        # put data/nazar.sqlite /app/data/nazar.sqlite  (stop writes first, or copy a checkpointed file)
fly machine restart
```

## Railway

`railway.toml` (Dockerfile build, `/health` check, restart on failure, one replica) is in this folder. There is no Indian region; pick **Southeast Asia (Singapore)** for the lowest latency to Indian sites, and keep `tg-dca`/`ka-dc` off.

1. New Project → Deploy from GitHub repo → `pranshurastogi/Nazar`.
2. Service → Settings → **Root Directory** `Nazar-backend` (Railway then finds `railway.toml` and the `Dockerfile`).
3. Service → **Volumes** → add a volume mounted at **`/app/data`** (1 GB is plenty).
4. Service → **Variables**:
   - `NAZAR_ROLE=all`
   - `NAZAR_RUN_ON_START=true`
   - `NAZAR_DATA_DIR=/app/data`
   - `NAZAR_CORS_ORIGINS=https://nazar-nu.vercel.app`
   - `NAZAR_PUBLISH_MODE=dry-run`, then `live`
   - `NAZAR_PUBLISHER_PRIVATE_KEY=0x…` (Railway variables are encrypted)
5. Settings → Networking → **Generate Domain**; check `https://<service>.up.railway.app/health`.
6. Set `NEXT_PUBLIC_NAZAR_API_URL` to that domain in Vercel and redeploy.

Or use the CLI from `Nazar-backend/`: `railway init`, then `railway up`, `railway volume add --mount-path /app/data` and `railway domain`.

## Render

The blueprint is `render.yaml` (Docker runtime, `rootDir: Nazar-backend`, a 1 GB disk at `/app/data`, health check `/health`):

1. New, then Blueprint, then pick the repo.
2. Fill in `NAZAR_CORS_ORIGINS` and `NAZAR_PUBLISHER_PRIVATE_KEY` when prompted.

The persistent disk needs a paid plan. Region is Singapore, so leave the geo-blocked sources off.

## Any Docker host

This covers DigitalOcean BLR1, Lightsail ap-south-1, Railway, or a laptop:

```bash
docker build -t nazar-backend Nazar-backend
docker run -d --name nazar --restart unless-stopped -p 8787:8787 \
  -v nazar-data:/app/data \
  -e NAZAR_ROLE=all -e NAZAR_RUN_ON_START=true \
  -e NAZAR_CORS_ORIGINS=https://<your-app>.vercel.app \
  --env-file ./secrets.env \
  nazar-backend
```

`secrets.env` holds `NAZAR_PUBLISHER_PRIVATE_KEY=...`. Put TLS in front with Caddy, nginx, or the platform's proxy.

The image runs as the unprivileged `node` user. The entrypoint only fixes ownership of a freshly mounted volume, then drops privileges. Docker's own `HEALTHCHECK` polls `/health`. Operator commands work inside the container:

```bash
docker exec nazar nazar status
docker exec nazar nazar arkiv:validate
```

## The Vercel frontend

The web app reads the backend URL from `NEXT_PUBLIC_NAZAR_API_URL`. In Vercel, open Project, then Settings, then Environment Variables, and set:

```
NEXT_PUBLIC_NAZAR_API_URL=https://nazar-api.fly.dev
NEXT_PUBLIC_NAZAR_PUBLISHER=0xd06d85Eb20f126f796E4a341b711B1a757c66bD2
```

Redeploy afterwards: `NEXT_PUBLIC_*` values are inlined at build time. The browser calls the API directly, so the Vercel production domain (and any preview domains you use) must be in `NAZAR_CORS_ORIGINS`. Otherwise requests fail with a CORS error in the console.

## Going live on Arkiv

1. Check funding: `nazar wallet:balance`. It prints the balance and the GLM needed for the pending ledger (`eth_estimateGas` on real batches, plus 25 %). If the wallet is short, it prints the faucet steps and exits non-zero.
2. Validate everything that would be written: `nazar arkiv:validate`. It checks names, the 32-attribute limit, 128-byte strings, 128 KB payloads, i32 ranges, lifetimes, notice links and batch sizes, and estimates gas.
3. Rehearse a small first publish: `nazar publish --live --preflight --source who-mpa,curated`. This runs every live check, reads Arkiv to reconcile, predicts keys and simulates. It sends nothing.
4. Publish it for real: `nazar publish --live --source who-mpa,curated --limit-notices 5`.
5. Publish the rest: `nazar publish --live --limit-notices 50`. Repeat until it prints `nothing pending`.
6. Set `NAZAR_PUBLISH_MODE=live` and redeploy. The worker then publishes new notices on every run and renews the heartbeat entity every 5 minutes, a patch plus an extend each beat. A heartbeat create estimates at about 110k gas (about 0.0001 GLM), so budget roughly 0.05 GLM a day.

Keep Alive is permissionless: anyone can extend an alert with any funded wallet. The reference client is `nazar keep-alive <entityKey> --days 180 [--live]`. No API endpoint is needed.
