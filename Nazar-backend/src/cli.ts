import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { ExpirationTime } from '@arkiv-network/sdk'
import { Command } from 'commander'
import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { explorerAddress, explorerEntity, explorerTx, publicClient, publisherAddress, walletClient } from './arkiv/client.ts'
import { FAUCET_URL, fundingInstructions, glm } from './arkiv/funding.ts'
import { Heartbeat } from './arkiv/heartbeat.ts'
import { keepAlive } from './arkiv/keepalive.ts'
import { FALLBACK_GAS_PRICE, GAS_PER_CREATE, MAX_CREATES_PER_TX, Publisher, defaultGasPrice, rpcSimulate, rpcSimulateBatch } from './arkiv/publisher.ts'
import { buildHeartbeat } from './arkiv/schema.ts'
import { validateLedger, type LedgerCheckReport } from './arkiv/validate.ts'
import { env } from './config/env.ts'
import { parseYm } from './domain/dates.ts'
import type { ExtractionResult, RawDoc } from './domain/types.ts'
import { errorMessage } from './lib/errors.ts'
import { sha256 } from './lib/hash.ts'
import { pipelineStatus } from './pipeline/status.ts'
import { runPipeline } from './pipeline/run.ts'
import { ledger as sharedLedger } from './storage/ledger.ts'

/**
 * Operator CLI. Every pipeline stage can be run on its own so a judge (or a curator) can
 * reproduce exactly what the worker does: discover → harvest → extract → resolve → publish.
 */

const print = (v: unknown) => console.log(typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2))
const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)

async function registry() {
  return import('./sources/registry.ts')
}

/** Builds every entity the ledger would publish, validates it, and estimates gas on a sample of real chunks. */
async function checkLedger(o: { sources?: string[]; limitNotices?: number; sample?: number; offline?: boolean }) {
  const from = publisherAddress()
  return validateLedger(sharedLedger(), {
    sources: o.sources,
    limitNotices: o.limitNotices,
    chunkSize: MAX_CREATES_PER_TX,
    from,
    chainId: env().ARKIV_CHAIN_ID,
    simulate: o.offline ? null : rpcSimulate,
    sampleChunks: o.sample ?? 3,
    fallbackGasPerCreate: GAS_PER_CREATE,
    fallbackGasPrice: await defaultGasPrice().catch(() => FALLBACK_GAS_PRICE),
  })
}

function printCheck(r: LedgerCheckReport, verbose = false) {
  const n = (x: number) => x.toLocaleString('en-US')
  print(`Arkiv publish check (${r.ok ? 'PASS' : 'FAIL'})`)
  print(`  notices        ${n(r.notices.total)} (${n(r.notices.onChain)} on chain, ${n(r.notices.pending)} with pending alerts)`)
  print(`  entities       ${n(r.entities.total)} built: ${n(r.entities.notice)} notice, ${n(r.entities.alert)} alert`)
  print(`  skipped        ${n(r.skipped.curator)} curator-only, ${n(r.skipped.retracted)} retracted, ${n(r.skipped.alreadyOnChain)} already on chain`)
  for (const [src, v] of Object.entries(r.bySource)) print(`    ${src.padEnd(14)} ${String(v.notices).padStart(4)} notices  ${String(v.alerts).padStart(6)} alerts  ${String(v.pendingAlerts).padStart(6)} pending`)
  print(`  to publish     ${n(r.pending.creates)} creates in ${n(r.pending.chunks)} atomic batches (sizes ${Object.entries(r.chunks.sizes).map(([k, v]) => `${k}×${v}`).join(', ') || '-'})`)
  print(`  limits         max ${r.limits.maxAttributes}/32 attributes, longest str ${r.limits.maxStr ? `${r.limits.maxStr.bytes}/128 B (${r.limits.maxStr.name})` : '-'}, largest payload ${n(r.limits.maxPayloadBytes)} B, largest batch ~${n(r.chunks.maxApproxBytes)} B`)
  if (r.limits.alertLifetimeDays) print(`  alert lifetime ${r.limits.alertLifetimeDays.min}–${r.limits.alertLifetimeDays.max} days`)
  print(`  notice links   ${n(r.links.alertsChecked)} checked, ${n(r.links.broken)} broken`)
  for (const s of r.gas.samples) print(`  estimate       ${s.notice.slice(0, 12)}#${s.index} ${s.creates} creates: ${s.ok ? `${n(Number(s.gas))} gas` : `failed (${s.error})`}${s.calldataBytes ? `, ${n(s.calldataBytes)} B calldata` : ''}`)
  print(`  gas            ${r.gas.method}: ~${n(Number(r.gas.gasPerCreate))} gas per create × ${n(r.pending.creates)} = ${n(Number(r.gas.totalGas))} gas`)
  print(`  cost           ~${glm(BigInt(r.gas.totalGas) * BigInt(r.gas.gasPrice))} GLM at ${Number(r.gas.gasPrice) / 1e9} gwei (have ${r.gas.recommendedGlm.slice(0, 10)} GLM to be safe)`)
  if (r.warnings.count) {
    print(`  warnings       ${n(r.warnings.count)}`)
    for (const [m, c] of Object.entries(r.warnings.byMessage).sort((a, b) => b[1] - a[1]).slice(0, verbose ? 50 : 5)) print(`    ${String(c).padStart(5)}  ${m}`)
  }
  if (r.failures.length) {
    print(`  failures       ${n(r.failures.length)}`)
    for (const f of r.failures.slice(0, verbose ? 500 : 20)) print(`    ${f.kind} ${f.ref.slice(0, 24)} (notice ${f.notice.slice(0, 12)}): ${f.problems.join('; ')}`)
  }
}

const program = new Command()
  .name('nazar')
  .description('Nazar pipeline: Indian drug-regulator batch alerts → Arkiv')
  .version('0.1.0')

program
  .command('sources')
  .description('list every source adapter and whether it runs by default')
  .action(async () => {
    const { allSources, sourceStatus } = await registry()
    for (const s of allSources()) {
      const st = sourceStatus(s)
      print(`${st.enabled ? 'on ' : 'off'}  ${s.id.padEnd(14)} ${s.jurisdiction.padEnd(6)} ${s.schedule.padEnd(14)} ${s.authority}${st.disabledReason ? `\n      (${st.operatorNote ?? st.disabledReason})` : ''}`)
    }
  })

program
  .command('discover')
  .description('list documents each source currently offers (no downloads beyond listings)')
  .option('--source <ids>', 'comma list of source ids')
  .option('--since <yyyymm>', 'only documents from this month on')
  .option('--limit <n>', 'documents per source', '10')
  .action(async (o: { source?: string; since?: string; limit: string }) => {
    const { enabledSources } = await registry()
    const { http } = await import('./lib/http.ts')
    for (const s of enabledSources(list(o.source))) {
      try {
        const docs = await s.discover({ http: http(), sinceYm: o.since ? Number(o.since) : undefined, limit: Number(o.limit) })
        print(`# ${s.id}: ${docs.length} document(s)`)
        for (const d of docs) print(`  ${d.noticeYm ?? '      '}  ${d.kind.padEnd(4)}  ${d.title.slice(0, 90)}\n          ${d.url}`)
      } catch (err) {
        print(`# ${s.id}: discover failed: ${errorMessage(err)}`)
      }
    }
  })

program
  .command('harvest')
  .description('discover and download documents into the content-addressed raw store (no extraction)')
  .option('--source <ids>', 'comma list of source ids')
  .option('--limit <n>', 'documents per source', '6')
  .action(async (o: { source?: string; limit: string }) => {
    const [{ enabledSources }, { http }, { harvest }, { RawStore }] = await Promise.all([
      registry(),
      import('./lib/http.ts'),
      import('./pipeline/harvest.ts'),
      import('./storage/raw-store.ts'),
    ])
    const ledger = sharedLedger()
    const store = new RawStore()
    for (const s of enabledSources(list(o.source))) {
      const docs = await s.discover({ http: http(), limit: Number(o.limit) }).catch((err) => (print(`${s.id}: ${errorMessage(err)}`), []))
      for (const d of docs.slice(0, Number(o.limit))) {
        try {
          const h = await harvest(d, { http: http(), store, ledger })
          print(h ? `${h.isNew ? 'new ' : 'same'} ${h.raw.sha256.slice(0, 12)} ${d.title.slice(0, 80)}` : `skip ${d.url}`)
        } catch (err) {
          print(`fail ${d.url}: ${errorMessage(err)}`)
        }
      }
    }
  })

program
  .command('extract <shaOrFile>')
  .description('extract rows from a harvested document (by sha) or a local PDF/HTML file')
  .option('--ocr', 'allow OCR for pages without text')
  .option('--llm', 'allow the grounded LLM fallback')
  .option('--rows', 'print every row')
  .action(async (target: string, o: { ocr?: boolean; llm?: boolean; rows?: boolean }) => {
    const ledger = sharedLedger()
    let doc: RawDoc
    let bytes: Uint8Array
    const known = /^[0-9a-f]{64}$/.test(target) ? ledger.getDocument(target) : undefined
    if (known) {
      doc = known
      bytes = new Uint8Array(await readFile(known.path))
    } else {
      bytes = new Uint8Array(await readFile(target))
      const ext = path.extname(target).toLowerCase()
      const url = `file://${path.resolve(target)}`
      doc = {
        sourceId: 'local',
        url,
        finalUrl: url,
        title: path.basename(target),
        authority: 'Local file',
        jurisdiction: 'IN',
        publishedAt: null,
        noticeYm: null,
        kind: ext === '.pdf' ? 'pdf' : ext === '.png' || ext === '.jpg' ? 'image' : 'html',
        hints: {},
        sha256: sha256(bytes),
        path: path.resolve(target),
        contentType: ext === '.pdf' ? 'application/pdf' : 'text/html',
        size: bytes.byteLength,
        fetchedAt: new Date().toISOString(),
      }
    }
    const spec = './extract/index.ts'
    const { extractDocument } = (await import(spec)) as {
      extractDocument: (d: RawDoc, b: Uint8Array, opts?: { ocr?: boolean; llm?: boolean }) => Promise<ExtractionResult>
    }
    const res = await extractDocument(doc, bytes, { ocr: o.ocr, llm: o.llm })
    print({ parser: res.parser, method: res.method, pages: res.pages, rows: res.rows.length, rejected: res.rejected.length, warnings: res.warnings })
    if (o.rows) print(res.rows.map((r) => ({ rowNo: r.rowNo, batch: r.batch, product: r.product, conf: r.confidence, issues: r.issues })))
  })

program
  .command('run')
  .description('run the full pipeline once: discover → harvest → extract → resolve (→ publish)')
  .option('--source <ids>', 'comma list of source ids')
  .option('--since <yyyymm>', 'only documents from this month on')
  .option('--limit <n>', 'documents per source')
  .option('--publish', 'publish resolved notices (dry-run unless NAZAR_PUBLISH_MODE=live)')
  .option('--no-ocr', 'disable OCR')
  .option('--no-llm', 'disable the LLM fallback')
  .action(async (o: { source?: string; since?: string; limit?: string; publish?: boolean; ocr: boolean; llm: boolean }) => {
    const ledger = sharedLedger()
    const controller = new AbortController()
    process.once('SIGINT', () => (print('aborting after the current document…'), controller.abort()))
    const sinceYm = o.since ? (parseYm(o.since) ?? Number(o.since)) : undefined
    const report = await runPipeline(
      { sourceIds: list(o.source), sinceYm, limit: o.limit ? Number(o.limit) : undefined, publish: o.publish, ocr: o.ocr, llm: o.llm, signal: controller.signal, job: 'cli:run' },
      { ledger, publisher: o.publish ? new Publisher({ ledger }) : undefined },
    )
    print({ ok: report.ok, aborted: report.aborted, totals: report.totals })
    for (const s of report.sources) print(`${s.sourceId.padEnd(14)} docs ${s.processed}/${s.discovered}  rows ${s.rows}  alerts ${s.alerts}  curator ${s.curator}  failed ${s.failed}${s.errors[0] ? `  first error: ${s.errors[0].error.slice(0, 120)}` : ''}`)
  })

program
  .command('publish')
  .description('publish resolved notices to Arkiv (dry-run by default)')
  .option('--notice <sha>', 'one notice; default: every notice with pending alerts')
  .option('--source <ids>', 'only notices from these sources, e.g. who-mpa,curated')
  .option('--limit-notices <n>', 'max notices (oldest first)')
  .option('--limit <n>', 'alias of --limit-notices', '20')
  .option('--check', 'validate every entity the ledger would publish and estimate gas; sends nothing')
  .option('--sample <n>', 'chunks to estimate with eth_estimateGas', '3')
  .option('--offline', 'with --check: skip gas estimation RPC calls')
  .option('--live', 'actually send transactions (needs a funded wallet)')
  .option('--preflight', 'with --live: run every live pre-check (validation, gas estimate, balance, chain reconcile, key prediction) and stop before sending')
  .option('--verbose', 'print every entity that would be sent')
  .action(async (o: { notice?: string; source?: string; limitNotices?: string; limit: string; check?: boolean; sample: string; offline?: boolean; live?: boolean; preflight?: boolean; verbose?: boolean }) => {
    const sources = list(o.source)
    const limitNotices = Number(o.limitNotices ?? o.limit)
    if (o.check) {
      const r = await checkLedger({ sources, limitNotices: o.limitNotices ? limitNotices : undefined, sample: Number(o.sample), offline: o.offline })
      printCheck(r, o.verbose)
      if (!r.ok) process.exitCode = 1
      return
    }
    const ledger = sharedLedger()
    if (o.live) {
      // Validate and price exactly what this run would send, and stop before anything goes out if it is short or broken.
      const address = publisherAddress()
      if (!address) {
        print('No publisher key configured. Run `pnpm cli wallet:new` first.')
        process.exitCode = 2
        return
      }
      const r = await checkLedger({ sources, limitNotices: o.notice ? undefined : limitNotices, sample: 1 })
      if (!r.ok) {
        printCheck(r, o.verbose)
        print('\nRefusing to publish live: fix the failures above (alerts are readonly once published).')
        process.exitCode = 1
        return
      }
      const balance = await publicClient().getBalance({ address })
      const needed = BigInt(r.gas.totalGas) * BigInt(r.gas.gasPrice)
      const safe = (needed * 125n) / 100n
      if (balance < safe) {
        const flags = [o.source ? `--source ${o.source}` : '', `--limit-notices ${limitNotices}`].filter(Boolean).join(' ')
        print(fundingInstructions({ address, balanceWei: balance, neededWei: safe, what: `${r.pending.creates} creates in ${r.pending.chunks} batches (estimate + 25%)`, rerun: `pnpm cli publish --live ${flags}` }))
        process.exitCode = 2
        return
      }
      print(`balance ${glm(balance)} GLM covers ~${glm(safe)} GLM for ${r.pending.creates} creates in ${r.pending.chunks} batches (${r.gas.method})`)
      if (o.preflight) print('preflight: all live checks passed; running the publisher in dry-run (reads Arkiv, predicts keys, simulates, sends nothing)')
      else print('publishing…')
    }
    const live = !!o.live && !o.preflight
    const pub = new Publisher({ ledger, mode: live ? 'live' : 'dry-run' })
    const reports = o.notice ? [await pub.publishNotice(o.notice, { live })] : await pub.publishPending({ live, limit: limitNotices, sources })
    if (!reports.length) print('nothing pending')
    for (const r of reports) {
      print(
        `${r.mode}  notice ${r.sha.slice(0, 12)}  key ${r.noticeKey ?? '-'}  candidates ${r.candidates}  published ${r.published}  reconciled ${r.reconciled}  chunks ${r.chunks.length}  invalid ${r.invalid.length}`,
      )
      if (r.simulation) print(`  simulation: ${r.simulation.ok ? `gas ${r.simulation.gas} (~${r.simulation.costGlm} GLM)` : `failed: ${r.simulation.error}`}`)
      for (const w of r.warnings) print(`  warning: ${w}`)
      for (const x of r.explorer) print(`  ${x}`)
      if (r.chunks.some((c) => c.status === 'failed')) process.exitCode = 1
      if (o.verbose) print(r.chunks)
    }
  })

program
  .command('reresolve')
  .description('re-run resolve over every stored document from the ledger\'s extracted rows (idempotent; no network, nothing published)')
  .option('--dry-run', 'report what would change and roll back')
  .option('--db <file>', 'ledger file (default: the configured data dir)')
  .action(async (o: { dryRun?: boolean; db?: string }) => {
    // Opened directly, not through ledger(), which would apply the same migration on open and defeat --dry-run.
    const [{ Ledger }, { reresolveLedger }] = await Promise.all([import('./storage/ledger.ts'), import('./resolve/reresolve.ts')])
    const l = new Ledger(o.db)
    try {
      print(reresolveLedger(l, { dryRun: o.dryRun }))
    } finally {
      l.close()
    }
  })

program
  .command('arkiv:validate')
  .description('same as `publish --check`: validate every notice/alert entity in the ledger and estimate gas/GLM')
  .option('--source <ids>', 'only notices from these sources')
  .option('--limit-notices <n>', 'max notices')
  .option('--sample <n>', 'chunks to estimate with eth_estimateGas', '3')
  .option('--offline', 'skip gas estimation RPC calls')
  .option('--json', 'print the full report as JSON')
  .option('--verbose', 'list every failure and warning')
  .action(async (o: { source?: string; limitNotices?: string; sample: string; offline?: boolean; json?: boolean; verbose?: boolean }) => {
    const r = await checkLedger({ sources: list(o.source), limitNotices: o.limitNotices ? Number(o.limitNotices) : undefined, sample: Number(o.sample), offline: o.offline })
    if (o.json) print(r)
    else printCheck(r, o.verbose)
    if (!r.ok) process.exitCode = 1
  })

program
  .command('keep-alive <entityKey>')
  .description('extend a Nazar alert while the batch is still on shelves (permissionless: any funded wallet can do this)')
  .requiredOption('--days <n>', 'new lifetime, counted from now')
  .option('--live', 'actually send (dry-run reads the entity and estimates gas)')
  .action(async (entityKey: string, o: { days: string; live?: boolean }) => {
    const signer = publisherAddress()
    try {
      const r = await keepAlive(entityKey as Hex, Number(o.days), {
        public: publicClient(),
        mode: o.live ? 'live' : 'dry-run',
        signer,
        wallet: () => walletClient(),
        publisher: (env().NAZAR_ROOT_ADDRESS as Hex | undefined) ?? signer,
        simulate: (key, days, from) => rpcSimulateBatch({ extensions: [{ entityKey: key, expires: ExpirationTime.fromDays(days) }] }, from),
        gasPrice: defaultGasPrice,
      })
      print({ ...r, explorer: { entity: explorerEntity(r.entityKey), tx: r.txHash ? explorerTx(r.txHash) : null } })
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'FUNDS') {
        print(err.message)
        process.exitCode = 2
        return
      }
      throw err
    }
  })

program
  .command('retract <rid>')
  .description('publish a retraction for an alert (dry-run by default)')
  .requiredOption('--reason <reason>', 'appeal | correction | duplicate | superseded')
  .option('--note <text>', 'why', '')
  .option('--live', 'actually send')
  .action(async (rid: string, o: { reason: string; note: string; live?: boolean }) => {
    if (!['appeal', 'correction', 'duplicate', 'superseded'].includes(o.reason)) throw new Error('reason must be appeal, correction, duplicate or superseded')
    const pub = new Publisher({ ledger: sharedLedger(), mode: o.live ? 'live' : 'dry-run' })
    print(await pub.retract(rid, o.reason as 'appeal', o.note, { live: o.live }))
  })

program
  .command('check <batch>')
  .description('check a batch number exactly as the API does')
  .action(async (batch: string) => {
    const { buildProductionApp } = await import('./api/main.ts')
    const res = await buildProductionApp().request(`/v1/check?batch=${encodeURIComponent(batch)}`)
    print(await res.json())
  })

program
  .command('status')
  .description('ledger stats, recent runs, heartbeat and publisher balance')
  .action(async () => {
    const e = env()
    const address = publisherAddress()
    print(await pipelineStatus({ ledger: sharedLedger(), mode: e.NAZAR_PUBLISH_MODE, address, client: address ? publicClient() : null, runs: 5 }))
  })

program
  .command('wallet:new')
  .description('create a publisher wallet; the key goes into .env (only if none is set) and is never printed')
  .action(() => {
    const envFile = path.resolve('.env')
    const current = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
    const existing = /^NAZAR_PUBLISHER_PRIVATE_KEY=0x[0-9a-fA-F]{64}\s*$/m.exec(current)
    if (existing || env().NAZAR_PUBLISHER_PRIVATE_KEY) {
      print(`A publisher key is already configured; leaving it untouched. Address: ${publisherAddress()}`)
      return
    }
    const pk = generatePrivateKey()
    const address = privateKeyToAccount(pk).address
    if (/^NAZAR_PUBLISHER_PRIVATE_KEY=\s*$/m.test(current)) {
      writeFileSync(envFile, current.replace(/^NAZAR_PUBLISHER_PRIVATE_KEY=\s*$/m, `NAZAR_PUBLISHER_PRIVATE_KEY=${pk}`), { mode: 0o600 })
    } else {
      appendFileSync(envFile, `${current && !current.endsWith('\n') ? '\n' : ''}NAZAR_PUBLISHER_PRIVATE_KEY=${pk}\n`, { mode: 0o600 })
    }
    print(`New publisher address: ${address}\nKey written to .env (not shown). Fund it: ${FAUCET_URL}\nExplorer: ${explorerAddress(address)}`)
  })

program
  .command('wallet:balance')
  .description('publisher address, GLM balance, and what publishing the current ledger would cost')
  .option('--source <ids>', 'price only notices from these sources')
  .option('--limit-notices <n>', 'price only the first N notices')
  .action(async (o: { source?: string; limitNotices?: string }) => {
    const address = publisherAddress()
    if (!address) {
      print('No publisher key configured. Run `pnpm cli wallet:new`.')
      process.exitCode = 2
      return
    }
    const bal = await publicClient().getBalance({ address: address as Hex })
    const r = await checkLedger({ sources: list(o.source), limitNotices: o.limitNotices ? Number(o.limitNotices) : undefined, sample: 1 })
    const needed = (BigInt(r.gas.totalGas) * BigInt(r.gas.gasPrice) * 125n) / 100n
    print(`publisher  ${address}\nbalance    ${glm(bal)} GLM\nexplorer   ${explorerAddress(address)}`)
    print(`ledger     ${r.pending.creates} creates pending in ${r.pending.chunks} batches → ~${glm(needed)} GLM with a 25% margin (${r.gas.method})`)
    if (bal < needed || bal === 0n) {
      print('')
      print(fundingInstructions({ address, balanceWei: bal, neededWei: needed > 0n ? needed : 1n, what: `${r.pending.creates} pending creates (estimate + 25%)` }))
      process.exitCode = 2
    } else print('status     funded: enough for the pending ledger')
  })

program
  .command('heartbeat')
  .description('renew (or create) the pipeline heartbeat entity')
  .option('--live', 'actually send')
  .action(async (o: { live?: boolean }) => {
    const r = await new Heartbeat({ ledger: sharedLedger() }).beat({ live: o.live })
    // In dry-run, price the create a live beat would send (renewals are a patch + an extend on the same entity).
    const estimate = r.mode === 'dry-run' ? await rpcSimulate([buildHeartbeat(r.payload)], publisherAddress()).catch(() => null) : null
    print({ ...r, explorer: r.entityKey && r.mode === 'live' ? explorerEntity(r.entityKey) : null, ...(estimate ? { estimate } : {}) })
  })

program
  .command('serve')
  .description('start the read API')
  .action(async () => {
    const { startServer } = await import('./api/main.ts')
    startServer()
  })

program
  .command('worker')
  .description('run the scheduler (crons for CDSCO, states and heartbeat)')
  .action(async () => {
    const { startWorker } = await import('./pipeline/worker.ts')
    await startWorker({ ledger: sharedLedger() })
  })

const LONG_RUNNING = new Set(['serve', 'worker'])
program
  .parseAsync(process.argv)
  .then(() => {
    // One-shot commands exit promptly instead of waiting for idle HTTP keep-alive sockets.
    if (!LONG_RUNNING.has(process.argv[2] ?? '')) process.exit(process.exitCode ?? 0)
  })
  .catch((err) => {
    console.error(`error: ${errorMessage(err)}`)
    process.exit(1)
  })
