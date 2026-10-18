'use client'

import { Baby, CalendarCheck, Database, Fingerprint, RotateCcw, Tag } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { timeAgo } from '@/components/nazar/status-pill'
import { explorerAddress, PROJECT, PUBLISHER } from '@/lib/source'
import type { ArkivSummary, Counts, DirectoryFilters } from '@/lib/source/directory'
import { cn } from '@/lib/utils'
import { blk, CATEGORY_LABEL, CopyButton, ExplorerLink, nf, Panel, placeName, Skeleton, sourceLabel } from './shared'

// Header (what Arkiv is, who publishes, which block) and the live overview: counts by entity
// type and small breakdowns of the alerts. Every breakdown is a button that applies itself as
// a filter, so the overview doubles as the quickest way into the results.

export type SummaryState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: ArkivSummary; fetchedAt: number }
  | { kind: 'error'; message: string; throttled: boolean; noApi: boolean }

export function DirectoryHeader({ summary, block, onRefresh }: { summary: SummaryState; block: string | null; onRefresh: () => void }) {
  const latest = summary.kind === 'ok' ? summary.data.latestBlock : block
  const stale = summary.kind === 'ok' && summary.data.stale
  const live = summary.kind === 'ok' && !stale
  const label = summary.kind === 'loading' ? 'Reading Arkiv…' : live ? `Live · ${blk(latest)}` : stale ? 'Stale snapshot' : block ? 'Live · results only' : 'Counts unavailable'
  return (
    <header className="rounded-2xl border bg-card p-4 sm:p-6" data-arkiv-header>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <p className="text-[11px] font-bold tracking-[0.16em] text-primary uppercase">Arkiv directory</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Everything Nazar has published, on chain</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Arkiv is a public database chain: every Nazar alert, notice and heartbeat below is an entity anyone can query without asking Nazar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-live={live ? 'live' : stale ? 'stale' : summary.kind}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold',
              live ? 'border-primary/30 bg-primary/10 text-primary' : stale ? 'border-caution-border bg-caution-soft text-caution' : 'text-muted-foreground',
            )}
            title={summary.kind === 'ok' ? `Counted at block ${summary.data.generatedAtBlock}, ${new Date(summary.data.generatedAt).toLocaleString('en-IN')}` : undefined}
          >
            <span className={cn('size-2 rounded-full', live ? 'bg-primary motion-safe:animate-pulse' : stale ? 'bg-caution' : 'bg-muted-foreground/50')} aria-hidden="true" />
            {label}
          </span>
          <Button variant="outline" size="icon" className="size-9 rounded-full" onClick={onRefresh} aria-label="Refresh counts">
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </div>

      <dl className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.7fr)]">
        <div className="min-w-0 rounded-xl border bg-background/60 p-3">
          <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Fingerprint className="size-3.5" aria-hidden="true" /> Publisher wallet
          </dt>
          <dd className="mt-1.5 flex items-center gap-2">
            <span className="min-w-0 flex-1 font-mono text-[12px] font-medium break-all" data-publisher>{PUBLISHER}</span>
            <CopyButton value={PUBLISHER} what="Publisher wallet" />
            <ExplorerLink href={explorerAddress(PUBLISHER)} label="Open publisher wallet in the Arkiv explorer" />
          </dd>
        </div>
        <div className="min-w-0 rounded-xl border bg-background/60 p-3">
          <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Tag className="size-3.5" aria-hidden="true" /> Project tag
          </dt>
          <dd className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-[12px] font-medium break-all">{PROJECT}</code>
            <CopyButton value={PROJECT} what="Project tag" />
          </dd>
        </div>
        <div className="hidden min-w-0 rounded-xl border bg-background/60 p-3 sm:col-span-2 sm:block lg:col-span-1">
          <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Database className="size-3.5" aria-hidden="true" /> Latest block
          </dt>
          <dd className="mt-1.5 flex h-10 items-center font-mono text-sm font-semibold" data-latest-block>
            {blk(latest)}
          </dd>
        </div>
      </dl>
      {stale && summary.kind === 'ok' && (
        <p className="mt-3 text-xs text-caution">
          Showing counts from {timeAgo(Date.parse(summary.data.generatedAt))} (block {blk(summary.data.generatedAtBlock)}) while fresh ones are read.
          {summary.data.error ? ` Last attempt: ${summary.data.error}` : ''}
        </p>
      )}
      {summary.kind === 'error' && (
        <p className="mt-3 text-xs text-muted-foreground" data-summary-error>
          {summary.noApi
            ? 'Counts are computed by the Nazar API, which this build does not use. The results below still come straight from Arkiv.'
            : summary.throttled
              ? 'Arkiv is rate limiting the counts right now. The results below still work; try refreshing in a minute.'
              : `Counts are unavailable (${summary.message}). The results below can still be read straight from Arkiv.`}
        </p>
      )}
    </header>
  )
}

type Apply = (patch: Partial<DirectoryFilters>) => void

function sortCounts(c: Counts) {
  return Object.entries(c).sort((a, b) => b[1] - a[1])
}

function Bars({ title, counts, label, active, onPick, limit = 6, filterable = (k: string) => k !== 'unknown' }: {
  title: string
  counts: Counts
  label: (k: string) => string
  active: string
  onPick: (k: string) => void
  limit?: number
  filterable?: (k: string) => boolean
}) {
  const rows = sortCounts(counts)
  const shown = rows.slice(0, limit)
  const rest = rows.slice(limit).reduce((s, [, n]) => s + n, 0)
  const max = Math.max(1, ...rows.map(([, n]) => n))
  return (
    <div className="min-w-0" data-breakdown={title}>
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      <ul className="mt-2 space-y-1">
        {shown.map(([k, n]) => {
          const can = filterable(k)
          const on = active === k
          return (
            <li key={k}>
              <button
                type="button"
                disabled={!can}
                aria-pressed={on}
                onClick={() => onPick(on ? '' : k)}
                title={can ? `Show only ${label(k)}` : 'Not a queryable value'}
                className={cn(
                  'group grid min-h-9 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-1 text-left text-[13px] transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  can && 'hover:bg-muted/70',
                  on && 'bg-primary/10 ring-1 ring-primary/30',
                  !can && 'cursor-default',
                )}
              >
                <span className="truncate font-medium">{label(k)}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{nf(n)}</span>
                <span className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span className={cn('block h-full rounded-full', on ? 'bg-primary' : 'bg-primary/55 group-hover:bg-primary/75')} style={{ width: `${Math.max(2, (n / max) * 100)}%` }} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {rest > 0 && <p className="mt-1 px-2 text-xs text-muted-foreground">+ {nf(rest)} more in {rows.length - limit} others</p>}
    </div>
  )
}

const TYPE_TILES = [
  { type: 'alert', label: 'Alerts', hint: 'One flagged batch each' },
  { type: 'notice', label: 'Notices', hint: 'Regulator documents' },
  { type: 'retraction', label: 'Retractions', hint: 'Corrections' },
  { type: 'heartbeat', label: 'Heartbeat', hint: 'Pipeline lease' },
] as const

export function Overview({ summary, filters, onApply }: { summary: SummaryState; filters: DirectoryFilters; onApply: Apply }) {
  if (summary.kind === 'error') return null
  const d = summary.kind === 'ok' ? summary.data : null
  const alertPatch = (p: Partial<DirectoryFilters>) => onApply({ type: 'alert', ...p })
  return (
    <Panel id="overview" kicker="Overview" title="What is on Arkiv right now" className="min-w-0">
      <div aria-busy={!d} data-overview={d ? 'ready' : 'loading'}>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
          {TYPE_TILES.map((t) => {
            const n = d?.entities[t.type] ?? null
            const clickable = t.type !== 'retraction'
            const on = clickable && filters.type === t.type
            const body = (
              <>
                <span className="block text-xs font-semibold text-muted-foreground">{t.label}</span>
                <span className="mt-1 block font-mono text-2xl font-semibold tabular-nums" data-count={t.type}>
                  {n === null ? <Skeleton className="h-7 w-16" /> : nf(n)}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{t.hint}</span>
              </>
            )
            return (
              <li key={t.type}>
                {clickable ? (
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onApply({ type: t.type })}
                    className={cn('w-full rounded-xl border bg-background/60 p-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none', on && 'border-primary/40 bg-primary/5')}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="rounded-xl border bg-background/60 p-3">{body}</div>
                )}
              </li>
            )
          })}
        </ul>

        {d ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={filters.type === 'alert' && filters.peds === '1'}
                onClick={() => alertPatch({ peds: filters.peds === '1' ? '' : '1' })}
                className={cn('flex min-h-14 items-center gap-3 rounded-xl border bg-background/60 p-3 text-left hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none', filters.peds === '1' && 'border-primary/40 bg-primary/5')}
              >
                <Baby className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-mono text-base font-semibold tabular-nums" data-count="peds">{nf(d.alerts.peds)}</span>
                  <span className="block text-xs text-muted-foreground">Child Shield (paediatric)</span>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={filters.type === 'alert' && filters.inDate}
                onClick={() => alertPatch({ inDate: !filters.inDate })}
                className={cn('flex min-h-14 items-center gap-3 rounded-xl border bg-background/60 p-3 text-left hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none', filters.inDate && 'border-primary/40 bg-primary/5')}
              >
                <CalendarCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-mono text-base font-semibold tabular-nums" data-count="inDate">{nf(d.alerts.inDate)}</span>
                  <span className="block text-xs text-muted-foreground">Batch still in date</span>
                </span>
              </button>
            </div>

            <div className="mt-4">
              <h3 className="text-xs font-semibold text-muted-foreground">By severity</h3>
              <div className="mt-2 grid grid-cols-5 gap-1.5" role="group" aria-label="Filter by severity">
                {[1, 2, 3, 4, 5].map((s) => {
                  const n = d.alerts.bySev[String(s)] ?? 0
                  const on = filters.sevMin === s && filters.sevMax === s
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() => alertPatch(on ? { sevMin: 0, sevMax: 0 } : { sevMin: s, sevMax: s })}
                      aria-label={`Severity ${s}: ${nf(n)} alerts`}
                      className={cn(
                        'rounded-xl border p-2 text-center transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                        s >= 4 ? 'border-flagged-border bg-flagged-soft text-flagged' : 'bg-background/60 hover:bg-muted/60',
                        on && 'ring-2 ring-primary',
                      )}
                    >
                      <span className="block font-mono text-[11px] font-bold uppercase opacity-80">Sev {s}</span>
                      <span className="block font-mono text-sm font-semibold tabular-nums">{nf(n)}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Bars title="By source" counts={d.alerts.bySrc} label={sourceLabel} active={filters.src} onPick={(k) => alertPatch({ src: k })} />
              <Bars title="By category" counts={d.alerts.byCat} label={(k) => CATEGORY_LABEL[k] ?? k} active={filters.cat} onPick={(k) => alertPatch({ cat: k })} />
              <Bars title="By manufacturing state" counts={d.alerts.byState} label={placeName} active={filters.state} onPick={(k) => alertPatch({ state: k })} />
              <Bars title="By dosage form" counts={d.alerts.byForm} label={(k) => k[0]!.toUpperCase() + k.slice(1)} active={filters.form} onPick={(k) => alertPatch({ form: k })} />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Counted from Arkiv at block {blk(d.generatedAtBlock)}, {timeAgo(Date.parse(d.generatedAt))}. Tap any row to filter.
            </p>
          </>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-5/6" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}
