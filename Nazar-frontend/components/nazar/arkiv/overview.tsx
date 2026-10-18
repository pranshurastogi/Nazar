'use client'

import { useState } from 'react'
import { Activity, Baby, Building2, CalendarCheck, ChevronDown, Database, FileText, Fingerprint, Info, Layers, MapPin, MousePointerClick, Pill, RotateCcw, ShieldAlert, Tag, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { timeAgo } from '@/components/nazar/status-pill'
import { explorerAddress, PROJECT, PUBLISHER } from '@/lib/source'
import type { ArkivSummary, Counts, DirectoryFilters } from '@/lib/source/directory'
import { cn } from '@/lib/utils'
import { blk, CATEGORY_LABEL, CopyButton, ExplorerLink, nf, Panel, placeName, Skeleton, sourceLabel } from './shared'

// Header (what Arkiv is, who publishes, which block) and the live overview: counts by entity
// type and small breakdowns of the alerts. Every breakdown is a button that applies itself as
// a filter, so the overview doubles as the quickest way into the results.
//
// Loading placeholders use the final markup and sizes, so nothing moves when the counts land.
// The counts are on-chain totals and can exceed the app's alert count (see COUNT_NOTE).

export type SummaryState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: ArkivSummary; fetchedAt: number }
  | { kind: 'error'; message: string; throttled: boolean; noApi: boolean }

/**
 * The API marks its counts "stale" as soon as they are 5 minutes old (it then recounts in the
 * background), but nothing on Arkiv changes between pipeline runs, which come every 6 hours.
 * So counts only read as out of date after 12 hours; before that they are simply "counted N ago".
 */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000

export function DirectoryHeader({ summary, block, onRefresh }: { summary: SummaryState; block: string | null; onRefresh: () => void }) {
  const latest = summary.kind === 'ok' ? summary.data.latestBlock : block
  const countedAt = summary.kind === 'ok' ? Date.parse(summary.data.generatedAt) : NaN
  const recounting = summary.kind === 'ok' && summary.data.stale
  const stale = recounting && Number.isFinite(countedAt) && Date.now() - countedAt > STALE_AFTER_MS
  const live = summary.kind === 'ok' && !recounting
  const label =
    summary.kind === 'loading'
      ? 'Reading Arkiv…'
      : live
        ? `Live · ${blk(latest)}`
        : stale
          ? `Counts from ${timeAgo(countedAt)}`
          : recounting
            ? `Counted ${Number.isFinite(countedAt) ? timeAgo(countedAt) : 'recently'}`
            : block
              ? 'Live · results only'
              : 'Counts unavailable'
  return (
    <header className="rounded-2xl border bg-card p-4 sm:p-5" data-arkiv-header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* The hero above introduces the page; this bar is the live state of the data. */}
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.16em] text-primary uppercase">On-chain status</p>
          <h3 className="mt-0.5 text-base font-semibold tracking-tight">Everything Nazar has published</h3>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-live={live ? 'live' : stale ? 'stale' : recounting ? 'recent' : summary.kind}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold',
              live || recounting ? 'border-primary/30 bg-primary/10 text-primary' : stale ? 'border-caution-border bg-caution-soft text-caution' : 'text-muted-foreground',
            )}
            title={summary.kind === 'ok' ? `Counted at block ${summary.data.generatedAtBlock}, ${new Date(summary.data.generatedAt).toLocaleString('en-IN')}` : undefined}
          >
            <span className={cn('size-2 rounded-full', live ? 'bg-primary motion-safe:animate-pulse' : recounting && !stale ? 'bg-primary' : stale ? 'bg-caution' : 'bg-muted-foreground/50')} aria-hidden="true" />
            {label}
          </span>
          <Button variant="outline" size="icon" className="size-11 rounded-full" onClick={onRefresh} aria-label="Refresh counts">
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

const sortCounts = (c: Counts) => Object.entries(c).sort((a, b) => b[1] - a[1])
/** Share as a label: tiny groups read "<1%", not a misleading "0%". */
const pct = (n: number, total: number) => {
  if (!total || !n) return '0%'
  const p = (n / total) * 100
  return p < 1 ? '<1%' : `${Math.round(p)}%`
}
const ring = 'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'

/** Values that are not a queryable attribute value ("state not listed", catch-all buckets). */
const NOT_FILTERABLE = new Set(['unknown', ''])

// ---------------------------------------------------------------------------------------------
// Headline stats: one even row, the alert total leading.

type Stat = {
  key: string
  count: number | null
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'primary' | 'flagged' | 'quiet'
  pressed?: boolean
  onClick?: () => void
  live?: boolean
}

function StatTile({ s, lead }: { s: Stat; lead?: boolean }) {
  const Icon = s.icon
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md',
            s.tone === 'flagged' ? 'bg-flagged-soft text-flagged' : s.tone === 'quiet' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
          )}
          aria-hidden="true"
        >
          <Icon className="size-3.5" />
        </span>
        <span className="text-xs font-semibold whitespace-nowrap text-muted-foreground">{s.label}</span>
      </span>
      <span className={cn('relative mt-2 flex items-baseline gap-2 font-mono font-semibold tabular-nums', lead ? 'text-3xl' : 'text-2xl')} data-count={s.key}>
        {s.count === null ? (
          // same text metrics as a real count, so the tile keeps its height when it lands
          <>
            <span className="invisible">0,000</span>
            <Skeleton className="absolute inset-y-1 left-0 w-16" />
          </>
        ) : (
          nf(s.count)
        )}
        {s.live && s.count ? <span className="size-2 rounded-full bg-primary motion-safe:animate-pulse" aria-label="renewing" /> : null}
      </span>
      <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{s.hint}</span>
    </>
  )
  const cls = cn(
    'flex h-full w-full flex-col rounded-xl border bg-background/60 p-3.5 text-left',
    lead && 'border-primary/25 bg-primary/[0.04]',
    s.pressed && 'border-primary/50 bg-primary/10',
  )
  return s.onClick ? (
    <button type="button" aria-pressed={!!s.pressed} onClick={s.onClick} className={cn(cls, 'transition-colors hover:bg-muted/60', ring)} title={`Show ${s.label.toLowerCase()}`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

// ---------------------------------------------------------------------------------------------
// Severity: one proportional bar, so the shape of the risk reads at a glance.

const SEV_TONE: Record<number, { bar: string; chip: string }> = {
  1: { bar: 'bg-quiet/35', chip: 'border-quiet-border bg-quiet-soft text-quiet' },
  2: { bar: 'bg-quiet/65', chip: 'border-quiet-border bg-quiet-soft text-quiet' },
  3: { bar: 'bg-caution', chip: 'border-caution-border bg-caution-soft text-caution' },
  4: { bar: 'bg-flagged/70', chip: 'border-flagged-border bg-flagged-soft text-flagged' },
  5: { bar: 'bg-flagged', chip: 'border-flagged-border bg-flagged-soft text-flagged' },
}

/** bySev is null while loading: same layout, placeholders for the numbers. */
function SeverityStrip({ bySev, total, filters, onApply }: { bySev: Counts | null; total: number; filters: DirectoryFilters; onApply: Apply }) {
  const sevs = [5, 4, 3, 2, 1]
  const serious = bySev ? (bySev['4'] ?? 0) + (bySev['5'] ?? 0) : 0
  return (
    <section className="rounded-xl border bg-background/60 p-3.5 sm:p-4" aria-labelledby="ov-sev">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="ov-sev" className="text-sm font-semibold">Severity</h3>
        <p className="text-xs text-muted-foreground">
          {bySev ? (
            <>
              <span className="font-semibold text-flagged">{nf(serious)}</span> serious (4–5) · {pct(serious, total)} of alerts
            </>
          ) : (
            <Skeleton className="inline-block h-3 w-36 align-middle" />
          )}
        </p>
      </div>
      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {bySev && [1, 2, 3, 4, 5].map((s) => {
          const n = bySev[String(s)] ?? 0
          return n ? <span key={s} className={cn('h-full first:rounded-l-full last:rounded-r-full', SEV_TONE[s]!.bar)} style={{ width: `${(n / Math.max(1, total)) * 100}%` }} /> : null
        })}
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5" role="group" aria-label="Filter by severity">
        {sevs.map((s) => {
          const n = bySev?.[String(s)] ?? 0
          const on = filters.sevMin === s && filters.sevMax === s
          return (
            <button
              key={s}
              type="button"
              disabled={!bySev}
              aria-pressed={on}
              aria-label={bySev ? `Severity ${s}: ${nf(n)} alerts` : `Severity ${s}: loading`}
              onClick={() => onApply(on ? { type: 'alert', sevMin: 0, sevMax: 0 } : { type: 'alert', sevMin: s, sevMax: s })}
              className={cn('flex min-h-12 flex-col items-center justify-center rounded-lg border px-1 py-1.5 transition-colors', SEV_TONE[s]!.chip, on ? 'ring-2 ring-primary' : 'hover:brightness-95', ring)}
            >
              <span className="text-[10px] font-bold tracking-wider uppercase">Sev {s}</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{bySev ? nf(n) : '–'}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Breakdowns: one card each, top rows with share bars, the rest one tap away.

function Breakdown({ title, icon: Icon, counts, label, active, onPick, total }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  counts: Counts
  label: (k: string) => string
  active: string
  onPick: (k: string) => void
  total: number
}) {
  const [open, setOpen] = useState(false)
  const rows = sortCounts(counts)
  const LIMIT = 5
  const shown = open ? rows : rows.slice(0, LIMIT)
  const hidden = rows.length - LIMIT
  const max = Math.max(1, ...rows.map(([, n]) => n))
  return (
    <section className="flex min-w-0 flex-col rounded-xl border bg-background/60 p-3.5 sm:p-4" data-breakdown={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">{rows.length} groups</span>
      </div>
      <ul className="mt-2.5 space-y-0.5">
        {shown.map(([k, n]) => {
          const can = !NOT_FILTERABLE.has(k)
          const on = active === k
          return (
            <li key={k}>
              <button
                type="button"
                disabled={!can}
                aria-pressed={on}
                onClick={() => onPick(on ? '' : k)}
                title={can ? `Show only ${label(k)}` : 'Not recorded on the notice, so it cannot be filtered'}
                className={cn(
                  'group grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
                  can ? 'hover:bg-muted/70' : 'cursor-default text-muted-foreground',
                  on && 'bg-primary/10 ring-1 ring-primary/30',
                  ring,
                )}
              >
                <span className={cn('truncate', can ? 'font-medium' : 'italic')}>{label(k)}</span>
                <span className="font-mono text-xs font-semibold tabular-nums">{nf(n)}</span>
                <span className="text-right font-mono text-[11px] text-muted-foreground tabular-nums">{pct(n, total)}</span>
                <span className="col-span-3 mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span className={cn('block h-full rounded-full', on ? 'bg-primary' : can ? 'bg-primary/50 group-hover:bg-primary/75' : 'bg-muted-foreground/30')} style={{ width: `${Math.max(2, (n / max) * 100)}%` }} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {hidden > 0 && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn('mt-auto self-start rounded-md px-2 pt-2 text-xs font-semibold text-primary hover:underline', ring)}>
          {open ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  )
}

/** A breakdown card's loading state: the same header, five rows of the same height, the same footer. */
function BreakdownSkeleton() {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border bg-background/60 p-3.5 sm:p-4" aria-hidden="true">
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-5 items-center"><Skeleton className="h-4 w-24" /></span>
        <Skeleton className="h-3 w-12" />
      </div>
      <ul className="mt-2.5 space-y-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-3 px-2 py-1.5 text-[13px]">
            <span className="flex h-5 items-center"><Skeleton className="h-3.5 w-full max-w-36" /></span>
            <Skeleton className="h-3 w-8" />
            <Skeleton className="ml-auto h-3 w-7" />
            <span className="col-span-3 mt-1 h-1 rounded-full bg-muted" />
          </li>
        ))}
      </ul>
      <span className="mt-auto px-2 pt-2 text-xs invisible">Show all</span>
    </section>
  )
}

/**
 * Why Arkiv's totals can be higher than the alert count on the Feed, the API or the More page:
 * a merged duplicate's first copy stays on chain (alerts are written read-only), and corrected
 * alerts are superseded, not deleted. The numbers themselves are left exactly as counted.
 */
const COUNT_NOTE =
  "On-chain totals can be higher than Nazar's alert count elsewhere in the app: when Nazar merges a duplicate alert, the earlier copy stays on Arkiv, because entities are read-only."

export function Overview({ summary, filters, onApply }: { summary: SummaryState; filters: DirectoryFilters; onApply: Apply }) {
  // Phones get the tiles and the severity bar; the four breakdowns sit behind one disclosure.
  const [breakdownsOpen, setBreakdownsOpen] = useState(false)
  if (summary.kind === 'error') return null
  const d = summary.kind === 'ok' ? summary.data : null
  const alertPatch = (p: Partial<DirectoryFilters>) => onApply({ type: 'alert', ...p })
  const total = d?.entities.alert ?? 0

  const stats: Stat[] = [
    { key: 'alert', count: d?.entities.alert ?? null, label: 'Alerts', hint: 'Incl. merged duplicates', icon: ShieldAlert, tone: 'flagged', pressed: filters.type === 'alert' && !filters.peds && !filters.inDate, onClick: () => onApply({ type: 'alert' }) },
    { key: 'notice', count: d?.entities.notice ?? null, label: 'Notices', hint: 'Regulator documents', icon: FileText, pressed: filters.type === 'notice', onClick: () => onApply({ type: 'notice' }) },
    { key: 'peds', count: d?.alerts.peds ?? null, label: 'Child Shield', hint: 'Paediatric formulations', icon: Baby, tone: 'flagged', pressed: filters.type === 'alert' && filters.peds === '1', onClick: () => alertPatch({ peds: filters.peds === '1' ? '' : '1' }) },
    { key: 'inDate', count: d?.alerts.inDate ?? null, label: 'Still in date', hint: 'Could still be on shelves', icon: CalendarCheck, pressed: filters.type === 'alert' && filters.inDate, onClick: () => alertPatch({ inDate: !filters.inDate }) },
    { key: 'heartbeat', count: d?.entities.heartbeat ?? null, label: 'Heartbeat', hint: 'Pipeline lease, every 5 min', icon: Activity, live: true, pressed: filters.type === 'heartbeat', onClick: () => onApply({ type: 'heartbeat' }) },
    { key: 'retraction', count: d?.entities.retraction ?? null, label: 'Retractions', hint: 'Corrections, never silent edits', icon: Undo2, tone: 'quiet' },
  ]

  return (
    <Panel id="overview" kicker="Overview" title="What is on Arkiv right now" className="min-w-0">
      <div aria-busy={!d} data-overview={d ? 'ready' : 'loading'} className="grid gap-3">
        {/* What the tiles count: entities on chain at one block, not the app's deduplicated alerts. */}
        <h3 className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold" id="ov-entities" data-entities-caption>
          <Database className="size-4 text-muted-foreground" aria-hidden="true" />
          Entities on Arkiv · at block <span className="font-mono" data-entities-block>{blk(d?.generatedAtBlock)}</span>
        </h3>
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" aria-labelledby="ov-entities">
          {stats.map((s, i) => (
            <li key={s.key} className="min-w-0">
              <StatTile s={s} lead={i === 0} />
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground" data-count-note>
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{COUNT_NOTE}</span>
        </p>

        <SeverityStrip bySev={d ? d.alerts.bySev : null} total={total} filters={filters} onApply={onApply} />

        <Button
          variant="outline"
          className="h-11 w-full justify-between rounded-xl px-3.5 text-sm lg:hidden"
          aria-expanded={breakdownsOpen}
          aria-controls="ov-breakdowns"
          onClick={() => setBreakdownsOpen((o) => !o)}
          data-breakdown-toggle
        >
          <span className="flex min-w-0 items-baseline gap-2">
            {breakdownsOpen ? 'Hide breakdowns' : 'See breakdowns'}
            <span className="truncate text-xs font-normal text-muted-foreground">Source, category, state, form</span>
          </span>
          <ChevronDown className={cn('transition-transform', breakdownsOpen && 'rotate-180')} data-icon="inline-end" />
        </Button>
        <div id="ov-breakdowns" className={cn('grid gap-3 md:grid-cols-2 2xl:grid-cols-4', !breakdownsOpen && 'max-lg:hidden')} data-breakdowns>
          {d ? (
            <>
              <Breakdown title="Source" icon={Building2} counts={d.alerts.bySrc} label={sourceLabel} total={total} active={filters.src} onPick={(k) => alertPatch({ src: k })} />
              <Breakdown title="Category" icon={Layers} counts={d.alerts.byCat} label={(k) => CATEGORY_LABEL[k] ?? k} total={total} active={filters.cat} onPick={(k) => alertPatch({ cat: k })} />
              <Breakdown title="Made in" icon={MapPin} counts={d.alerts.byState} label={placeName} total={total} active={filters.state} onPick={(k) => alertPatch({ state: k })} />
              <Breakdown title="Dosage form" icon={Pill} counts={d.alerts.byForm} label={(k) => k[0]!.toUpperCase() + k.slice(1)} total={total} active={filters.form} onPick={(k) => alertPatch({ form: k })} />
            </>
          ) : (
            [0, 1, 2, 3].map((i) => <BreakdownSkeleton key={i} />)
          )}
        </div>
        <p className="flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <Database className="size-3.5" aria-hidden="true" />
          Counted from Arkiv at block <span className="font-mono">{blk(d?.generatedAtBlock)}</span>
          {d ? ` · ${timeAgo(Date.parse(d.generatedAt))}` : ''}
          <span aria-hidden="true">·</span>
          <MousePointerClick className="size-3.5" aria-hidden="true" /> Tap any tile or row to filter the results below
        </p>
      </div>
    </Panel>
  )
}
