import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Runs before anything reads the config (src/api/vercel.ts imports it first, and ES modules
 * evaluate in import order). Vercel functions get a read-only filesystem except /tmp, so the
 * ledger snapshot shipped next to the bundle (seed/nazar.sqlite, copied in by
 * scripts/build-vercel.mjs) is copied to /tmp once per cold start and opened from there.
 * Nothing written to it survives: this deploy only reads. The pipeline refreshes the seed in git,
 * and the push redeploys.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const dir = process.env.NAZAR_DATA_DIR?.trim() || '/tmp/nazar'
process.env.NAZAR_DATA_DIR = dir
const target = path.join(dir, 'nazar.sqlite')
if (!existsSync(target)) {
  mkdirSync(dir, { recursive: true })
  copyFileSync(path.join(here, 'nazar.sqlite'), target)
}
