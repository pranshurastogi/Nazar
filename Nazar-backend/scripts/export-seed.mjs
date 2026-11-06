#!/usr/bin/env node
// Writes data/nazar.sqlite (the live ledger, WAL included) to seed/nazar.sqlite as one compact,
// self-contained file. The seed is committed: the Vercel read API ships it, and the pipeline
// workflow starts from it and commits it back when the ledger changed.
//
//   node scripts/export-seed.mjs [--if-changed] [from] [to]
//
// --if-changed leaves the seed alone unless alerts or notices differ, so a pipeline run that only
// moved bookkeeping (run times, seen URLs) makes no commit.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const ifChanged = args.includes('--if-changed')
const [fromArg, toArg] = args.filter((a) => !a.startsWith('--'))
const from = path.resolve(fromArg ?? path.join(root, process.env.NAZAR_DATA_DIR ?? 'data', 'nazar.sqlite'))
const to = path.resolve(toArg ?? path.join(root, 'seed/nazar.sqlite'))

/** What the read API serves: every alert and notice, in a stable order. */
function contentHash(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  const h = createHash('sha256')
  for (const t of ['alerts', 'notices']) for (const r of db.prepare(`SELECT * FROM ${t} ORDER BY 1`).iterate()) h.update(JSON.stringify(r))
  db.close()
  return h.digest('hex')
}

if (!existsSync(from)) {
  console.error(`no ledger at ${from}`)
  process.exit(1)
}
if (ifChanged && existsSync(to) && contentHash(from) === contentHash(to)) {
  console.log('seed: alerts and notices unchanged, left as is')
  process.exit(0)
}
mkdirSync(path.dirname(to), { recursive: true })
const tmp = `${to}.tmp`
rmSync(tmp, { force: true })
const db = new DatabaseSync(from)
db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`)
const n = db.prepare('SELECT COUNT(*) n FROM alerts').get().n
db.close()
// A rollback-journal file, so a reader never needs -wal/-shm siblings.
const out = new DatabaseSync(tmp)
out.exec('PRAGMA journal_mode = DELETE')
out.close()
renameSync(tmp, to)
console.log(`seed: ${n} alerts → ${path.relative(process.cwd(), to)}`)
