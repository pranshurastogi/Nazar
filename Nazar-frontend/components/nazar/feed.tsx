'use client'

import { useEffect, useRef, useState } from 'react'
import { Baby, ChevronDown, LoaderCircle, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useShell } from '@/components/nazar/app-shell'
import { FeedPulse } from '@/components/nazar/feed-pulse'
import { ResultCard, SourceTag } from '@/components/nazar/result-card'
import { Rings } from '@/components/nazar/rings'
import {
  checkBatch,
  formatYm,
  loadFeed,
  SOURCE_NAME,
  STATE_NAME,
  stateName,
  type Alert,
  type CheckResult,
  type FeedFilters,
  type FeedPage,
  currentSnapshot,
} from '@/lib/source'
import { feedKey, notDemo } from '@/lib/source/prefetch'
import { peek, revalidate } from '@/lib/source/swr'
import { serif } from '@/lib/fonts'
import { cn } from '@/lib/utils'

// The Feed tab: every alert Nazar holds, newest first, from whichever source answers
// (Nazar API, then Arkiv, then demo data). Filters live in the URL so a filtered view can
// be shared. Opening a row shows the same result card and proof sheet as a check.

type Filters = { serious: boolean; peds: boolean; state: string; source: string }
const DEFAULTS: Filters = { serious: false, peds: false, state: '', source: '' }

const STATES = Object.entries(STATE_NAME).sort((a, b) => a[1].localeCompare(b[1]))
const SOURCES = Object.entries(SOURCE_NAME)

function readUrl(): Filters {
  const p = new URLSearchParams(window.location.search)
  const state = p.get('state') ?? ''
  const source = p.get('source') ?? ''
  return {
    serious: p.get('sev') === '4',
    peds: p.get('peds') === '1',
    state: state in STATE_NAME ? state : '',
    source: source in SOURCE_NAME ? source : '',
  }
}

function writeUrl(f: Filters) {
  const p = new URLSearchParams()
  if (f.serious) p.set('sev', '4')
  if (f.peds) p.set('peds', '1')
  if (f.state) p.set('state', f.state)
  if (f.source) p.set('source', f.source)
  const qs = p.toString()
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
}

const toQuery = (f: Filters): FeedFilters => ({
  ...(f.serious ? { minSeverity: 4 } : {}),
  ...(f.peds ? { peds: true } : {}),
  ...(f.state ? { state: f.state } : {}),
  ...(f.source ? { source: f.source } : {}),
})

const isDefault = (f: Filters) => !f.serious && !f.peds && !f.state && !f.source

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

/** Consecutive alerts from the same month share a heading. */
function groupByMonth(items: Alert[]) {
  const groups: { key: string; label: string; items: Alert[] }[] = []
  for (const a of items) {
    const label = formatYm(a.alertYm) ?? 'Date not listed'
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(a)
    else groups.push({ key: `${label}-${groups.length}`, label, items: [a] })
  }
  return groups
}

function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded bg-muted motion-reduce:animate-none', className)} />
}

const fieldCls =
  'h-12 w-full appearance-none rounded-xl border bg-background pl-3.5 pr-10 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30'

function SelectField({
  id,
  label,
  value,
  onChange,
  all,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  all: string
  options: [string, string][]
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</label>
      <div className="relative">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(fieldCls, value && 'border-primary/50 bg-primary/5')}>
          <option value="">{all}</option>
          {options.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </div>
    </div>
  )
}

function SeverityTile({ value }: { value: number }) {
  const serious = value >= 4
  return (
    <span
      className={cn(
        'grid size-11 shrink-0 place-items-center content-center gap-0.5 rounded-xl',
        serious ? 'bg-flagged text-white dark:text-background' : 'bg-flagged-soft text-flagged',
      )}
    >
      <span className="font-mono text-base leading-none font-semibold" aria-hidden="true">{value}</span>
      <span className="text-[9px] leading-none font-bold tracking-wider uppercase" aria-hidden="true">sev</span>
      <span className="sr-only">Severity {value} of 5</span>
    </span>
  )
}

function FeedRow({ alert, open, onToggle }: { alert: Alert; open: boolean; onToggle: () => void }) {
  const made = stateName(alert.state)
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={`alert-${alert.id}`}
      data-alert-row={alert.id}
      className={cn(
        'group flex min-h-[4.75rem] w-full items-start gap-3.5 rounded-xl px-2.5 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:px-3',
        open && 'bg-muted/60',
      )}
    >
      <SeverityTile value={alert.severity} />
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          {/* The name gets the width and may take two lines; the on-chain status is a small dot,
              explained once in the list header. */}
          <span className="line-clamp-2 min-w-0 text-sm leading-5 font-semibold break-words sm:text-[15px]" data-row-name>
            {alert.brand}
            {alert.entityKey && (
              <span
                data-live-arkiv
                role="img"
                aria-label="Live on Arkiv"
                title="Live on Arkiv"
                className="ml-1.5 inline-block size-2 rounded-full bg-primary align-middle ring-2 ring-primary/20"
              />
            )}
          </span>
          {alert.peds && (
            <span className="mt-px inline-flex shrink-0 items-center gap-1 rounded-full border border-flagged-border px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-flagged uppercase">
              <Baby className="size-3" aria-hidden="true" /> Child
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-foreground/85">
          <span className="font-mono font-semibold">{alert.batch}</span>
          <span className="text-muted-foreground"> · {alert.failure}</span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          <span className="block truncate sm:inline">{alert.authority}</span>
          <span className="hidden sm:inline"> · </span>
          <span className="block sm:inline">
            {alert.noticeDate}
            {made ? ` · Made in ${made}` : ''}
          </span>
        </span>
      </span>
      <ChevronDown
        className={cn('mt-3.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
        aria-hidden="true"
      />
    </button>
  )
}

/** The expanded view of one feed alert: a result card, upgraded with every notice for the batch when a check finds them. */
function FeedDetail({ alert, source }: { alert: Alert; source: FeedPage['source'] }) {
  const shell = useShell()
  const ref = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<CheckResult>(() => ({ state: 'flagged', batch: alert.batch, alert, alerts: [alert], asOf: new Date(), source }))

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    const ctrl = new AbortController()
    checkBatch(alert.batch, { signal: ctrl.signal }).then(
      (r) => {
        if (ctrl.signal.aborted || !('alerts' in r) || r.source !== source) return
        if (r.alerts.length > 1 && r.alerts.some((a) => a.id === alert.id)) setResult(r)
      },
      () => {},
    )
    return () => ctrl.abort()
  }, [alert, source])

  return (
    <div ref={ref} id={`alert-${alert.id}`} role="region" aria-label={`Alert details for batch ${alert.batch}`} className="scroll-mb-28 px-0.5 pt-1 pb-3">
      <ResultCard result={result} onCheck={shell.requestCheck} />
    </div>
  )
}

export function Feed() {
  const [filters, setFilters] = useState<Filters | null>(null)
  const [items, setItems] = useState<Alert[]>([])
  const [page, setPage] = useState<FeedPage | null>(null)
  const [loading, setLoading] = useState<'first' | 'more' | null>('first')
  const [openId, setOpenId] = useState<string | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  useEffect(() => setFilters(readUrl()), [])

  useEffect(() => {
    if (!filters) return
    writeUrl(filters)
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setOpenId(null)
    const q = toQuery(filters)
    const key = feedKey(q)
    // Paint the last answer for these filters at once, then refresh it in the background.
    // A page restored from sessionStorage has no `more` until the fresh one arrives.
    const cached = peek<FeedPage>(key)
    if (cached) {
      setItems(cached.value.items)
      setPage({ ...cached.value, more: cached.value.more ?? null })
      setLoading(null)
    } else setLoading('first')
    revalidate(key, () => loadFeed(q), { keep: notDemo }).then(
      (p) => {
        if (ctrl.signal.aborted) return
        setItems(p.items)
        setPage(p)
        setLoading(null)
      },
      (err) => {
        if (ctrl.signal.aborted) return
        console.info('Nazar feed unavailable', err)
        setLoading(null)
      },
    )
    return () => ctrl.abort()
  }, [filters])

  const loadMore = async () => {
    if (!page?.more || loading) return
    const ctrl = ctrlRef.current
    setLoading('more')
    try {
      const next = await page.more(ctrl?.signal)
      if (ctrl?.signal.aborted) return
      setItems((prev) => {
        const seen = new Set(prev.map((a) => a.id))
        return [...prev, ...next.items.filter((a) => !seen.has(a.id))]
      })
      setPage(next)
    } catch {
      if (!ctrl?.signal.aborted) toast.error("Couldn't load more alerts. Please try again.")
    } finally {
      if (!ctrl?.signal.aborted) setLoading(null)
    }
  }

  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...(f ?? DEFAULTS), ...patch }))
  const f = filters ?? DEFAULTS
  const first = loading === 'first'
  const saved = page?.source === 'snapshot' ? currentSnapshot() : null
  const savedAt = saved ? saved.generatedAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null
  const total = page?.total ?? null
  const count = first || !page ? null : total !== null ? plural(total, 'alert') : `${plural(items.length, 'alert')}${page.more ? ' so far' : ''}`
  const onChain = !first && items.some((a) => a.entityKey)

  return (
    <div className="pt-4 md:pt-8">
      <section className="max-w-2xl">
        <p className="text-[11px] font-bold tracking-[0.18em] text-primary uppercase">Regulator alerts</p>
        <h2 className="mt-3 text-[clamp(2rem,6vw,2.75rem)] leading-[1.02] font-semibold tracking-[-0.045em]">
          Every alert, <span className={cn(serif.className, 'pr-1 text-[1.1em] font-normal tracking-normal text-primary')}>newest first.</span>
        </h2>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          Batches named by CDSCO, state drug controllers and WHO, read from their own documents. Open any alert for the proof.
        </p>
      </section>

      <FeedPulse state={f.state} serious={f.serious} peds={f.peds} source={f.source} onState={(state) => update({ state })} />

      <section aria-label="Filter alerts" className="mt-7 rounded-2xl border bg-card p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)] md:items-end md:gap-4">
          <div>
            <p className="mb-1.5 hidden text-xs font-semibold text-muted-foreground md:block" aria-hidden="true">Severity</p>
            <div role="group" aria-label="Severity" className="grid h-12 grid-cols-2 overflow-hidden rounded-xl border bg-background">
              {[
                { serious: false, label: 'All' },
                { serious: true, label: 'Serious 4–5' },
              ].map((o) => (
                <button
                  key={o.label}
                  aria-pressed={f.serious === o.serious}
                  onClick={() => update({ serious: o.serious })}
                  className={cn(
                    'h-full px-4 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
                    f.serious === o.serious && 'bg-primary/10 text-primary hover:text-primary',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 hidden text-xs font-semibold text-muted-foreground md:block" aria-hidden="true">Children</p>
            <button
              aria-pressed={f.peds}
              onClick={() => update({ peds: !f.peds })}
              className={cn(
                'flex h-12 w-full items-center justify-center gap-2 rounded-xl border bg-background px-4 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                f.peds && 'border-primary/50 bg-primary/10 text-primary hover:text-primary',
              )}
            >
              <Baby className="size-4" aria-hidden="true" /> Child Shield only
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:contents">
            <SelectField id="feed-state" label="Made in" value={f.state} onChange={(v) => update({ state: v })} all="All states" options={STATES} />
            <SelectField id="feed-source" label="Source" value={f.source} onChange={(v) => update({ source: v })} all="All sources" options={SOURCES} />
          </div>
        </div>
      </section>

      <div className="mt-6 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
        <p className="text-sm" aria-live="polite" aria-atomic="true" data-feed-count>
          {count ? (
            <>
              <span className="font-semibold">{count}</span>
              <span className="text-muted-foreground"> · newest first</span>
            </>
          ) : (
            <Skeleton className="h-4 w-36" />
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {onChain && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-feed-onchain-key>
              <span className="size-2 rounded-full bg-primary ring-2 ring-primary/20" aria-hidden="true" />
              Live on Arkiv
            </span>
          )}
          {page && !first && <SourceTag source={page.source} />}
          {!isDefault(f) && (
            <Button variant="ghost" className="h-11 px-3" onClick={() => setFilters(DEFAULTS)}>
              <RotateCcw /> Reset filters
            </Button>
          )}
        </div>
      </div>

      {page?.source === 'snapshot' && !first && (
        <p className="mt-2 rounded-xl bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground" data-feed-saved-copy>
          The Nazar API and Arkiv could not answer just now, so this is Nazar&apos;s saved copy of every published alert
          {savedAt ? `, as of ${savedAt}` : ''}. It refreshes when they are back.
        </p>
      )}
      {page?.source === 'demo' && !first && (
        <p className="mt-2 rounded-xl bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
          Demo data: the Nazar API and Arkiv could not answer, so built-in sample alerts are shown.
        </p>
      )}

      <div className="mt-3 rounded-2xl border bg-card px-2 py-2 sm:px-3" aria-busy={first} data-feed data-feed-source={first ? undefined : page?.source}>
        {first &&
          [0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex min-h-[4.75rem] items-start gap-3.5 px-2.5 py-3 sm:px-3">
              <Skeleton className="size-11 rounded-xl" />
              <span className="grid flex-1 gap-2 pt-1">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </span>
            </div>
          ))}

        {!first && items.length === 0 && (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Rings className="size-24"><Search /></Rings>
            <p className="mt-4 font-semibold">No alerts match these filters</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">Try another state or source, or reset the filters to see every alert.</p>
            {!isDefault(f) && (
              <Button variant="outline" className="mt-5 h-11" onClick={() => setFilters(DEFAULTS)}>
                <RotateCcw /> Reset filters
              </Button>
            )}
          </div>
        )}

        {!first &&
          groupByMonth(items).map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h3 className="px-2.5 pt-3 pb-1 text-[11px] font-bold tracking-[0.16em] text-muted-foreground uppercase sm:px-3">{g.label}</h3>
              <ul className="divide-y divide-border/70">
                {g.items.map((a) => (
                  <li key={a.id}>
                    <FeedRow alert={a} open={openId === a.id} onToggle={() => setOpenId((id) => (id === a.id ? null : a.id))} />
                    {openId === a.id && page && <FeedDetail alert={a} source={page.source} />}
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>

      {!first && items.length > 0 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {page?.more ? (
            <Button variant="outline" className="h-12 w-full max-w-sm text-sm font-semibold" onClick={loadMore} aria-busy={loading === 'more'} disabled={loading === 'more'}>
              {loading === 'more' ? (
                <>
                  Loading <LoaderCircle data-icon="inline-end" className="animate-spin motion-reduce:animate-none" />
                </>
              ) : (
                'Load more alerts'
              )}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">End of the feed</p>
          )}
          {page?.more && (
            <p className="text-xs text-muted-foreground">
              Showing {items.length.toLocaleString('en-IN')}
              {total !== null ? ` of ${total.toLocaleString('en-IN')}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
