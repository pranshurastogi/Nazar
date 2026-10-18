// Saves Nazar's alert snapshot into public/data/snapshot.json before each build, so the site
// itself always carries a real copy of every published alert. The app reads it when the Nazar
// API is unreachable and Arkiv is rate limiting the browser, instead of falling back to demo data.
//
// The API's /v1/snapshot is built from its ledger, which mirrors what Nazar published on Arkiv.
// If the fetch fails (no network, API down, a local test build), the copy already in the repo is
// kept and the build carries on: this script never fails a build.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'snapshot.json')
const PROD = 'https://nazar-api-production.up.railway.app'

const origin = (() => {
  for (const v of [process.env.NAZAR_API_ORIGIN, process.env.NEXT_PUBLIC_NAZAR_API_URL]) {
    const s = v?.trim()
    if (s && /^https?:\/\//.test(s)) return s.replace(/\/+$/, '')
  }
  return PROD
})()

const valid = (f) => f && f.v === 1 && typeof f.version === 'string' && typeof f.generatedAt === 'string' && f.count > 0 && f.alerts && typeof f.alerts === 'object' && Array.isArray(f.notices)

async function current() {
  try {
    const f = JSON.parse(await readFile(OUT, 'utf8'))
    return valid(f) ? f : null
  } catch {
    return null
  }
}

async function main() {
  const have = await current()
  try {
    const res = await fetch(`${origin}/v1/snapshot`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const file = await res.json()
    if (!valid(file)) throw new Error('not a v1 snapshot with alerts')
    // `version` hashes the content: an unchanged alert set leaves the file (and git) untouched.
    if (have && have.version === file.version) {
      console.log(`[snapshot] unchanged (${file.count} alerts, version ${file.version})`)
      return
    }
    if (have && Date.parse(have.generatedAt) > Date.parse(file.generatedAt)) {
      console.log(`[snapshot] kept the newer copy in the repo (${have.generatedAt}); ${origin} served ${file.generatedAt}`)
      return
    }
    await mkdir(dirname(OUT), { recursive: true })
    await writeFile(OUT, JSON.stringify(file))
    console.log(`[snapshot] saved ${file.count} alerts from ${origin} (built ${file.generatedAt})`)
  } catch (err) {
    console.warn(`[snapshot] could not fetch from ${origin}: ${err instanceof Error ? err.message : err}. ${have ? `Keeping the repo copy (${have.count} alerts, ${have.generatedAt}).` : 'No saved copy; the app falls back to demo data when every live source fails.'}`)
  }
}

await main()
