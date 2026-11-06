#!/usr/bin/env node
// Builds the read API for Vercel with the Build Output API (v3):
//
//   .vercel/output/config.json                    every path → the one function
//   .vercel/output/functions/index.func/index.mjs  src/api/vercel.ts, bundled with its dependencies
//   .vercel/output/functions/index.func/nazar.sqlite  the committed ledger (seed/nazar.sqlite)
//
// Vercel runs this as the project's build command (root directory Nazar-backend) and deploys the
// output as is. One function, pinned to Mumbai (bom1): closest to the users, and Indian regulator
// sites refuse many foreign IPs.
//
//   node scripts/build-vercel.mjs   then   node scripts/build-vercel.mjs --smoke   to try it locally

import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, '.vercel/output')
const fn = path.join(out, 'functions/index.func')
const seed = path.join(root, 'seed/nazar.sqlite')

if (!existsSync(seed)) {
  console.error(`missing ${path.relative(root, seed)}: run \`pnpm seed:export\` and commit it`)
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(fn, { recursive: true })

await build({
  entryPoints: [path.join(root, 'src/api/vercel.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'warning',
  // Some dependencies are CommonJS and call require()/__dirname; give the ESM bundle both.
  banner: {
    js: [
      "import { createRequire as __nazarCreateRequire } from 'node:module';",
      "import { fileURLToPath as __nazarFileURLToPath } from 'node:url';",
      "import { dirname as __nazarDirname } from 'node:path';",
      'const require = __nazarCreateRequire(import.meta.url);',
      'const __filename = __nazarFileURLToPath(import.meta.url);',
      'const __dirname = __nazarDirname(__filename);',
    ].join('\n'),
  },
  // Only the pipeline (never imported by the API) needs these; keep them out if anything reaches them.
  external: ['@napi-rs/canvas', 'tesseract.js', 'pdfjs-dist', 'pino-pretty'],
})

copyFileSync(seed, path.join(fn, 'nazar.sqlite'))

writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs24.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      regions: ['bom1'],
      maxDuration: 60,
      memory: 1024,
    },
    null,
    2,
  ),
)

writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify({ version: 3, routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/index' }] }, null, 2),
)

const mb = (f) => (statSync(f).size / 1e6).toFixed(1)
console.log(`built .vercel/output: index.mjs ${mb(path.join(fn, 'index.mjs'))} MB, ledger ${mb(seed)} MB, region bom1`)

if (process.argv.includes('--smoke')) {
  // Load the bundle the way Vercel does and answer one request through it.
  const { createServer } = await import('node:http')
  process.env.NAZAR_DATA_DIR = path.join(root, '.vercel/smoke-data')
  rmSync(process.env.NAZAR_DATA_DIR, { recursive: true, force: true })
  const handler = (await import(path.join(fn, 'index.mjs'))).default
  const server = createServer(handler).listen(0)
  const port = server.address().port
  let ok = true
  for (const p of ['/health', '/v1/check?batch=SR-13', '/v1/alerts?limit=1', '/v1/snapshot']) {
    const r = await fetch(`http://127.0.0.1:${port}${p}`)
    const body = await r.text()
    console.log(`${r.status} ${p}  ${body.slice(0, 140).replace(/\s+/g, ' ')}`)
    ok &&= r.ok
  }
  server.close()
  process.exit(ok ? 0 : 1)
}
