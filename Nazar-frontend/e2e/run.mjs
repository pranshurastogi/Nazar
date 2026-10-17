// Starts the built app and headless Chrome, runs e2e.mjs in each requested mode, then cleans up.
// Usage:
//   fallback + mock (what CI runs):
//     NEXT_PUBLIC_NAZAR_API_URL=http://localhost:8787 NEXT_PUBLIC_NAZAR_PUBLISHER=0x000000000000000000000000000000000000dEaD pnpm build && pnpm e2e
//     Production builds skip the API unless NEXT_PUBLIC_NAZAR_API_URL is set, so it must be set explicitly here.
//     The browser's requests to it are refused (fallback) or answered from fixtures (mock) over CDP, and the
//     publisher has no Arkiv entities, so answers are deterministic even if a local API is running.
//   live: NEXT_PUBLIC_NAZAR_API_URL=http://localhost:8787 pnpm build && node e2e/run.mjs live  (backend on :8787)
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ['fallback', 'mock']
const PORT = process.env.E2E_PORT || '3124'
const CDP = process.env.CDP_PORT || '9334'
const OUT = process.env.E2E_OUT || path.join(root, 'e2e', 'screenshots')

const chromePath =
  process.env.CHROME_PATH ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
if (!chromePath) throw new Error('Chrome not found; set CHROME_PATH')

const waitFor = async (url, ms = 30_000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`timed out waiting for ${url}`)
}

const profile = mkdtempSync(path.join(tmpdir(), 'nazar-e2e-'))
const server = spawn('pnpm', ['exec', 'next', 'start', '--port', PORT], { cwd: root, stdio: 'ignore' })
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--no-sandbox', 'about:blank'], { stdio: 'ignore' })

let failed = false
try {
  await Promise.all([waitFor(`http://localhost:${PORT}/`), waitFor(`http://127.0.0.1:${CDP}/json/version`)])
  for (const mode of modes) {
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(here, 'e2e.mjs'), path.join(OUT, mode), mode], {
        stdio: 'inherit',
        env: { ...process.env, E2E_URL: `http://localhost:${PORT}/`, CDP_PORT: CDP },
      })
      p.on('exit', resolve)
    })
    if (code !== 0) failed = true
  }
} finally {
  server.kill()
  chrome.kill()
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500)
}
process.exitCode = failed ? 1 : 0
