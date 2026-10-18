'use client'

import { Progress } from '@base-ui/react/progress'

import type { ResultState } from '@/lib/source/types'
import { STATE_TEXT, type Counts, type SweepProgress } from '@/lib/sweep'
import { cn } from '@/lib/utils'
import { plural, STATE_TONE } from './shared'

export type Filter = 'all' | ResultState

const ORDER: ResultState[] = ['flagged', 'retracted', 'unreadable', 'no_alert']

/** Four chips, one per honest answer, that also filter the list. "No alert found" is slate, never green. */
export function SummaryChips({ counts, filter, onFilter }: { counts: Counts; filter: Filter; onFilter: (f: Filter) => void }) {
  const note: Partial<Record<ResultState, string>> = {
    flagged: 'Named in a regulator alert',
    retracted: 'Alert withdrawn by the regulator',
    unreadable: counts.lookalike ? `Includes ${plural(counts.lookalike, 'look-alike')} · “did you mean”` : 'Look-alikes and unreadable lines',
    no_alert: 'Not a safety certificate',
  }
  return (
    <div role="group" aria-label="Filter by result" className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-sweep-summary>
      {ORDER.map((s) => {
        const t = STATE_TONE[s]
        const active = filter === s
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            onClick={() => onFilter(active ? 'all' : s)}
            className={cn(
              'group flex min-h-[5.25rem] flex-col items-start justify-between rounded-2xl border p-3.5 text-left transition-[box-shadow,transform] hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none sm:p-4',
              t.chip,
              active && 'ring-2 ring-current/60',
              !counts[s] && 'opacity-70',
            )}
            data-sweep-chip={s}
            data-count={counts[s]}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[13px] font-bold">
                <t.Icon className="size-3.5" aria-hidden="true" /> {STATE_TEXT[s].replace("'", '’')}
              </span>
              <span className="text-2xl leading-none font-semibold tracking-tight tabular-nums">{counts[s].toLocaleString('en-IN')}</span>
            </span>
            <span className="mt-2 text-[11.5px] leading-4 font-medium opacity-85">{note[s]}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Progress of the live confirmation (or, without a snapshot, of the row-by-row check). */
export function SweepProgressBar({ p }: { p: SweepProgress }) {
  if (p.phase === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" data-sweep-progress="loading">
        <span className="size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden="true" /> Loading Nazar&rsquo;s copy of every published alert…
      </p>
    )
  }
  if (p.phase !== 'confirming' && p.phase !== 'checking') return null
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
  const what =
    p.phase === 'confirming'
      ? `Confirming ${plural(p.total, 'flagged or look-alike batch', 'flagged and look-alike batches')} with the live record`
      : `Checking with the live API, ${p.total === 1 ? 'one batch' : 'three at a time'}`
  return (
    <div className="rounded-2xl border bg-card p-4" data-sweep-progress={p.phase}>
      <Progress.Root value={pct} aria-label={what} className="flex flex-col gap-2">
        <div className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">{what}</span>
          <span className="text-muted-foreground tabular-nums">
            {p.waitingMs ? `The API asked us to slow down · waiting ${Math.round(p.waitingMs / 1000)} s · ` : ''}
            {p.done} of {p.total}
          </span>
        </div>
        <Progress.Track className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <Progress.Indicator className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" />
        </Progress.Track>
      </Progress.Root>
      {p.phase === 'checking' && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Nazar&rsquo;s on-device copy of the alerts is not available, so each batch is checked with the API. Any it can&rsquo;t reach is marked Can&rsquo;t tell.</p>
      )}
    </div>
  )
}
