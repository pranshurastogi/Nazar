'use client'

import { Activity, CloudOff, FileText, Hourglass, LoaderCircle, RotateCcw, SearchX, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { timeAgo } from '@/components/nazar/status-pill'
import { attr, type DirectoryEntity, type DirectoryReadError, type DirectoryType } from '@/lib/source/directory'
import { formatWait } from '@/lib/format-wait'
import { cn } from '@/lib/utils'
import { blk, categoryLabel, Chip, CopyButton, ExplorerLink, explorerEntity, monthYear, nf, placeName, shortKey, Skeleton, sourceLabel, ym } from './shared'

// The results list: one row per entity, the attributes people filter on as chips, and the
// expiry block turned into a date. Opening a row shows the entity drawer.
//
// Two different expiries meet in an alert row and are labelled apart: the medicine's own
// "Batch expiry" (from the regulator notice) and "On Arkiv until", the entity's lifetime.

export type ResultsState =
  | { kind: 'loading' }
  | { kind: 'ok'; items: DirectoryEntity[]; cursor: string | null; block: string; more: 'idle' | 'loading' | 'error' }
  | { kind: 'error'; error: DirectoryReadError }

const payloadOf = (e: DirectoryEntity) => (e.payload && typeof e.payload === 'object' ? (e.payload as Record<string, unknown>) : {})

function SevTile({ value }: { value: number }) {
  const serious = value >= 4
  return (
    <span className={cn('grid size-10 shrink-0 place-items-center content-center rounded-xl', serious ? 'bg-flagged text-white dark:text-background' : 'bg-flagged-soft text-flagged')}>
      <span className="font-mono text-sm leading-none font-semibold" aria-hidden="true">{value}</span>
      <span className="text-[8px] leading-none font-bold tracking-wider uppercase" aria-hidden="true">sev</span>
      <span className="sr-only">Severity {value} of 5</span>
    </span>
  )
}

function TypeIcon({ type }: { type: string }) {
  const Icon = type === 'notice' ? FileText : Activity
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
      <Icon className="size-5" aria-hidden="true" />
    </span>
  )
}

/** The entity's lifetime on Arkiv: a month for alerts and notices, a time for the short heartbeat lease. */
function lifetime(e: DirectoryEntity) {
  if (!e.expiresAtEstimate) return null
  if (e.type === 'heartbeat') {
    const d = new Date(e.expiresAtEstimate)
    return Number.isNaN(d.getTime()) ? null : `Lease ends ~${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
  }
  const m = monthYear(e.expiresAtEstimate)
  return m ? `On Arkiv until ~${m}` : null
}

/** Chips that hold words (not codes) read better, and narrower, in the text face. */
const WORDS = 'font-sans text-xs'

function Row({ e, onOpen, onNoticeAlerts }: { e: DirectoryEntity; onOpen: () => void; onNoticeAlerts: () => void }) {
  const p = payloadOf(e)
  const exp = lifetime(e)
  let title: string
  let lead: React.ReactNode
  let chips: React.ReactNode
  if (e.type === 'alert') {
    const sev = Number(attr(e, 'sev') ?? 1)
    title = String(p.product ?? attr(e, 'brand') ?? 'Alert')
    lead = <SevTile value={sev} />
    const state = attr(e, 'state')
    const expYm = ym(attr(e, 'exp_ym'))
    chips = (
      <>
        <Chip tone="primary" title="batch">{String(attr(e, 'batch_raw') ?? attr(e, 'batch') ?? '')}</Chip>
        <Chip title="src" className={WORDS}>{sourceLabel(String(attr(e, 'src') ?? ''))}</Chip>
        {state && <Chip title="state" className={WORDS}>{placeName(String(state))}</Chip>}
        <Chip title={`cat = ${String(attr(e, 'cat') ?? '')}`} className={WORDS}>{categoryLabel(String(attr(e, 'cat') ?? ''))}</Chip>
        {expYm && <Chip title="exp_ym: the medicine's expiry, from the notice" className={WORDS}>Batch expiry {expYm}</Chip>}
        {attr(e, 'peds') === 1 && <Chip tone="caution" title="peds" className={WORDS}>Child Shield</Chip>}
      </>
    )
  } else if (e.type === 'notice') {
    title = String(p.title ?? 'Regulator notice')
    lead = <TypeIcon type="notice" />
    chips = (
      <>
        <Chip title="src" className={WORDS}>{sourceLabel(String(attr(e, 'src') ?? ''))}</Chip>
        {ym(attr(e, 'notice_ym')) && <Chip title="notice_ym" className={WORDS}>{ym(attr(e, 'notice_ym'))}</Chip>}
        <Chip tone="primary" title="rows">{nf(Number(attr(e, 'rows') ?? 0))} rows</Chip>
      </>
    )
  } else {
    const last = Number(attr(e, 'last_ok') ?? 0)
    title = `Pipeline heartbeat · ${String(attr(e, 'worker') ?? 'worker')}`
    lead = <TypeIcon type="heartbeat" />
    chips = <Chip tone="primary" title="last_ok">last ok {last ? timeAgo(last) : 'unknown'}</Chip>
  }
  return (
    // Phones: the chips get the row's full width and the key, its lifetime and the actions share
    // a footer line, so a row stays a few lines tall instead of one chip per line. From sm up the
    // footer dissolves into the grid (display: contents) and the actions sit to the right.
    <li className="grid grid-cols-1 border-b py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-2" data-entity-row={e.key} data-entity-type={e.type}>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className="flex w-full min-w-0 items-start gap-3 rounded-xl p-1.5 text-left transition-colors sm:col-start-1 sm:row-start-1 hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {lead}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="mt-1.5 flex flex-wrap gap-1">{chips}</span>
        </span>
      </button>
      <div className="mt-0.5 flex items-center justify-between gap-2 pr-1.5 sm:contents">
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-[3.625rem] text-[11px] text-muted-foreground sm:col-start-1 sm:row-start-2 sm:pb-1">
          <span className="font-mono">{shortKey(e.key)}</span>
          {exp && (
            <span className="inline-flex items-center gap-1" title="When this entity expires on Arkiv (estimated from block times)" data-entity-lifetime>
              <Hourglass className="size-3" aria-hidden="true" /> {exp}
            </span>
          )}
        </span>
        <div className="flex shrink-0 items-center gap-1.5 sm:col-start-2 sm:row-[1/span_2] sm:flex-col sm:items-end sm:self-start sm:pt-1.5">
          {e.type === 'notice' && (
            <Button variant="outline" className="hidden h-11 rounded-xl px-3 text-xs sm:inline-flex" onClick={onNoticeAlerts}>
              Its alerts
            </Button>
          )}
          <CopyButton value={e.key} what="Entity key" />
          <ExplorerLink href={explorerEntity(e.key)} label="Open entity in the Arkiv explorer" />
        </div>
      </div>
    </li>
  )
}

const TYPE_NOUN: Record<DirectoryType, string> = { alert: 'alerts', notice: 'notices', heartbeat: 'heartbeats' }

/**
 * Arkiv returns entities in key order, which means nothing to a reader. The loaded rows are
 * shown newest first instead: by alert or notice month, then by the block that created them.
 */
function newestFirst(items: DirectoryEntity[]) {
  const month = (e: DirectoryEntity) => Number(attr(e, e.type === 'notice' ? 'notice_ym' : 'alert_ym') ?? 0) || 0
  const born = (e: DirectoryEntity) => Number(e.createdAtBlock ?? 0) || 0
  return [...items].sort((a, b) => month(b) - month(a) || born(b) - born(a))
}

export function Results({
  state,
  type,
  filtered,
  onOpen,
  onMore,
  onRetry,
  onReset,
  onBrowser,
  onNoticeAlerts,
}: {
  state: ResultsState
  type: DirectoryType
  filtered: boolean
  onOpen: (e: DirectoryEntity) => void
  onMore: () => void
  onRetry: () => void
  onReset: () => void
  onBrowser: (() => void) | null
  onNoticeAlerts: (key: string) => void
}) {
  return (
    <section aria-labelledby="results-title" className="min-w-0 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="results-title" className="text-base font-semibold tracking-tight">Entities</h2>
        {state.kind === 'ok' && (
          <p className="text-xs text-muted-foreground" data-results-count aria-live="polite">
            {nf(state.items.length)} {TYPE_NOUN[type]} shown{state.items.length > 1 ? ', newest first' : ''}{state.cursor ? ', more available' : ''}
          </p>
        )}
      </div>
      <div className="mt-2" data-results={state.kind} aria-busy={state.kind === 'loading'}>
        {state.kind === 'loading' && (
          <ul aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-start gap-3 border-b py-3.5 last:border-b-0">
                <Skeleton className="size-10 rounded-xl" />
                <span className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-5 w-1/2" />
                </span>
              </li>
            ))}
          </ul>
        )}

        {state.kind === 'error' && (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-caution-border bg-caution-soft p-4" role="alert" data-results-error={state.error.kind}>
            <p className="flex items-start gap-2 text-sm font-semibold text-caution">
              {state.error.kind === 'throttled' ? <Hourglass className="mt-0.5 size-4 shrink-0" /> : state.error.kind === 'unavailable' || state.error.kind === 'no-api' ? <CloudOff className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
              {state.error.kind === 'throttled'
                ? 'Arkiv is rate limiting requests right now'
                : state.error.kind === 'expired'
                  ? 'That page has expired'
                  : state.error.kind === 'bad-request'
                    ? 'Those filters could not be run'
                    : 'Arkiv could not be read'}
            </p>
            <p className="text-[13px] leading-5 text-foreground/80">
              {state.error.kind === 'throttled'
                ? `The public Arkiv RPC limits anonymous readers.${state.error.retryInMs ? ` Try again in ${formatWait(state.error.retryInMs)}.` : ' Try again shortly.'} Nothing is wrong with the data.`
                : state.error.message}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-10 px-3 text-sm" onClick={onRetry}>
                <RotateCcw /> Try again
              </Button>
              {onBrowser && (
                <Button variant="outline" className="h-10 px-3 text-sm" onClick={onBrowser}>
                  Run from my browser instead
                </Button>
              )}
            </div>
          </div>
        )}

        {state.kind === 'ok' && state.items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center" data-results-empty>
            <SearchX className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-semibold">{filtered ? 'No entities match these filters' : `No ${TYPE_NOUN[type]} from this publisher on Arkiv`}</p>
            <p className="max-w-sm text-[13px] text-muted-foreground">
              {filtered
                ? 'Arkiv matched nothing for this query. Loosen a filter or reset them.'
                : type === 'heartbeat'
                  ? 'The heartbeat expires 20 minutes after the pipeline last reported in, so none means it is not running right now.'
                  : 'This wallet has not published anything of this type, or it has all expired.'}
            </p>
            {filtered && (
              <Button variant="outline" className="mt-2 h-10 px-3 text-sm" onClick={onReset}>
                <RotateCcw /> Reset filters
              </Button>
            )}
          </div>
        )}

        {state.kind === 'ok' && state.items.length > 0 && (
          <>
            <ul>
              {newestFirst(state.items).map((e) => (
                <Row key={e.key} e={e} onOpen={() => onOpen(e)} onNoticeAlerts={() => onNoticeAlerts(e.key)} />
              ))}
            </ul>
            {state.cursor && (
              <div className="mt-3 flex flex-col items-center gap-2">
                <Button variant="outline" className="h-11 w-full px-4 sm:w-auto" onClick={onMore} disabled={state.more === 'loading'} data-load-more>
                  {state.more === 'loading' ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
                  {state.more === 'loading' ? 'Loading…' : 'Load more'}
                </Button>
                {state.more === 'error' && <p className="text-xs text-caution">The next page could not be read. Try again.</p>}
                <p className="text-[11px] text-muted-foreground">Pages are pinned to block {blk(state.block)}, so they stay consistent while new blocks arrive.</p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
