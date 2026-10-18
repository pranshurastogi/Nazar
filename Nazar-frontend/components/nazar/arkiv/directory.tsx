'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDown, Bell, FileText } from 'lucide-react'

import { API_URL } from '@/lib/source'
import {
  activeFilters,
  apiEntities,
  apiSummary,
  browserEntities,
  DirectoryReadError,
  EMPTY_FILTERS,
  filterCount,
  filtersFromSearch,
  filtersToSearch,
  PAGE_SIZE,
  predicates,
  queryString,
  sdkSnippet,
  type ArkivSummary,
  type DirectoryEntity,
  type DirectoryFilters,
  type DirectoryPage,
  type DirectoryType,
} from '@/lib/source/directory'
import { SUMMARY_KEY } from '@/lib/source/prefetch'
import { peek, put, revalidate } from '@/lib/source/swr'
import { cn } from '@/lib/utils'
import { ArkivHero } from './arkiv-hero'
import { EntityDrawer } from './entity-drawer'
import { FilterPanel } from './filters'
import { DirectoryHeader, Overview, type SummaryState } from './overview'
import { QueryPanel, type RunMode } from './query-panel'
import { Results, type ResultsState } from './results'
import { blk, nf } from './shared'

// /arkiv: a structured explorer of Nazar's on-chain data. Filters live in the URL; the query
// they produce is shown live; results come from the Nazar API or straight from Arkiv in the
// browser, paged with cursors pinned to the first page's block.

const TABS: { type: DirectoryType; label: string; Icon: typeof Bell }[] = [
  { type: 'alert', label: 'Alerts', Icon: Bell },
  { type: 'notice', label: 'Notices', Icon: FileText },
  { type: 'heartbeat', label: 'Heartbeat', Icon: Activity },
]

const asReadError = (err: unknown) =>
  err instanceof DirectoryReadError ? err : new DirectoryReadError(err instanceof Error ? err.message : 'Unknown error', 'unavailable')

export function ArkivDirectory() {
  const [filters, setFilters] = useState<DirectoryFilters>(EMPTY_FILTERS)
  const [mode, setMode] = useState<RunMode>(API_URL ? 'api' : 'browser')
  const [ready, setReady] = useState(false)
  const [summary, setSummary] = useState<SummaryState>({ kind: 'loading' })
  const [results, setResults] = useState<ResultsState>({ kind: 'loading' })
  const [meta, setMeta] = useState<string | null>(null)
  const [selected, setSelected] = useState<DirectoryEntity | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [autoSwitched, setAutoSwitched] = useState(false)
  const [reload, setReload] = useState(0)
  const req = useRef(0)
  /** The row whose drawer is open, so closing it (Esc, Close, backdrop) puts focus back there. */
  const opener = useRef<string | null>(null)
  const recount = useRef(false)

  // Filters and mode come from the URL once, on the client.
  useEffect(() => {
    setFilters(filtersFromSearch(window.location.search))
    if (new URLSearchParams(window.location.search).get('via') === 'browser') setMode('browser')
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const qs = filtersToSearch(filters, { via: mode === 'browser' ? 'browser' : '' })
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [filters, mode, ready])

  const loadSummary = useCallback((signal?: AbortSignal, force = false) => {
    // Last counts first (back/forward, reloads), then the fresh read; Refresh skips the shared copy.
    const cached = peek<ArkivSummary>(SUMMARY_KEY)
    setSummary((s) => (s.kind === 'ok' ? s : cached ? { kind: 'ok', data: cached.value, fetchedAt: cached.at } : { kind: 'loading' }))
    ;(force ? apiSummary(signal).then((d) => (put(SUMMARY_KEY, d), d)) : revalidate(SUMMARY_KEY, () => apiSummary())).then(
      (data) => {
        if (signal?.aborted) return
        setSummary({ kind: 'ok', data, fetchedAt: Date.now() })
        // The API recounts in the background when it hands back old counts; pick the new ones up once.
        if (data.stale && !data.error && !recount.current) {
          recount.current = true
          setTimeout(() => {
            if (signal?.aborted) return
            apiSummary(signal).then(
              (d) => !signal?.aborted && !d.stale && (put(SUMMARY_KEY, d), setSummary({ kind: 'ok', data: d, fetchedAt: Date.now() })),
              () => {},
            )
          }, 8000)
        }
      },
      (err) => {
        if (signal?.aborted) return
        const e = asReadError(err)
        setSummary((s) => (s.kind === 'ok' ? { ...s, data: { ...s.data, stale: true, error: e.message } } : { kind: 'error', message: e.message, throttled: e.kind === 'throttled', noApi: e.kind === 'no-api' }))
      },
    )
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    loadSummary(ctrl.signal)
    return () => ctrl.abort()
  }, [loadSummary])

  const active = useMemo(() => activeFilters(filters), [filters])
  const preds = useMemo(() => predicates(active), [active])
  const query = useMemo(() => queryString(active.type, preds), [active.type, preds])
  const sdk = useMemo(() => sdkSnippet(active.type, preds, PAGE_SIZE), [active.type, preds])
  const key = useMemo(() => filtersToSearch(active), [active])

  const read = useCallback(
    (page?: { cursor: string; block: string }, signal?: AbortSignal): Promise<DirectoryPage> =>
      mode === 'api' ? apiEntities(active, page, signal) : browserEntities(active, page, signal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, key],
  )

  // First page: debounced, so typing a batch number does not send a query per keystroke.
  useEffect(() => {
    if (!ready) return
    const id = ++req.current
    const ctrl = new AbortController()
    setResults({ kind: 'loading' })
    const t = setTimeout(() => {
      const t0 = performance.now()
      read(undefined, ctrl.signal).then(
        (p) => {
          if (id !== req.current) return
          setResults({ kind: 'ok', items: p.items, cursor: p.cursor, block: p.block, more: 'idle' })
          setMeta(`${mode === 'api' ? 'Via Nazar API' : 'Direct from Arkiv'} · block ${blk(p.block)} · ${p.items.length} ${p.items.length === 1 ? 'entity' : 'entities'} · ${Math.round(performance.now() - t0)} ms`)
        },
        (err) => {
          if (id !== req.current || ctrl.signal.aborted) return
          const e = asReadError(err)
          // No API in this build, or it is unreachable: read Arkiv directly instead, once, and say so.
          if (mode === 'api' && (e.kind === 'no-api' || e.kind === 'unavailable') && !autoSwitched) {
            setAutoSwitched(true)
            setMode('browser')
            return
          }
          setResults({ kind: 'error', error: e })
          setMeta(null)
        },
      )
    }, 300)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [read, ready, reload, mode, autoSwitched])

  const loadMore = () => {
    if (results.kind !== 'ok' || !results.cursor) return
    const id = req.current
    const { cursor, block } = results
    setResults({ ...results, more: 'loading' })
    read({ cursor, block }).then(
      (p) => {
        if (id !== req.current) return
        setResults((r) => (r.kind === 'ok' ? { ...r, items: [...r.items, ...p.items], cursor: p.cursor, more: 'idle' } : r))
      },
      (err) => {
        if (id !== req.current) return
        const e = asReadError(err)
        setResults((r) => (e.kind === 'expired' ? { kind: 'error', error: e } : r.kind === 'ok' ? { ...r, more: 'error' } : r))
      },
    )
  }

  const apply = useCallback((patch: Partial<DirectoryFilters>) => {
    setFilters((f) => {
      // Switching type starts that type's filters fresh; applying a breakdown keeps the rest.
      if (patch.type && patch.type !== f.type) return { ...EMPTY_FILTERS, ...patch }
      return { ...f, ...patch }
    })
  }, [])

  const reset = () => setFilters({ ...EMPTY_FILTERS, type: filters.type })
  const showNoticeAlerts = (noticeKey: string) => {
    setDrawerOpen(false)
    setFilters({ ...EMPTY_FILTERS, type: 'alert', notice: noticeKey })
    document.getElementById('arkiv-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const summarySources = summary.kind === 'ok' ? Object.keys(summary.data.alerts.bySrc) : []
  const block = results.kind === 'ok' ? results.block : null

  return (
    <div className="space-y-4" data-arkiv-directory>
      <ArkivHero />
      <DirectoryHeader summary={summary} block={block} onRefresh={() => loadSummary(undefined, true)} />

      {/* On phones the entities sit below the overview; one tap gets there. */}
      <a
        href="#arkiv-results"
        className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border bg-card px-4 text-sm font-semibold text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:hidden"
        data-jump-entities
      >
        Jump to the entities <ArrowDown className="size-4" aria-hidden="true" />
      </a>

      <Overview summary={summary} filters={filters} onApply={apply} />
      <div id="arkiv-query" className="scroll-mt-6">
        <QueryPanel query={query} sdk={sdk} mode={mode} onMode={(m) => setMode(m)} apiAvailable={!!API_URL} meta={meta} />
      </div>

      {autoSwitched && mode === 'browser' && (
        <p className="rounded-xl border bg-muted/50 px-3.5 py-2.5 text-[13px] text-muted-foreground" data-auto-browser>
          The Nazar API did not answer, so this page is reading Arkiv straight from your browser. Same data, no Nazar server needed.
        </p>
      )}

      <div role="tablist" aria-label="Entity type" className="flex gap-1 overflow-x-auto rounded-2xl border bg-card p-1.5" data-type-tabs>
        {TABS.map(({ type, label, Icon }) => {
          const on = filters.type === type
          const n = summary.kind === 'ok' ? summary.data.entities[type] : undefined
          return (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={on}
              data-type-tab={type}
              onClick={() => apply({ type })}
              className={cn(
                'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                on && 'bg-primary/10 text-primary hover:text-primary',
              )}
            >
              <Icon className="size-4" aria-hidden="true" /> {label}
              {n !== undefined && <span className={cn('font-mono text-xs font-medium', on ? 'text-primary' : 'text-muted-foreground')}>{nf(n)}</span>}
            </button>
          )
        })}
      </div>

      <div id="arkiv-results" className="grid scroll-mt-6 items-start gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="xl:sticky xl:top-4">
          <FilterPanel filters={filters} onApply={apply} onReset={reset} sources={summarySources} />
        </div>
        <Results
          state={results}
          type={active.type}
          filtered={filterCount(filters) > 0}
          onOpen={(e) => {
            opener.current = e.key
            setSelected(e)
            setDrawerOpen(true)
          }}
          onMore={loadMore}
          onRetry={() => setReload((n) => n + 1)}
          onReset={reset}
          onBrowser={mode === 'api' ? () => setMode('browser') : null}
          onNoticeAlerts={showNoticeAlerts}
        />
      </div>

      <EntityDrawer
        entity={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onNoticeAlerts={showNoticeAlerts}
        returnFocus={() => (opener.current ? document.querySelector<HTMLElement>(`[data-entity-row="${CSS.escape(opener.current)}"] button`) : null)}
      />
    </div>
  )
}
