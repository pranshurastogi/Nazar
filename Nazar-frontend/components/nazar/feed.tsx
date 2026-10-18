'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Baby, ChevronDown, LoaderCircle, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useShell } from '@/components/nazar/app-shell'
import { FeedPulse } from '@/components/nazar/feed-pulse'
import { RssPanel, RssToggle } from '@/components/nazar/feed-rss'
import { CheckBatchOffer, FeedSearchBox, Highlight, mentions } from '@/components/nazar/feed-search'
import { ResultCard, SourceTag } from '@/components/nazar/result-card'
import { Rings } from '@/components/nazar/rings'
import {
  checkBatch,
  loadFeed,
  SOURCE_NAME,
  STATE_NAME,
  stateName,
  type Alert,
  type CheckResult,
  type FeedFilters,
  type FeedPage,
  currentSnapshot,
  loadSnapshot,
  onSnapshot,
} from '@/lib/source'
import { feedKey, notDemo } from '@/lib/source/prefetch'
import { batchLike, queryTerms, searchAlerts, type SearchAnswer } from '@/lib/source/search'
import type { SnapshotIndex } from '@/lib/source/snapshot'
import { alertEntries, alertKey, endVisit, isNew, markSeen, snapshotEntries, visitBaseline, type SeenState } from '@/lib/seen'
import { peek, revalidate } from '@/lib/source/swr'
import { serif } from '@/lib/fonts'
import { formatYmLocale, useT, type Locale, type MessageKey, type PluralKey, type Vars } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// The Feed tab: every alert Nazar holds, newest first, from whichever source answers
// (Nazar API, then Arkiv, then demo data). Filters live in the URL so a filtered view can
// be shared. Opening a row shows the same result card and proof sheet as a check.
// A search box at the top finds alerts by medicine or maker (?q= in the URL), alerts newer than
// the person's last visit carry a "New" pill (remembered on this device only), and the list can
// be followed in a feed reader (RSS / Atom) with the same filters.

type Filters = { serious: boolean; peds: boolean; state: string; source: string }
const DEFAULTS: Filters = { serious: false, peds: false, state: '', source: '' }

const STATES = Object.entries(STATE_NAME).sort((a, b) => a[1].localeCompare(b[1]))
const SOURCES = Object.entries(SOURCE_NAME)

const Q_MAX = 100
const DEBOUNCE_MS = 250

function readUrl(): { filters: Filters; q: string } {
  const p = new URLSearchParams(window.location.search)
  const state = p.get('state') ?? ''
  const source = p.get('source') ?? ''
  return {
    filters: {
      serious: p.get('sev') === '4',
      peds: p.get('peds') === '1',
      state: state in STATE_NAME ? state : '',
      source: source in SOURCE_NAME ? source : '',
    },
    q: (p.get('q') ?? '').slice(0, Q_MAX),
  }
}

function writeUrl(f: Filters, q: string) {
  const p = new URLSearchParams()
  if (f.serious) p.set('sev', '4')
  if (f.peds) p.set('peds', '1')
  if (f.state) p.set('state', f.state)
  if (f.source) p.set('source', f.source)
  if (q) p.set('q', q)
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

/** The same test the feed applies to every source, used on search results so filters still count. */
const keeps = (a: Alert, f: Filters) =>
  !a.retraction && (!f.serious || a.severity >= 4) && (!f.peds || a.peds) && (!f.state || a.state === f.state) && (!f.source || a.sourceId === f.source)

type T = (key: MessageKey, vars?: Vars) => string

/** Short names of the filters in use, for the search and RSS notes. State and source names are the regulator's. */
const filterNames = (f: Filters, t: T) =>
  [f.serious && t('feed.serious'), f.peds && t('feed.childOnly'), f.state && t('feed.madeInState', { state: STATE_NAME[f.state] ?? f.state }), f.source && (SOURCE_NAME[f.source] ?? f.source)].filter(
    (x): x is string => !!x,
  )

/** Consecutive alerts from the same month share a heading. */
function groupByMonth(items: Alert[], locale: Locale, t: T) {
  const groups: { key: string; label: string; items: Alert[] }[] = []
  for (const a of items) {
    const label = formatYmLocale(locale, a.alertYm) ?? t('feed.dateNotListed')
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
  const { t } = useT()
  const serious = value >= 4
  return (
    <span
      className={cn(
        'grid size-11 shrink-0 place-items-center content-center gap-0.5 rounded-xl',
        serious ? 'bg-flagged text-white dark:text-background' : 'bg-flagged-soft text-flagged',
      )}
    >
      <span className="font-mono text-base leading-none font-semibold" aria-hidden="true">{value}</span>
      <span className="text-[9px] leading-none font-bold tracking-wider uppercase hi:text-[10px] hi:leading-[1.2]" aria-hidden="true">{t('feed.sev')}</span>
      <span className="sr-only">{t('result.severityOf', { n: value })}</span>
    </span>
  )
}

function FeedRow({ alert, open, onToggle, terms = [], fresh = false }: { alert: Alert; open: boolean; onToggle: () => void; terms?: string[]; fresh?: boolean }) {
  const { t } = useT()
  const made = stateName(alert.state)
  // While searching, say where a match came from when it is not the name or batch on show.
  const maker = terms.length && mentions(alert.manufacturer, terms) ? alert.manufacturer : null
  const generic = terms.length && alert.drug && alert.drug !== alert.brand && mentions(alert.drug, terms) ? alert.drug : null
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
            <Highlight text={alert.brand} terms={terms} />
            {alert.entityKey && (
              <span
                data-live-arkiv
                role="img"
                aria-label={t('feed.liveOnArkiv')}
                title={t('feed.liveOnArkiv')}
                className="ml-1.5 inline-block size-2 rounded-full bg-primary align-middle ring-2 ring-primary/20"
              />
            )}
          </span>
          {alert.peds && (
            <span className="mt-px inline-flex shrink-0 items-center gap-1 rounded-full border border-flagged-border px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-flagged uppercase">
              <Baby className="size-3" aria-hidden="true" /> {t('feed.child')}
            </span>
          )}
          {fresh && (
            <span
              data-new-pill
              className="mt-px inline-flex shrink-0 items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary uppercase ring-1 ring-primary/25 ring-inset dark:bg-primary/15"
            >
              {t('feed.new')}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-foreground/85">
          <span className="font-mono font-semibold">
            <Highlight text={alert.batch} terms={terms} />
          </span>
          <span className="text-muted-foreground"> · {alert.failure}</span>
        </span>
        {(maker || generic) && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground" data-row-match>
            {maker && (
              <>
                <span className="font-medium text-foreground/70">{t('feed.maker')}</span>
                <Highlight text={maker} terms={terms} />
              </>
            )}
            {maker && generic && ' · '}
            {generic && (
              <>
                <span className="font-medium text-foreground/70">{t('feed.contains')}</span>
                <Highlight text={generic} terms={terms} />
              </>
            )}
          </span>
        )}
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          <span className="block truncate sm:inline">{alert.authority}</span>
          <span className="hidden sm:inline"> · </span>
          <span className="block sm:inline">
            {alert.noticeDate}
            {made ? t('feed.rowMadeIn', { state: made }) : ''}
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
  const { t } = useT()
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
    <div ref={ref} id={`alert-${alert.id}`} role="region" aria-label={t('feed.detailsAria', { batch: alert.batch })} className="scroll-mb-28 px-0.5 pt-1 pb-3">
      <ResultCard result={result} onCheck={shell.requestCheck} />
    </div>
  )
}

type Search = SearchAnswer & { q: string }

/** "New since your last visit": the visit's baseline and the saved copy it is compared with. */
function useSeen() {
  // undefined until read on the device; null on a first visit (nothing is new then).
  const [base, setBase] = useState<SeenState | null | undefined>(undefined)
  const [snap, setSnap] = useState<SnapshotIndex | null>(null)
  useEffect(() => {
    let live = true
    setBase(visitBaseline())
    setSnap(currentSnapshot())
    const off = onSnapshot((s) => live && setSnap(s))
    // Shared with the pulse and the shell: no request of its own while one is loaded.
    loadSnapshot().then((s) => live && s && setSnap(s), () => {})
    return () => {
      live = false
      off()
    }
  }, [])
  return { base, setBase, snap }
}

export function Feed() {
  const { t, tp, tr, locale, intl } = useT()
  const plural = (base: PluralKey, n: number) => tp(base, n)
  const [filters, setFilters] = useState<Filters | null>(null)
  const [items, setItems] = useState<Alert[]>([])
  const [page, setPage] = useState<FeedPage | null>(null)
  const [loading, setLoading] = useState<'first' | 'more' | null>('first')
  const [openId, setOpenId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<Search | null>(null)
  const [rssOpen, setRssOpen] = useState(false)
  const ctrlRef = useRef<AbortController | null>(null)
  const { base, setBase, snap } = useSeen()

  useEffect(() => {
    const u = readUrl()
    setFilters(u.filters)
    setText(u.q)
    setQuery(u.q.trim())
  }, [])

  // The search waits for a pause in typing, then the URL and the request follow.
  useEffect(() => {
    const next = text.replace(/\s+/g, ' ').trim()
    if (next === query) return
    const t = setTimeout(() => setQuery(next), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text, query])

  useEffect(() => {
    if (filters) writeUrl(filters, query)
  }, [filters, query])

  useEffect(() => {
    setOpenId(null)
    if (!query) return setSearch(null)
    const ctrl = new AbortController()
    searchAlerts(query, ctrl.signal).then(
      (r) => !ctrl.signal.aborted && setSearch({ ...r, q: query }),
      // searchAlerts falls back to the saved copy and demo data itself; only a cancel rejects.
      (err) => !ctrl.signal.aborted && console.info('Nazar search unavailable', err),
    )
    return () => ctrl.abort()
  }, [query])

  useEffect(() => {
    if (!filters) return
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

  // Whatever this visit has shown counts as seen next time (and clears the nav badge now).
  // The pills on screen keep comparing with the visit's baseline until "Mark all seen".
  const live = page && page.source !== 'demo' ? items : null
  useEffect(() => {
    if (base === undefined) return
    const entries = [...(snap ? snapshotEntries(snap) : []), ...(live ? alertEntries(live) : [])]
    if (entries.length) markSeen(entries)
  }, [base, snap, live])

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
      if (!ctrl?.signal.aborted) toast.error(t('feed.loadMoreFailed'))
    } finally {
      if (!ctrl?.signal.aborted) setLoading(null)
    }
  }

  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...(f ?? DEFAULTS), ...patch }))
  const f = filters ?? DEFAULTS

  // Alerts newer than the visit's baseline, under the current filters: the saved copy (the whole
  // set) plus whatever the live list holds beyond it.
  const fresh = useMemo(() => {
    const out = new Set<string>()
    if (!base) return out
    const q = toQuery(f)
    for (const e of snap ? snapshotEntries(snap, q) : []) if (isNew(base, e)) out.add(e[0])
    for (const e of alertEntries(items)) if (isNew(base, e)) out.add(e[0])
    return out
  }, [base, snap, items, f])
  const isFresh = (a: Alert) => fresh.has(alertKey(a.batch, a.alertYm))
  const markAllSeen = () => setBase(endVisit([...(snap ? snapshotEntries(snap) : []), ...(live ? alertEntries(live) : [])]))

  const searching = query.length > 0
  // While the next answer loads, the last one stays on screen (marked busy) instead of flashing a skeleton.
  const results = searching ? search : null
  const stale = searching && (!search || search.q !== query)
  const shownQ = results?.q ?? query
  const terms = useMemo(() => queryTerms(shownQ), [shownQ])
  const batch = searching ? batchLike(query) : null
  const shown = results ? results.items.filter((a) => keeps(a, f)) : []
  const hidden = results ? results.items.length - shown.length : 0
  const following = filterNames(f, t)

  const first = searching ? !results : loading === 'first'
  const source = searching ? results?.source : page?.source
  const rows = searching ? shown : items
  const saved = source === 'snapshot' ? currentSnapshot() : null
  const savedAt = saved ? saved.generatedAt.toLocaleString(intl, { day: 'numeric', month: locale === 'hi' ? 'long' : 'short', hour: 'numeric', minute: '2-digit' }) : null
  const total = page?.total ?? null
  const count = searching
    ? results && (
        <>
          <span className="font-semibold">{plural('feed.alerts', shown.length)}</span>
          <span className="text-muted-foreground">
            {tp('feed.searchRest', shown.length, { q: shownQ })}
            {results.capped ? t('feed.topMatches') : ''}
          </span>
        </>
      )
    : !first &&
      page && (
        <>
          <span className="font-semibold">{total !== null ? plural('feed.alerts', total) : `${plural('feed.alerts', items.length)}${page.more ? t('feed.soFar') : ''}`}</span>
          <span className="text-muted-foreground">{t('feed.newestFirst')}</span>
        </>
      )
  const onChain = !first && rows.some((a) => a.entityKey)

  return (
    <div className="pt-4 md:pt-8">
      <section className="max-w-2xl">
        <p className="text-[11px] font-bold tracking-[0.18em] text-primary uppercase hi:text-xs">{t('feed.kicker')}</p>
        <h2 className="mt-3 text-[clamp(2rem,6vw,2.75rem)] leading-[1.02] font-semibold tracking-[-0.045em] hi:text-[clamp(1.875rem,5.5vw,2.5rem)] hi:leading-[1.3]">
          {t('feed.heroLead')}
          <span className={cn(locale === 'hi' ? 'font-semibold' : [serif.className, 'pr-1 text-[1.1em] font-normal tracking-normal'], 'text-primary')}>{t('feed.heroAccent')}</span>
        </h2>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground hi:leading-8">
          {t('feed.lede')}
        </p>
        {locale !== 'en' && (
          <p className="mt-2 text-xs leading-5 text-muted-foreground" data-published-as-is>
            {t('note.publishedAsIs')}
          </p>
        )}
      </section>

      <FeedPulse state={f.state} serious={f.serious} peds={f.peds} source={f.source} onState={(state) => update({ state })} />

      <FeedSearchBox
        value={text}
        onChange={(v) => {
          setText(v.slice(0, Q_MAX))
          // Clearing is immediate; typing waits for a pause.
          if (!v.trim()) setQuery('')
        }}
        busy={stale}
      />

      <section aria-label={t('feed.filterAria')} className="mt-3 rounded-2xl border bg-card p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)] md:items-end md:gap-4">
          <div>
            <p className="mb-1.5 hidden text-xs font-semibold text-muted-foreground md:block" aria-hidden="true">{t('feed.severity')}</p>
            <div role="group" aria-label={t('feed.severity')} className="grid h-12 grid-cols-2 overflow-hidden rounded-xl border bg-background">
              {[
                { serious: false, label: t('feed.all') },
                { serious: true, label: t('feed.serious') },
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
            <p className="mb-1.5 hidden text-xs font-semibold text-muted-foreground md:block" aria-hidden="true">{t('feed.children')}</p>
            <button
              aria-pressed={f.peds}
              onClick={() => update({ peds: !f.peds })}
              className={cn(
                'flex h-12 w-full items-center justify-center gap-2 rounded-xl border bg-background px-4 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                f.peds && 'border-primary/50 bg-primary/10 text-primary hover:text-primary',
              )}
            >
              <Baby className="size-4" aria-hidden="true" /> {t('feed.childOnly')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:contents">
            <SelectField id="feed-state" label={t('feed.madeIn')} value={f.state} onChange={(v) => update({ state: v })} all={t('feed.allStates')} options={STATES} />
            <SelectField id="feed-source" label={t('feed.source')} value={f.source} onChange={(v) => update({ source: v })} all={t('feed.allSources')} options={SOURCES} />
          </div>
        </div>
      </section>

      <div className="mt-6 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
        <p className="text-sm" aria-live="polite" aria-atomic="true" data-feed-count>
          {count || <Skeleton className="h-4 w-36" />}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {onChain && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-feed-onchain-key>
              <span className="size-2 rounded-full bg-primary ring-2 ring-primary/20" aria-hidden="true" />
              {t('feed.liveOnArkiv')}
            </span>
          )}
          {source && !first && <SourceTag source={source} />}
          {!isDefault(f) && (
            <Button variant="ghost" className="h-11 px-3" onClick={() => setFilters(DEFAULTS)}>
              <RotateCcw /> {t('feed.reset')}
            </Button>
          )}
          {!searching && <RssToggle open={rssOpen} onToggle={() => setRssOpen((o) => !o)} />}
        </div>
      </div>

      {!searching && rssOpen && <RssPanel filters={toQuery(f)} following={following} />}

      {searching && results && following.length > 0 && (
        <p className="mt-1 px-1 text-xs leading-5 text-muted-foreground" data-feed-search-filters>
          {tr('feed.filtersApply', { list: <span className="font-medium text-foreground">{following.join(' · ')}</span> })}
          {hidden > 0 ? tp('feed.hiddenMatches', hidden) : ''}
        </p>
      )}

      {source === 'snapshot' && !first && (
        <p className="mt-2 rounded-xl bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground" data-feed-saved-copy>
          {searching ? t('feed.savedSearch') : t('feed.savedList')}
          {savedAt ? t('feed.savedAsOf', { time: savedAt }) : ''}
          {t('feed.savedRefresh')}
        </p>
      )}
      {source === 'demo' && !first && (
        <p className="mt-2 rounded-xl bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
          {t('feed.demo')}
        </p>
      )}

      {batch && <CheckBatchOffer batch={batch} className="mt-3" />}

      {!searching && !first && fresh.size > 0 && (
        <div className="mt-3 flex min-h-12 items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.05] py-0.5 pr-1 pl-4 text-sm dark:bg-primary/10" data-feed-new>
          <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 leading-5 sm:flex-none">
            <span className="font-semibold">{plural('feed.newCount', fresh.size)}</span>
            <span className="text-muted-foreground">{t('feed.sinceVisit')}</span>
            <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
              {' '}
              ·
            </span>
          </span>
          <button
            type="button"
            onClick={markAllSeen}
            data-feed-mark-seen
            className="min-h-11 shrink-0 rounded-lg px-3 font-semibold whitespace-nowrap text-primary underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t('feed.markSeen')}
          </button>
        </div>
      )}

      <div
        className={cn('mt-3 rounded-2xl border bg-card px-2 py-2 transition-opacity sm:px-3', stale && !first && 'opacity-60')}
        aria-busy={first || stale}
        data-feed
        data-feed-mode={searching ? 'search' : 'list'}
        data-feed-source={first ? undefined : source}
      >
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

        {!first && rows.length === 0 && !searching && (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Rings className="size-24"><Search /></Rings>
            <p className="mt-4 font-semibold">{t('feed.emptyTitle')}</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('feed.emptyHint')}</p>
            {!isDefault(f) && (
              <Button variant="outline" className="mt-5 h-11" onClick={() => setFilters(DEFAULTS)}>
                <RotateCcw /> {t('feed.reset')}
              </Button>
            )}
          </div>
        )}

        {!first && rows.length === 0 && searching && (
          <div className="flex flex-col items-center px-6 py-12 text-center" data-feed-search-empty>
            <Rings className="size-24"><Search /></Rings>
            {hidden > 0 ? (
              <>
                <p className="mt-4 font-semibold">
                  {tp('feed.hiddenTitle', hidden, { q: shownQ })}
                </p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('feed.hiddenHint')}</p>
                <Button variant="outline" className="mt-5 h-11" onClick={() => setFilters(DEFAULTS)}>
                  <RotateCcw /> {t('feed.reset')}
                </Button>
              </>
            ) : (
              <>
                <p className="mt-4 max-w-sm font-semibold text-balance">{t('feed.noneTitle', { q: shownQ })}</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t('feed.noneHint')}</p>
              </>
            )}
          </div>
        )}

        {!first &&
          groupByMonth(rows, locale, t).map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h3 className="px-2.5 pt-3 pb-1 text-[11px] font-bold tracking-[0.16em] text-muted-foreground uppercase sm:px-3 hi:text-xs">{g.label}</h3>
              <ul className="divide-y divide-border/70">
                {g.items.map((a) => (
                  <li key={a.id}>
                    <FeedRow
                      alert={a}
                      open={openId === a.id}
                      onToggle={() => setOpenId((id) => (id === a.id ? null : a.id))}
                      terms={searching ? terms : undefined}
                      fresh={isFresh(a)}
                    />
                    {openId === a.id && source && <FeedDetail alert={a} source={source} />}
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>

      {!first && !searching && items.length > 0 && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {page?.more ? (
            <Button variant="outline" className="h-12 w-full max-w-sm text-sm font-semibold" onClick={loadMore} aria-busy={loading === 'more'} disabled={loading === 'more'}>
              {loading === 'more' ? (
                <>
                  {t('feed.loading')} <LoaderCircle data-icon="inline-end" className="animate-spin motion-reduce:animate-none" />
                </>
              ) : (
                t('feed.loadMore')
              )}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t('feed.end')}</p>
          )}
          {page?.more && (
            <p className="text-xs text-muted-foreground">
              {total !== null
                ? t('feed.showingOf', { n: items.length.toLocaleString(intl), total: total.toLocaleString(intl) })
                : t('feed.showing', { n: items.length.toLocaleString(intl) })}
            </p>
          )}
        </div>
      )}
      {!first && searching && results?.capped && (
        <p className="mt-4 text-center text-xs text-muted-foreground">{t('feed.cappedHint')}</p>
      )}
    </div>
  )
}
