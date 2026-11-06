// Must stay the first import: it points NAZAR_DATA_DIR at a writable copy of the shipped ledger.
import './vercel-boot.ts'

import { getRequestListener } from '@hono/node-server'

import { buildProductionApp } from './main.ts'

/**
 * Vercel entry: the read API as one Node function (bundled by scripts/build-vercel.mjs into
 * .vercel/output). No worker and no publishing here; the ledger is the seed committed by the
 * pipeline workflow.
 */
export default getRequestListener(buildProductionApp().fetch)
