'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Baby,
  ChevronRight,
  CircleHelp,
  FileSpreadsheet,
  History,
  LoaderCircle,
  ScanLine,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { SentinelEye } from '@/components/ui/sentinel-core'
import { soon, useShell } from '@/components/nazar/app-shell'
import { CheckingCard } from '@/components/nazar/checking-card'
import { ResultCard, SourceTag } from '@/components/nazar/result-card'
import { Rings } from '@/components/nazar/rings'
import { Scanner } from '@/components/nazar/scanner/scanner'
import type { PackLabel } from '@/lib/scan/pack'
import { checkBatch, type AlertFeed, type CheckResult, type ResultState, type Stage } from '@/lib/source'
import { HOME_KEYS, loadChild, loadSevere, notDemo } from '@/lib/source/prefetch'
import { peek, revalidate } from '@/lib/source/swr'
import { serif } from '@/lib/fonts'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const RECENT_KEY = 'nazar:recent'
type Recent = { batch: string; name: string; state: ResultState }

// Labels come from the dictionary (state.flagged …), so the chip words match the result card.
const STATE_STYLE: Record<ResultState, { icon: typeof Search; cls: string }> = {
  flagged: { icon: TriangleAlert, cls: 'bg-flagged-soft text-flagged' },
  retracted: { icon: History, cls: 'bg-caution-soft text-caution' },
  no_alert: { icon: Search, cls: 'bg-quiet-soft text-quiet' },
  unreadable: { icon: CircleHelp, cls: 'bg-caution-soft text-caution' },
}

/** Answers faster than this skip the loading card, so quick checks do not flicker. */
const PENDING_DELAY_MS = 120

function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded bg-muted motion-reduce:animate-none', className)} />
}

/** Longest value read from a deep link; real batch numbers are at most 24 characters. */
const DEEP_LINK_MAX = 40

/**
 * Runs the check named by a deep link (/?batch=SR-13 or /?b=SR-13) once, then drops the
 * parameter so a reload or a later check does not repeat it. Sits in its own Suspense
 * boundary because useSearchParams needs one in a prerendered page.
 */
function DeepLinkCheck({ onBatch }: { onBatch: (batch: string) => void }) {
  const params = useSearchParams()
  const value = (params.get('batch') ?? params.get('b') ?? '').trim().slice(0, DEEP_LINK_MAX)
  const done = useRef<string | null>(null)
  useEffect(() => {
    if (!value || done.current === value) return
    done.current = value
    onBatch(value)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('batch')
      url.searchParams.delete('b')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    } catch {}
  }, [value, onBatch])
  return null
}

export default function Page() {
  const { t, tr, locale } = useT()
  const hi = locale === 'hi'
  const [batch, setBatch] = useState('')
  const [result, setResult] = useState<CheckResult | null>(null)
  const [pending, setPending] = useState<{ batch: string; stage: Stage } | null>(null)
  /** True while an instant snapshot answer is on screen and the live check is still running. */
  const [confirming, setConfirming] = useState(false)
  const [feed, setFeed] = useState<AlertFeed | null>(null)
  const [childFeed, setChildFeed] = useState<AlertFeed | null>(null)
  const checkRef = useRef<AbortController | null>(null)
  const [recent, setRecent] = useState<Recent[]>([])
  const shell = useShell()
  const inputRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [pack, setPack] = useState<PackLabel | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  /** Set when "Check batch" is pressed with an empty box; cleared as soon as something is typed. */
  const [emptyHint, setEmptyHint] = useState(false)

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'))
    } catch {}
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    const quiet = (err: unknown) => {
      if (!ctrl.signal.aborted) console.info('Nazar source unavailable', err)
    }
    // Lead with the most dangerous: severity 4-5 (spurious, toxic glycol, sterility, injectables).
    // The last answer paints at once (back/forward, reloads); a background refresh replaces it.
    const severe = peek<AlertFeed>(HOME_KEYS.severe)
    const child = peek<AlertFeed>(HOME_KEYS.child)
    if (severe) setFeed(severe.value)
    if (child) setChildFeed(child.value)
    revalidate(HOME_KEYS.severe, loadSevere, { keep: notDemo }).then((f) => !ctrl.signal.aborted && setFeed(f), quiet)
    revalidate(HOME_KEYS.child, loadChild, { keep: notDemo }).then((f) => !ctrl.signal.aborted && setChildFeed(f), quiet)
    return () => ctrl.abort()
  }, [])

  const runCheck = async (value = batch, label?: PackLabel) => {
    // A typed check has no label; a scan carries the label it read, for "About this medicine".
    setPack(label ?? null)
    if (!value.trim()) {
      setEmptyHint(true)
      inputRef.current?.focus()
      return
    }
    setEmptyHint(false)
    checkRef.current?.abort()
    const ctrl = new AbortController()
    checkRef.current = ctrl
    const shown = value.trim().toUpperCase()
    let stage: Stage = 'api'
    let instant = false
    setBatch(shown)
    setConfirming(false)
    const timer = setTimeout(() => {
      if (ctrl.signal.aborted || instant) return
      setResult(null)
      setPending({ batch: shown, stage })
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
    }, PENDING_DELAY_MS)
    try {
      const r = await checkBatch(value, {
        signal: ctrl.signal,
        // The on-device snapshot answers at once; the live answer below confirms or corrects it.
        onInstant: (snap) => {
          if (ctrl.signal.aborted) return
          instant = true
          clearTimeout(timer)
          setPending(null)
          setBatch(snap.batch)
          setResult(snap)
          setConfirming(true)
          requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
        },
        onStage: (s) => {
          stage = s
          if (!ctrl.signal.aborted && !instant) setPending((p) => (p ? { ...p, stage: s } : p))
        },
      })
      if (ctrl.signal.aborted) return
      setBatch(r.batch)
      setResult(r)
      if (r.state !== 'unreadable') {
        const entry: Recent = { batch: r.batch, name: 'alert' in r ? r.alert.brand : 'Batch check', state: r.state }
        setRecent((prev) => {
          const next = [entry, ...prev.filter((x) => x.batch !== r.batch)].slice(0, 6)
          try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(next))
          } catch {}
          return next
        })
      }
      if (!instant) requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
    } catch {
      if (ctrl.signal.aborted) return
      // The instant answer stays on screen; only say so when there is nothing to show.
      if (!instant) toast.error(t('check.failed'))
    } finally {
      clearTimeout(timer)
      if (checkRef.current === ctrl) {
        setConfirming(false)
        setPending(null)
        checkRef.current = null
      }
    }
  }

  // The guide and other tabs ask for checks through the shell; always run the latest closure.
  const runRef = useRef(runCheck)
  runRef.current = runCheck
  useEffect(() => {
    shell.registerCheck((b) => runRef.current(b))
    const waiting = shell.takePendingCheck()
    if (waiting) runRef.current(waiting)
    return () => shell.registerCheck(null)
  }, [shell])

  // Stable for the deep-link effect; always runs the latest check closure.
  const runDeepLink = useCallback((b: string) => runRef.current(b), [])

  const clearRecent = () => {
    setRecent([])
    try {
      localStorage.removeItem(RECENT_KEY)
    } catch {}
  }

  return (
    <>
        <section className="grid grid-cols-1 items-center gap-8 pt-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:pt-14">
          <div className="max-w-lg">
            {/* The eye mirrors the check: it watches the batch box, scans while checking, and takes the result's colour. */}
            <div className="flex items-center justify-between gap-4 md:flex-col-reverse md:items-start md:justify-start">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary hi:text-xs" data-tagline>{t('check.tagline')}</p>
              <SentinelEye
                state={pending ? 'checking' : scanning ? 'scanning' : (result?.state ?? 'idle')}
                lookAt={inputRef}
                className="w-24 shrink-0 md:w-44"
              />
            </div>
            {/* Hindi: Devanagari needs taller lines, and the italic serif has no Devanagari, so the accent
                phrase keeps the sans face and carries the emphasis in colour and weight. */}
            <h1 className="mt-3 text-[clamp(2.5rem,8vw,3.25rem)] md:text-[2.5rem] xl:text-[3.25rem] font-semibold leading-[0.98] tracking-[-0.05em] hi:text-[clamp(2.125rem,7vw,2.75rem)] hi:leading-[1.3] md:hi:text-[2.25rem] xl:hi:text-[2.75rem]" data-check-hero>
              {t('check.heroLine1')}
              <br />
              <span className={cn(hi ? 'font-semibold' : [serif.className, 'pr-1 text-[1.12em] font-normal tracking-[-0.01em]'], 'text-primary')}>{t('check.heroLine2')}</span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground hi:leading-8">
              {t('check.lede')}
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between">
              <label htmlFor="batch" className="text-sm font-semibold">{t('check.label')}</label>
              <span className="text-xs text-muted-foreground">
                {tr('check.lookFor', { code: <span className="font-mono">B.No.</span> })}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-xl border bg-background px-4 transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/60">
              <Search className="size-5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                id="batch"
                value={batch}
                onChange={(e) => {
                  setBatch(e.target.value.toUpperCase())
                  if (emptyHint) setEmptyHint(false)
                }}
                onKeyDown={(e) => e.key === 'Enter' && runCheck()}
                onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                placeholder={t('check.placeholder')}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="search"
                aria-invalid={emptyHint || undefined}
                aria-describedby={emptyHint ? 'batch-empty' : undefined}
                className="h-14 min-w-0 flex-1 bg-transparent font-mono text-xl tracking-wider uppercase outline-none focus-visible:outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:normal-case placeholder:text-muted-foreground"
              />
              {batch && (
                <button
                  onClick={() => {
                    checkRef.current?.abort()
                    checkRef.current = null
                    setPending(null)
                    setConfirming(false)
                    setBatch('')
                    setResult(null)
                    inputRef.current?.focus()
                  }}
                  className="grid size-10 place-items-center text-muted-foreground"
                  aria-label={t('check.clear')}
                >
                  <X className="size-5" />
                </button>
              )}
            </div>
            {/* Always mounted, so screen readers announce the message when it appears. */}
            <p id="batch-empty" role="status" className={cn('text-sm font-medium text-caution', emptyHint && 'mt-2')} data-empty-hint={emptyHint ? 'shown' : 'hidden'}>
              {emptyHint ? t('check.empty') : ''}
            </p>
            <div className="mt-4 flex gap-3">
              <Button className="h-13 flex-1 rounded-xl text-base font-semibold" onClick={() => runCheck()} aria-busy={!!pending}>
                {pending ? (
                  <>
                    {t('check.checking')} <LoaderCircle data-icon="inline-end" className="animate-spin motion-reduce:animate-none" />
                  </>
                ) : (
                  <>
                    {t('check.submit')} <ArrowRight data-icon="inline-end" />
                  </>
                )}
              </Button>
              <Button variant="outline" className="size-13 rounded-xl text-primary" aria-label={t('check.scan')} onClick={() => setScanning(true)} aria-haspopup="dialog">
                <ScanLine className="size-5" />
              </Button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span>{t('check.try')}</span>
              {/* The button is a 44px tap target; the pill inside keeps the chip visually small. */}
              {['SR-13', 'TG25-2281A', 'AB1234', '5R-13'].map((b) => (
                <button key={b} onClick={() => runCheck(b)} data-try-chip className="group inline-flex min-h-11 items-center rounded-full font-mono font-medium text-foreground focus-visible:outline-none">
                  <span className="rounded-full border px-2.5 py-1.5 transition-colors group-hover:bg-muted group-focus-visible:ring-3 group-focus-visible:ring-ring/50">{b}</span>
                </button>
              ))}
              <span className="ml-auto hidden lg:inline">
                {tr('check.focusKey', { key: <kbd className="rounded border px-1.5 font-mono">/</kbd> })}
              </span>
            </div>
            <Link
              href="/sweep"
              className="-mb-2 inline-flex min-h-11 items-center gap-1 rounded-md text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              data-sweep-link
            >
              {t('check.sweepLink')} <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </section>

        <div ref={resultRef} className="scroll-mb-28 scroll-mt-6">
          {pending ? (
            <div className="mt-8"><CheckingCard batch={pending.batch} stage={pending.stage} /></div>
          ) : (
            result && (
              // The confirming badge floats over the card, so the live answer never moves the layout.
              <div className="relative mt-8" data-confirming={confirming ? 'true' : 'false'}>
                <ResultCard key={result.batch} result={result} onCheck={(b) => runCheck(b)} pack={pack} />
                {/* Cross-fades out when the live answer lands; MotionConfig makes it instant under reduced motion. */}
                <MotionConfig reducedMotion="user">
                  <AnimatePresence initial={false}>
                    {confirming && (
                      <motion.span
                        key="confirming"
                        role="status"
                        initial={{ opacity: 0, y: 2 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -2 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="pointer-events-none absolute -top-3 right-4 z-10 inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm"
                      >
                        <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        {t('check.confirming')}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </MotionConfig>
              </div>
            )
          )}
        </div>

        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('check.noticesKicker')}</p>
                <h3 className="mt-1 text-lg font-semibold tracking-tight">{t('check.severeTitle')}</h3>
              </div>
              <Badge variant="secondary" className="h-6 min-w-16 px-2.5" aria-busy={!feed}>
                {feed ? t('check.active', { n: feed.total }) : <Skeleton className="h-3 w-10" />}
              </Badge>
            </div>
            <ul className="mt-4 min-h-[10.5rem] divide-y" aria-busy={!feed} aria-label={t('check.severeTitle')}>
              {!feed &&
                [0, 1, 2].map((i) => (
                  <li key={i} className="flex min-h-14 items-center gap-3 py-2.5">
                    <Skeleton className="size-9 rounded-lg" />
                    <span className="grid flex-1 gap-1.5">
                      <Skeleton className="h-3.5 w-2/5" />
                      <Skeleton className="h-3 w-3/4" />
                    </span>
                  </li>
                ))}
              {feed?.items.length === 0 && (
                <li className="py-6 text-sm text-muted-foreground">{t('check.noneActive')}</li>
              )}
              {feed?.items.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <button onClick={() => runCheck(a.batch)} className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-flagged-soft text-flagged"><TriangleAlert className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{a.brand}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="font-mono">{a.batch}</span> · {a.authority} · {a.noticeDate}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex min-h-11 items-center justify-between gap-3">
              {feed ? <SourceTag source={feed.source} /> : <span />}
              <Link href="/feed?sev=4" className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 px-3 text-primary')}>
                {t('check.seeAll')} <ArrowRight data-icon="inline-end" />
              </Link>
            </div>
          </div>

          <div className="flex flex-col rounded-2xl border bg-card p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Baby className="size-5" /></span>
              <div>
                <h3 className="font-semibold">{t('check.childTitle')}</h3>
                <p className="text-xs text-muted-foreground">{t('check.childSub')}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {t('check.childBody')}{' '}
              {childFeed ? (
                <span className="font-semibold text-foreground">{t('check.childActive', { n: childFeed.total })}</span>
              ) : (
                <Skeleton className="inline-block h-3.5 w-28 align-middle" />
              )}
            </p>
            {/* Beside the alerts list (md+), the latest children's alerts fill the card instead of empty space. */}
            {!!childFeed?.items.length && (
              <ul className="mt-4 hidden divide-y rounded-xl border md:block" aria-label={t('check.childListAria')} data-child-list>
                {childFeed.items.slice(0, 3).map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => runCheck(a.batch)}
                      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{a.brand}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          <span className="font-mono">{a.batch}</span> · {a.form} · {a.authority}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
              <Button
                variant="outline"
                className="h-11"
                disabled={!childFeed?.items.length}
                onClick={() => childFeed?.items[0] && runCheck(childFeed.items[0].batch)}
              >
                {t('check.seeLatest')} <ArrowRight data-icon="inline-end" />
              </Button>
              {childFeed && <SourceTag source={childFeed.source} />}
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('check.recentKicker')}</p>
              <h3 className="mt-1 text-xl font-semibold tracking-tight">{t('check.recentTitle')}</h3>
            </div>
            {recent.length > 0 && <Button variant="ghost" className="h-10" onClick={clearRecent}>{t('check.recentClear')}</Button>}
          </div>
          {recent.length === 0 ? (
            <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed px-6 py-10 text-center">
              <Rings className="size-24"><Search /></Rings>
              <p className="mt-4 font-semibold">{t('check.recentEmpty')}</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('check.recentEmptyHint')}</p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((item) => {
                const s = STATE_STYLE[item.state]
                return (
                  <button key={item.batch} onClick={() => runCheck(item.batch)} className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/50">
                    <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', s.cls)}><s.icon className="size-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{item.name === 'Batch check' ? t('check.recentBatchCheck') : item.name}</span>
                      <span className="block truncate text-xs text-muted-foreground"><span className="font-mono">{item.batch}</span> · {t(`state.${item.state}`)}</span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><FileSpreadsheet className="size-5" /></span>
            <div>
              <h3 className="font-semibold">{t('check.shelfTitle')}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{t('check.shelfHint')}</p>
            </div>
          </div>
          <Button variant="outline" className="h-11" onClick={() => soon('Shelf Sweep')}>
            {t('check.shelfOpen')} <ArrowRight data-icon="inline-end" />
          </Button>
        </section>

        <Suspense fallback={null}>
          <DeepLinkCheck onBatch={runDeepLink} />
        </Suspense>

        <Scanner
          open={scanning}
          onOpenChange={setScanning}
          onCheck={(b, label) => {
            setScanning(false)
            runCheck(b, label)
          }}
          onType={() => setScanning(false)}
          typeTarget={inputRef}
        />
    </>
  )
}
