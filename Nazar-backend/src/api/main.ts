import { pathToFileURL } from 'node:url'

import { serve } from '@hono/node-server'

import { publicClient, publisherAddress } from '../arkiv/client.ts'
import { ArkivReader } from '../arkiv/reader.ts'
import { env } from '../config/env.ts'
import { errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { pipelineStatus } from '../pipeline/status.ts'
import { ledger as sharedLedger } from '../storage/ledger.ts'
import { createApp } from './app.ts'

const log = child('server')

/** Wires the API to the real ledger, the Arkiv reader and the pipeline status, then listens on PORT. */
export function buildProductionApp() {
  const e = env()
  const ledger = sharedLedger()
  const publisher = publisherAddress()
  const reader = publisher ? new ArkivReader({ publisher }) : null
  return createApp({
    ledger,
    reader,
    publisher,
    mode: e.NAZAR_PUBLISH_MODE,
    chainId: e.ARKIV_CHAIN_ID,
    status: () =>
      pipelineStatus({
        ledger,
        mode: e.NAZAR_PUBLISH_MODE,
        address: publisher,
        client: publicClient(),
        // Only a live pipeline writes heartbeats on chain; in dry-run there is nothing to read.
        chainHeartbeat: reader && e.NAZAR_PUBLISH_MODE === 'live' ? () => reader.heartbeat() : null,
      }),
  })
}

/** Containers need the API on every interface; HOST can narrow it (e.g. 127.0.0.1 behind a local proxy). */
export const listenHost = () => process.env.HOST?.trim() || '0.0.0.0'

export function startServer(port = env().PORT, o: { beforeExit?: () => Promise<void>; handleSignals?: boolean } = {}) {
  const app = buildProductionApp()
  const hostname = listenHost()
  const server = serve({ fetch: app.fetch, port, hostname }, (info) => log.info({ port: info.port, hostname }, `Nazar API listening on http://${hostname}:${info.port}`))
  if (o.handleSignals !== false) {
    let closing = false
    const shutdown = (sig: string) => {
      if (closing) return
      closing = true
      log.info({ sig }, 'shutting down')
      // The worker (role "all") may be mid-run; give it its own grace period before the hard stop.
      setTimeout(() => process.exit(0), o.beforeExit ? 40_000 : 5000).unref()
      void (o.beforeExit?.() ?? Promise.resolve())
        .catch((err) => log.warn({ err: errorMessage(err) }, 'shutdown hook failed'))
        .finally(() => server.close(() => process.exit(0)))
    }
    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))
  }
  return server
}

export type Role = 'api' | 'worker' | 'all'

export function parseRole(v: string | undefined): Role {
  const r = (v ?? 'api').trim().toLowerCase()
  if (r === '' || r === 'api') return 'api'
  if (r === 'worker' || r === 'all') return r
  throw new Error(`NAZAR_ROLE must be api, worker or all (got "${v}")`)
}

/**
 * Container entry point. NAZAR_ROLE picks what this process runs:
 *   api    – the read API only (default; scale it freely);
 *   worker – the scheduler only (crons for harvesting, publishing and the heartbeat);
 *   all    – both in one process, sharing one SQLite ledger (the simplest single-machine deploy).
 * Run at most one worker per publisher wallet: key prediction assumes a single writer.
 */
export async function startRole(role: Role = parseRole(process.env.NAZAR_ROLE)) {
  log.info({ role }, 'starting')
  if (role === 'api') return void startServer()
  const { startWorker } = await import('../pipeline/worker.ts')
  if (role === 'worker') return void (await startWorker({ ledger: sharedLedger() }))
  const worker = await startWorker({ ledger: sharedLedger(), handleSignals: false })
  startServer(env().PORT, { beforeExit: () => worker.stop() })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startRole().catch((err) => {
    log.fatal({ err: errorMessage(err) }, 'failed to start')
    process.exit(1)
  })
}
