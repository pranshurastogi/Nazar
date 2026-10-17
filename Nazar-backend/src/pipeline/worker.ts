import { Cron } from 'croner'

import { Heartbeat } from '../arkiv/heartbeat.ts'
import { Publisher } from '../arkiv/publisher.ts'
import { env } from '../config/env.ts'
import { errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import type { SourceAdapter } from '../sources/types.ts'
import type { Ledger } from '../storage/ledger.ts'
import { RunLockedError, runPipeline, type RunDeps } from './run.ts'

const log = child('worker')

/**
 * Long-running scheduler. National CDSCO feeds and the state feeds run on separate crons
 * (NAZAR_CRON_CDSCO, NAZAR_CRON_STATES) so a slow state site never delays the national list;
 * the heartbeat renews on NAZAR_CRON_HEARTBEAT. Overlapping ticks are skipped, and
 * SIGINT/SIGTERM aborts the current run cleanly before exit.
 */

export const isNationalSource = (id: string) => id.startsWith('cdsco')

export interface WorkerHandle {
  stop(): Promise<void>
  /** Renew the heartbeat now (also what the cron calls); concurrent calls share one beat. */
  beat(): Promise<void>
  jobs: { name: string; pattern: string; next: string | null }[]
}

export async function startWorker(o: {
  ledger: Ledger
  deps?: Partial<RunDeps>
  publish?: boolean
  handleSignals?: boolean
  /** Injected in tests; defaults to the real heartbeat (live when NAZAR_PUBLISH_MODE=live). */
  heartbeat?: Pick<Heartbeat, 'beat'>
  /** Run every source once at start-up (fresh deploys with an empty ledger). Defaults to NAZAR_RUN_ON_START. */
  runOnStart?: boolean
}): Promise<WorkerHandle> {
  const e = env()
  const { enabledSources } = await import('../sources/registry.ts')
  const all: SourceAdapter[] = enabledSources()
  const national = all.filter((s) => isNationalSource(s.id)).map((s) => s.id)
  const states = all.filter((s) => !isNationalSource(s.id)).map((s) => s.id)
  const publish = o.publish ?? e.NAZAR_PUBLISH_MODE === 'live'
  const publisher = new Publisher({ ledger: o.ledger })
  const heartbeat = o.heartbeat ?? new Heartbeat({ ledger: o.ledger })
  const controller = new AbortController()
  let current: Promise<unknown> | null = null

  // Renews the heartbeat entity (patch + extend; created if gone). A failure only logs: the next tick retries,
  // and if the pipeline stays down the entity expires on its own, which is exactly the signal we want.
  let beating: Promise<void> | null = null
  const beat = () =>
    (beating ??= (async () => {
      try {
        const r = await heartbeat.beat()
        log.info({ action: r.action, key: r.entityKey, tx: r.txHash }, 'heartbeat')
      } catch (err) {
        log.warn({ err: errorMessage(err) }, 'heartbeat failed')
      } finally {
        beating = null
      }
    })())

  const runGroup = async (name: string, ids: string[]) => {
    if (!ids.length || controller.signal.aborted) return
    const p = runPipeline(
      { sourceIds: ids, publish, signal: controller.signal, job: `cron:${name}` },
      { ledger: o.ledger, publisher, ...o.deps },
    )
    current = p
    try {
      const r = await p
      log.info({ job: name, totals: r.totals }, 'scheduled run finished')
    } catch (err) {
      if (err instanceof RunLockedError) log.warn({ job: name }, 'skipped: another run holds the lock')
      else log.error({ job: name, err: errorMessage(err) }, 'scheduled run failed')
    } finally {
      current = null
    }
  }

  const opts = { protect: true, catch: (err: unknown) => log.error({ err: errorMessage(err) }, 'cron job threw') }
  const crons = [
    { name: 'cdsco', pattern: e.NAZAR_CRON_CDSCO, cron: new Cron(e.NAZAR_CRON_CDSCO, opts, () => runGroup('cdsco', national)) },
    { name: 'states', pattern: e.NAZAR_CRON_STATES, cron: new Cron(e.NAZAR_CRON_STATES, opts, () => runGroup('states', states)) },
    {
      name: 'heartbeat',
      pattern: e.NAZAR_CRON_HEARTBEAT,
      cron: new Cron(e.NAZAR_CRON_HEARTBEAT, opts, () => beat()),
    },
  ]
  log.info({ national, states, publish, jobs: crons.map((c) => ({ name: c.name, next: c.cron.nextRun()?.toISOString() ?? null })) }, 'worker started')
  // A beat right away, so a fresh deploy shows as alive without waiting five minutes.
  const first = beat()
  if (o.runOnStart ?? ['1', 'true', 'yes'].includes((process.env.NAZAR_RUN_ON_START ?? '').toLowerCase())) {
    void (async () => {
      await runGroup('start:cdsco', national)
      await runGroup('start:states', states)
    })()
  }

  let stopping: Promise<void> | null = null
  const stop = () =>
    (stopping ??= (async () => {
      log.info('stopping worker')
      for (const c of crons) c.cron.stop()
      controller.abort()
      await first
      if (current) await Promise.race([current.catch(() => undefined), new Promise((r) => setTimeout(r, 30_000))])
      log.info('worker stopped')
    })())

  if (o.handleSignals !== false) {
    const onSignal = (sig: string) => {
      log.info({ sig }, 'signal received')
      void stop().then(() => process.exit(0))
    }
    process.once('SIGINT', () => onSignal('SIGINT'))
    process.once('SIGTERM', () => onSignal('SIGTERM'))
  }

  return {
    stop,
    beat,
    jobs: crons.map((c) => ({ name: c.name, pattern: c.pattern, next: c.cron.nextRun()?.toISOString() ?? null })),
  }
}
