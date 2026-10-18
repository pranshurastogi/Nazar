'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { MotionConfig, motion } from 'motion/react'
import { RefreshCw, RotateCcw, Search, X } from 'lucide-react'

import type { SentinelState } from '@/components/ui/sentinel-core'
import { scheduleSnapshot } from '@/lib/source/snapshot'
import { formatAsOfIn, useT } from '@/lib/i18n'
import { siteOrigin } from '@/lib/share'
import {
  alertOf,
  cantTell,
  countItems,
  itemsFor,
  itemState,
  parseList,
  runSweep,
  SAMPLE,
  sortItems,
  suggestionOf,
  type SweepItem,
  type SweepProgress,
} from '@/lib/sweep'
import { cn } from '@/lib/utils'
import { ExportMenu } from './export-menu'
import { SweepHero } from './hero'
import { InputPanel } from './input-panel'
import { PrintSheet } from './print-sheet'
import { ResultsList } from './results'
import { useWide } from './shared'
import { SummaryChips, SweepProgressBar, type Filter } from './summary'

/** Shelf sweep: paste or upload a stock list, check every batch at once, export the answers. */
export function SweepPage() {
  const { t, tp, locale } = useT()
  const istText = (d: Date) => formatAsOfIn(locale, d, true)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const parsed = useMemo(() => parseList(text), [text])
  const [items, setItems] = useState<SweepItem[] | null>(null)
  const [progress, setProgress] = useState<SweepProgress | null>(null)
  const [startedAt, setStartedAt] = useState<Date | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const ctrlRef = useRef<AbortController | null>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const wide = useWide()

  // Warm the on-device snapshot while the list is being pasted, so the sweep answers at once.
  useEffect(() => {
    scheduleSnapshot()
    return () => ctrlRef.current?.abort()
  }, [])

  const run = useCallback((list: SweepItem[], only?: Set<string>) => {
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    runSweep(
      list,
      {
        onItems: (next) => !ctrl.signal.aborted && setItems(next),
        onProgress: (p) => !ctrl.signal.aborted && setProgress(p),
      },
      ctrl.signal,
      only,
    ).catch(() => {})
  }, [])

  const start = useCallback(
    (source = text) => {
      const p = parseList(source)
      if (!p.rows.length && !p.unreadable.length) return
      const list = itemsFor(p)
      setItems(list)
      setStartedAt(new Date())
      setFilter('all')
      setQuery('')
      run(list)
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))
    },
    [run, text],
  )

  const reset = () => {
    ctrlRef.current?.abort()
    setItems(null)
    setProgress(null)
    setStartedAt(null)
    setText('')
    setFileName(null)
    requestAnimationFrame(() => document.getElementById('sweep-input')?.focus())
  }

  const busy = !!progress && progress.phase !== 'done'
  const counts = useMemo(() => countItems(items ?? []), [items])
  const sorted = useMemo(() => (items ? sortItems(items) : []), [items])
  const unchecked = useMemo(() => (items ?? []).filter((i) => cantTell(i) === 'unchecked'), [items])
  const shown = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    return sorted.filter((i) => {
      if (filter !== 'all' && itemState(i) !== filter) return false
      if (!q) return true
      const a = alertOf(i)
      return [i.batch, i.raw, i.product, a?.brand, a?.authority, a?.manufacturer, suggestionOf(i)].some((v) => v?.toLowerCase().includes(q))
    })
  }, [sorted, filter, deferredQuery])

  const eye: SentinelState = !items ? 'idle' : busy ? 'scanning' : counts.flagged ? 'flagged' : counts.retracted ? 'retracted' : counts.unreadable ? 'unreadable' : 'no_alert'
  const origin = typeof window === 'undefined' ? '' : siteOrigin()

  return (
    <MotionConfig reducedMotion="user">
      <div data-sweep data-sweep-phase={progress?.phase ?? 'idle'}>
        <div data-sweep-screen>
          <SweepHero eye={eye} />
        </div>
        <InputPanel
          text={text}
          onText={setText}
          fileName={fileName}
          onFile={(name, t) => {
            setFileName(name)
            setText(t)
          }}
          parsed={parsed}
          busy={busy}
          onCheck={() => start()}
          onSample={() => {
            setFileName(null)
            setText(SAMPLE)
            start(SAMPLE)
          }}
        />

        {items && (
          <motion.section
            ref={resultsRef}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="mt-10 scroll-mt-6"
            aria-labelledby="sweep-results-title"
            aria-busy={busy}
            data-sweep-screen
            data-sweep-results
          >
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
              <div className="min-w-0">
                <h2 id="sweep-results-title" className="text-2xl font-semibold tracking-[-0.03em]">
                  {tp('sweep.rowsChecked', counts.total)}
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground" data-sweep-meta>
                  {startedAt && t('sweep.checkedAt', { time: istText(startedAt) })}
                  {progress?.via === 'snapshot' && progress.snapshotAt && t('sweep.viaSnapshot', { time: istText(progress.snapshotAt) })}
                  {progress?.via === 'api' && t('sweep.viaApi')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ExportMenu items={items} flagged={counts.flagged} disabled={busy} />
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  data-sweep-reset
                >
                  <RotateCcw className="size-4" aria-hidden="true" /> {t('sweep.newSweep')}
                </button>
              </div>
            </div>

            {progress && progress.phase !== 'done' && (
              <div className="mt-4">
                <SweepProgressBar p={progress} />
              </div>
            )}

            <div className="mt-4">
              <SummaryChips counts={counts} filter={filter} onFilter={setFilter} />
            </div>

            {!busy && unchecked.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-caution-border bg-caution-soft px-4 py-2 text-sm text-caution" data-sweep-unchecked>
                <span className="font-medium">{tp('sweep.uncheckedCount', unchecked.length)}</span>
                <button
                  type="button"
                  onClick={() => run(items, new Set(unchecked.map((i) => i.id)))}
                  className="-my-1 inline-flex min-h-11 items-center gap-1.5 font-semibold underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  data-sweep-retry
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" /> {t('sweep.tryAgain')}
                </button>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="relative min-w-0 basis-full sm:max-w-sm sm:flex-1 sm:basis-auto">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('sweep.searchPlaceholder')}
                  aria-label={t('sweep.searchAria')}
                  className="h-11 w-full rounded-xl border bg-background pr-3 pl-10 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                  data-sweep-search
                />
              </div>
              <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite" data-sweep-shown>
                {filter !== 'all' || deferredQuery.trim() ? t('sweep.showingOf', { n: shown.length, total: counts.total }) : t('sweep.flaggedFirst')}
                {filter !== 'all' && (
                  <button type="button" onClick={() => setFilter('all')} className="-my-3 ml-2 inline-flex min-h-11 items-center gap-1 font-medium text-foreground hover:underline">
                    <X className="size-3.5" aria-hidden="true" /> {t('sweep.showAll')}
                  </button>
                )}
              </p>
            </div>

            <div className={cn('mt-3', busy && progress?.phase === 'loading' && 'opacity-60')}>
              <ResultsList items={shown} wide={wide} query={deferredQuery.trim()} />
            </div>

            <p className="mt-4 max-w-[70ch] text-xs leading-5 text-muted-foreground" data-sweep-footnote>
              {t('sweep.footnote')}
            </p>
          </motion.section>
        )}

        {items && startedAt && <PrintSheet items={sorted} counts={counts} at={startedAt} snapshotAt={progress?.snapshotAt ?? null} origin={origin} />}
      </div>
    </MotionConfig>
  )
}
