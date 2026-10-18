'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import {
  ChevronDown,
  CircleHelp,
  Clock,
  Download,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useShell } from '@/components/nazar/app-shell'
import { CabinetFormDialog } from '@/components/nazar/cabinet-form'
import { CabinetShelf, EmptyShelf, ShelfPlaceholder } from '@/components/nazar/cabinet-shelf'
import { ResultCard, SourceTag } from '@/components/nazar/result-card'
import { timeAgo } from '@/components/nazar/status-pill'
import {
  expiryStatus,
  exportJson,
  formatExpiry,
  importJson,
  readCabinet,
  recordCheck,
  removeItem,
  restoreItem,
  useCabinet,
  useHydrated,
  type CabinetDraft,
  type CabinetItem,
} from '@/lib/cabinet'
import { serif } from '@/lib/fonts'
import { checkBatch, type CheckResult, type ResultState } from '@/lib/source'
import { cn } from '@/lib/utils'

// The Cabinet tab: medicines a family keeps at home, saved in this browser only. Every
// batch is re-checked through the same pipeline as a manual check (API → Arkiv → demo),
// one at a time with a short gap, so the shared Arkiv backoff and cache are respected.

/** Gap between re-checks, so a long cabinet never bursts the public Arkiv RPC. */
const RECHECK_GAP_MS = 350

const STATE_STYLE: Record<ResultState, { icon: typeof Search; tile: string; badge: string; label: string }> = {
  flagged: { icon: TriangleAlert, tile: 'bg-flagged text-white dark:text-background', badge: 'bg-flagged text-white dark:text-background', label: 'Flagged' },
  retracted: { icon: History, tile: 'bg-caution-soft text-caution', badge: 'bg-caution-soft text-caution', label: 'Retracted' },
  no_alert: { icon: Search, tile: 'bg-quiet-soft text-quiet', badge: 'bg-quiet-soft text-quiet', label: 'No alert found' },
  unreadable: { icon: CircleHelp, tile: 'bg-caution-soft text-caution', badge: 'bg-caution-soft text-caution', label: "Can't tell" },
}

const RANK: Record<ResultState, number> = { flagged: 0, retracted: 1, unreadable: 2, no_alert: 3 }

/** Flagged first, then retracted; otherwise the order the person saved them in. */
const ordered = (items: CabinetItem[]) =>
  items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (RANK[a.item.last?.state ?? 'no_alert'] - RANK[b.item.last?.state ?? 'no_alert']) || a.i - b.i)
    .map((x) => x.item)

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** On a phone the shelf is the index, so the list keeps only the cards that need a look. */
const needsLook = (i: CabinetItem) => i.last?.state === 'flagged' || i.last?.state === 'retracted' || i.last?.state === 'unreadable'

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

function Pill({ className, children, ...rest }: React.ComponentProps<'span'>) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-bold tracking-wide whitespace-nowrap uppercase', className)} {...rest}>
      {children}
    </span>
  )
}

function CabinetRow({
  item,
  result,
  checking,
  open,
  now,
  onToggle,
  onEdit,
  onRemove,
  onCheck,
}: {
  item: CabinetItem
  result: CheckResult | undefined
  checking: boolean
  open: boolean
  now: number
  onToggle: () => void
  onEdit: () => void
  onRemove: () => void
  onCheck: (batch: string) => void
}) {
  const state = item.last?.state
  const s = state ? STATE_STYLE[state] : null
  const exp = expiryStatus(item.expiry, new Date(now))
  const expLabel = formatExpiry(item.expiry)
  const Icon = s?.icon ?? Clock
  const panelId = `cabinet-${item.id}`

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border bg-card transition-colors',
        state === 'flagged' && 'border-flagged-border',
        open && 'shadow-sm',
      )}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-[4.75rem] w-full items-start gap-3.5 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className={cn('relative grid size-11 shrink-0 place-items-center rounded-xl', s?.tile ?? 'bg-muted text-muted-foreground')}>
          <Icon className="size-5" aria-hidden="true" />
          {checking && (
            <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border bg-card text-primary">
              <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{item.name}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
            <span className="font-mono font-semibold text-foreground/85">{item.batch}</span>
            {item.note ? ` · ${item.note}` : ''}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {s ? (
              <Pill className={s.badge} data-cabinet-state={state}>{s.label}</Pill>
            ) : (
              <Pill className="bg-muted text-muted-foreground" data-cabinet-state="pending">{checking ? 'Checking' : 'Not checked yet'}</Pill>
            )}
            {exp && (
              <Pill
                data-expiry={exp.kind}
                className={exp.kind === 'expired' ? 'bg-caution text-white dark:text-background' : 'border border-caution-border bg-caution-soft text-caution'}
              >
                {exp.label}
              </Pill>
            )}
            {expLabel && !exp && <span className="text-xs text-muted-foreground">Exp {expLabel}</span>}
            {expLabel && exp && <span className="text-xs text-muted-foreground">{expLabel}</span>}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {checking ? (
              <span>Checking now…</span>
            ) : item.last ? (
              <span data-last-checked>Last checked {timeAgo(item.last.at, now)}</span>
            ) : (
              <span>Waiting to be checked</span>
            )}
            {item.last && !checking && <SourceTag source={item.last.source} />}
          </span>
        </span>
        <ChevronDown className={cn('mt-3.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div id={panelId} role="region" aria-label={`Details for ${item.name}`} className="border-t px-3 pt-3 pb-3 sm:px-4">
          {(item.composition?.length || item.maker) && (
            <dl className="mb-3 grid gap-1 rounded-xl bg-muted/50 px-3.5 py-2.5 text-[13px] leading-5" data-cabinet-details>
              {item.composition?.length ? (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">Composition</dt>
                  <dd className="min-w-0 break-words">{item.composition.join(', ')}</dd>
                </div>
              ) : null}
              {item.maker && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">Made by</dt>
                  <dd className="min-w-0 break-words">{item.maker}</dd>
                </div>
              )}
            </dl>
          )}
          {exp?.kind === 'expired' && (
            <p className="mb-3 flex items-start gap-2 rounded-xl border border-caution-border bg-caution-soft px-3.5 py-3 text-sm text-caution">
              <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-semibold">This pack expired at the end of {expLabel}.</span> Don&apos;t use it. Ask your chemist how to dispose of it.
              </span>
            </p>
          )}
          {result ? (
            <ResultCard result={result} onCheck={onCheck} saveable={false} />
          ) : (
            <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              {checking ? 'Checking this batch now…' : 'The full answer appears here after the next check.'}
            </p>
          )}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="outline" className="h-11 px-3.5" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
            <Button variant="destructive" className="h-11 px-3.5" onClick={onRemove}>
              <Trash2 /> Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Cabinet() {
  const items = useCabinet()
  const hydrated = useHydrated()
  const shell = useShell()
  const [results, setResults] = useState<Record<string, CheckResult>>({})
  const [progress, setProgress] = useState<{ current: string | null; done: number; total: number } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  /** Phone only: show every card, not just the ones that need a look. */
  const [showAll, setShowAll] = useState(false)
  /** Cards opened from the shelf this visit stay in the phone's short list. */
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())
  const [form, setForm] = useState<{ open: boolean; editing: CabinetItem | null; initial?: Partial<CabinetDraft> }>({ open: false, editing: null })
  const [now, setNow] = useState(() => Date.now())
  const queue = useRef<CabinetItem[]>([])
  const runRef = useRef<AbortController | null>(null)
  const started = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const drain = useCallback(async (manual: boolean) => {
    const ctrl = new AbortController()
    runRef.current = ctrl
    let done = 0
    let failed = 0
    while (queue.current.length && !ctrl.signal.aborted) {
      const item = queue.current.shift()!
      setProgress({ current: item.id, done, total: done + queue.current.length + 1 })
      try {
        const r = await checkBatch(item.batch, { signal: ctrl.signal })
        if (ctrl.signal.aborted) break
        setResults((prev) => ({ ...prev, [item.id]: r }))
        recordCheck(item.id, { state: r.state, source: r.source, at: Date.now(), ...('alert' in r ? { brand: r.alert.brand } : {}) })
      } catch {
        if (ctrl.signal.aborted) break
        failed++
      }
      done++
      if (queue.current.length) await sleep(RECHECK_GAP_MS, ctrl.signal)
    }
    if (runRef.current !== ctrl) return
    runRef.current = null
    setProgress(null)
    setNow(Date.now())
    if (failed) toast.error(`Couldn't check ${plural(failed, 'medicine')} right now. Try again in a minute.`)
    else if (manual && done) toast.success(`Re-checked ${plural(done, 'medicine')}`)
  }, [])

  const enqueue = useCallback(
    (targets: CabinetItem[], manual = false) => {
      for (const t of targets) {
        const at = queue.current.findIndex((q) => q.id === t.id)
        if (at >= 0) queue.current[at] = t
        else queue.current.push(t)
      }
      if (!runRef.current && queue.current.length) void drain(manual)
      else setProgress((p) => (p ? { ...p, total: p.done + queue.current.length + 1 } : p))
    },
    [drain],
  )

  // Stop any run when leaving the tab; a remount (or React's dev double-mount) starts afresh.
  useEffect(
    () => () => {
      runRef.current?.abort()
      runRef.current = null
      queue.current = []
      started.current = false
    },
    [],
  )

  // Re-check everything once per visit.
  useEffect(() => {
    if (!hydrated || started.current) return
    started.current = true
    enqueue(readCabinet())
  }, [hydrated, enqueue])

  const list = ordered(items)
  const flagged = list.filter((i) => i.last?.state === 'flagged')
  const shortList = (i: CabinetItem) => needsLook(i) || revealed.has(i.id) || openId === i.id
  const hiddenCount = list.filter((i) => !shortList(i)).length
  /** Phone: collapse only when it actually hides something. */
  const collapsible = hiddenCount > 0
  const running = progress !== null
  const sources = [...new Set(items.map((i) => i.last?.source).filter(Boolean))]
  const latest = items.reduce((m, i) => Math.max(m, i.last?.at ?? 0), 0)

  const openForm = (editing: CabinetItem | null = null, initial?: Partial<CabinetDraft>) => setForm({ open: true, editing, initial })

  const onSaved = (item: CabinetItem, isNew: boolean) => {
    if (!isNew) {
      setResults((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
    }
    enqueue([item])
  }

  const remove = (item: CabinetItem) => {
    const index = readCabinet().findIndex((i) => i.id === item.id)
    removeItem(item.id)
    if (openId === item.id) setOpenId(null)
    toast(`${item.name} removed from your cabinet`, {
      action: { label: 'Undo', onClick: () => restoreItem(item, index) },
    })
  }

  /** Opens an item's row in the list and brings it into view (from the banner or a shelf capsule). */
  const openItem = (id: string, focus = false) => {
    setOpenId(id)
    setRevealed((r) => (r.has(id) ? r : new Set(r).add(id)))
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-cabinet-item="${id}"]`)
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      row?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
      if (focus) row?.querySelector<HTMLElement>('button[aria-expanded]')?.focus({ preventScroll: true })
    })
  }

  const review = () => {
    const first = flagged[0]
    if (first) openItem(first.id)
  }

  const download = () => {
    const blob = new Blob([exportJson(readCabinet())], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nazar-cabinet-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    toast.success('Cabinet exported. The file stays on your device.')
  }

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      if (file.size > 512 * 1024) throw new Error('That file is too large to be a Nazar cabinet.')
      const r = importJson(await file.text())
      const parts = [r.added && `${plural(r.added, 'medicine')} added`, r.updated && `${r.updated} updated`, r.skipped && `${r.skipped} skipped`].filter(Boolean)
      toast.success(`Imported: ${parts.join(', ') || 'nothing new'}`)
      enqueue(readCabinet())
    } catch (err) {
      toast.error(err instanceof SyntaxError ? "That file isn't a Nazar cabinet export." : err instanceof Error ? err.message : "Couldn't import that file.")
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="pt-4 md:pt-8">
        <section className="max-w-2xl">
          <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.18em] text-primary uppercase">
            <ShieldCheck className="size-3.5" aria-hidden="true" /> Private by design
          </p>
          <h2 className="mt-3 text-[clamp(2rem,6vw,2.75rem)] leading-[1.02] font-semibold tracking-[-0.045em]">
            Your medicines, <span className={cn(serif.className, 'font-normal tracking-[-0.01em] whitespace-nowrap text-primary italic')}>kept in view.</span>
          </h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
            Save the batches you keep at home. Nazar re-checks each one against regulator alerts every time you open this page. The list lives only in this browser and is never sent to any server.
          </p>
        </section>

        <div className="mt-7 flex flex-wrap items-center gap-2">
          <Button className="h-12 flex-1 rounded-xl px-5 text-sm font-semibold sm:flex-none" onClick={() => openForm()}>
            <Plus /> Add a medicine
          </Button>
          <Button
            variant="outline"
            className="h-12 flex-1 rounded-xl px-4 text-sm font-semibold sm:flex-none"
            onClick={() => enqueue(readCabinet(), true)}
            disabled={!hydrated || !items.length || running}
            aria-busy={running}
          >
            <RefreshCw className={cn(running && 'animate-spin motion-reduce:animate-none')} /> {running ? 'Checking…' : 'Re-check all'}
          </Button>
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <Button variant="ghost" className="h-12 flex-1 rounded-xl px-3.5 sm:flex-none" onClick={download} disabled={!hydrated || !items.length}>
              <Download /> Export
            </Button>
            <Button variant="ghost" className="h-12 flex-1 rounded-xl px-3.5 sm:flex-none" onClick={() => fileRef.current?.click()} disabled={!hydrated}>
              <Upload /> Import
            </Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="Import a cabinet file" data-cabinet-import onChange={upload} />
          </div>
        </div>

        {!hydrated ? (
          <div className="mt-5">
            <ShelfPlaceholder />
          </div>
        ) : (
          <>
            <div className="mt-5">
              {items.length > 0 ? (
                <CabinetShelf
                  items={list}
                  now={now}
                  checkingId={progress?.current ?? null}
                  progress={progress}
                  onOpen={(id) => openItem(id, true)}
                  onReview={review}
                />
              ) : (
                <EmptyShelf onAdd={() => openForm()} onTry={() => openForm(null, { batch: 'SR-13', name: 'COLDRIF syrup' })} />
              )}
            </div>

            <div className={cn('mt-6 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1', !items.length && 'sr-only')}>
              <p className="text-sm" aria-live="polite" data-cabinet-count>
                <span className="font-semibold">{plural(items.length, 'medicine')}</span>
                <span className="text-muted-foreground">
                  {progress
                    ? ` · checking ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                    : latest
                      ? ` · checked ${timeAgo(latest, now)}`
                      : ''}
                </span>
              </p>
              {!running && sources.length === 1 && sources[0] && <SourceTag source={sources[0]} />}
            </div>

            {/* The bar's room is kept whether or not a re-check runs, so the list never jumps. */}
            {items.length > 0 && (
              <div className="mt-2 h-0.5" aria-hidden="true">
                {running && <div className="nazar-progress h-full rounded-full bg-primary/15" />}
              </div>
            )}

            {items.length > 0 && (
              <>
                <ul ref={listRef} className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3" aria-label="Medicines in your cabinet" data-cabinet-list={collapsible ? (showAll ? 'all' : 'short') : 'all'}>
                  <AnimatePresence initial={false}>
                    {list.map((item) => (
                      <motion.li
                        key={item.id}
                        layout="position"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, transition: { duration: 0.15 } }}
                        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                        data-cabinet-item={item.id}
                        data-batch={item.batch}
                        data-short={shortList(item) ? '' : undefined}
                        className={cn('scroll-mt-6 scroll-mb-28', collapsible && !showAll && !shortList(item) && 'max-md:hidden')}
                      >
                        <CabinetRow
                          item={item}
                          result={results[item.id]}
                          checking={progress?.current === item.id}
                          open={openId === item.id}
                          now={now}
                          onToggle={() => setOpenId((id) => (id === item.id ? null : item.id))}
                          onEdit={() => openForm(item)}
                          onRemove={() => remove(item)}
                          onCheck={shell.requestCheck}
                        />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
                {collapsible && (
                  <div className="mt-3 flex flex-col items-center gap-1.5 text-center md:hidden" data-cabinet-showall>
                    {!showAll && (
                      <p className="text-xs leading-5 text-pretty text-muted-foreground">
                        {hiddenCount === items.length
                          ? 'None of these needs a look right now. Tap a capsule on the shelf for its details.'
                          : `${plural(hiddenCount, 'more medicine')} on the shelf above, with no alert found or not checked yet.`}
                      </p>
                    )}
                    <Button variant="outline" className="h-11 w-full max-w-sm rounded-xl text-sm font-semibold" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                      {showAll ? 'Show only what needs a look' : `Show all ${plural(items.length, 'medicine')}`}
                      <ChevronDown className={cn('transition-transform duration-200', showAll && 'rotate-180')} aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </>
            )}

            <section className="mt-8 flex items-start gap-3 rounded-2xl border bg-card p-5" aria-label="Privacy">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold">Never leaves this device</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Your cabinet is stored in this browser&apos;s local storage and is never sent to any server. A re-check looks up each batch number on its own, never the names, notes or the list. Use Export to keep a copy or move it to another phone.
                </p>
              </div>
            </section>
          </>
        )}

        <CabinetFormDialog
          open={form.open}
          onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
          editing={form.editing}
          initial={form.initial}
          onSaved={onSaved}
        />
      </div>
    </MotionConfig>
  )
}
