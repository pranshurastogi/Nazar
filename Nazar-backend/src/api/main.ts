import { pathToFileURL } from 'node:url'

import { serve } from '@hono/node-server'

import { publicClient, publisherAddress } from '../arkiv/client.ts'
import { ArkivReader } from '../arkiv/reader.ts'
import { env } from '../config/env.ts'
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
    status: () => pipelineStatus({ ledger, mode: e.NAZAR_PUBLISH_MODE, address: publisher, client: publicClient() }),
  })
}

export function startServer(port = env().PORT) {
  const app = buildProductionApp()
  const server = serve({ fetch: app.fetch, port }, (info) => log.info({ port: info.port }, `Nazar API listening on http://localhost:${info.port}`))
  const shutdown = (sig: string) => {
    log.info({ sig }, 'shutting down')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer()
