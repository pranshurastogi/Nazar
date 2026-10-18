'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronDown, Map as MapIcon, X } from 'lucide-react'

import { serif } from '@/lib/fonts'
import { currentSnapshot, formatYm, loadSnapshot, onSnapshot, SOURCE_NAME, STATE_NAME } from '@/lib/source'
import { aggregate, failureShort, shadeSteps, type MonthTally, type StateTally } from '@/lib/source/aggregate'
import type { SnapshotIndex } from '@/lib/source/snapshot'
import { failureName, formatAsOfIn, formatYmLocale, regionName, useT, type Locale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import './feed-pulse.css'

// "India pulse": the top of the Feed. Every count comes from the snapshot on the device (the
// whole publishable alert set), so the picture answers at once and says how old it is.
// - A tile map of India: one equal tile per state or UT, placed roughly where it sits, shaded by
//   how many alerts name a maker there. Tapping a tile sets the Feed's own "Made in" filter.
// - A seismograph of alerts per month: severity 4–5 above the line, 1–3 below. Undated rows are
//   never placed in a month; they are counted in a note instead.
// The map follows the Feed's other filters (serious, Child Shield, source) so it always explains
// the list under it. Without a snapshot it shows nothing rather than an empty chart.

/**
 * [column, row] of each state's tile, west → east, north → south. Seven columns, so that on a
 * 360–390px phone every tile is a 44px target (WCAG 2.5.8) without the page scrolling sideways.
 */
const GRID: Record<string, [number, number]> = {
  'IN-JK': [2, 0], 'IN-LA': [3, 0],
  'IN-CH': [0, 1], 'IN-PB': [1, 1], 'IN-HP': [2, 1], 'IN-UK': [3, 1], 'IN-SK': [4, 1], 'IN-AR': [6, 1],
  'IN-HR': [1, 2], 'IN-DL': [2, 2], 'IN-UP': [3, 2], 'IN-BR': [4, 2], 'IN-AS': [5, 2], 'IN-NL': [6, 2],
  'IN-GJ': [0, 3], 'IN-RJ': [1, 3], 'IN-MP': [2, 3], 'IN-CG': [3, 3], 'IN-JH': [4, 3], 'IN-ML': [5, 3], 'IN-MN': [6, 3],
  'IN-DH': [0, 4], 'IN-MH': [1, 4], 'IN-TS': [2, 4], 'IN-OD': [3, 4], 'IN-WB': [4, 4], 'IN-TR': [5, 4], 'IN-MZ': [6, 4],
  'IN-GA': [0, 5], 'IN-KA': [1, 5], 'IN-AP': [2, 5],
  'IN-LD': [0, 6], 'IN-KL': [1, 6], 'IN-TN': [2, 6], 'IN-PY': [3, 6], 'IN-AN': [4, 6],
}
const CODES = Object.keys(GRID).sort((a, b) => GRID[a][1] - GRID[b][1] || GRID[a][0] - GRID[b][0])
const COLS = 7
const ROWS = 7

/** Shading per step (share of the flagged red mixed into the card), lightest first. */
const SHADE = [18, 36, 60, 88]
const shadeFor = (n: number, steps: number[]) => {
  if (n <= 0) return -1
  let i = 0
  while (i + 1 < steps.length && n >= steps[i + 1]) i++
  // With fewer steps, keep the top step the darkest so the busiest tile always stands out.
  return i + (SHADE.length - steps.length)
}
const mix = (pct: number) => `color-mix(in oklab, var(--flagged) ${pct}%, var(--card))`

/** Severity 1…5 as steps of the same red: the gravest is the full flagged colour. */
const SEV_FILL = [26, 40, 56, 78, 100].map(mix)

const fmt = (n: number) => n.toLocaleString('en-IN')
const short = (code: string) => code.replace(/^IN-/, '')
/** "18 Oct 2026, 5:03 pm IST": the snapshot's time, always in India time whatever the device says. */
const asOfIst = (d: Date) =>
  `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST`
/** The snapshot's time in the reader's language; English keeps its exact original form. */
const asOfIn = (locale: Locale, d: Date) => (locale === 'en' ? asOfIst(d) : formatAsOfIn(locale, d, true))
/** A state's name in the reader's language (the tiles keep their 2-letter codes). */
const nameIn = (locale: Locale, code: string) => regionName(locale, code, STATE_NAME[code] ?? code)
const ymShort = (locale: Locale, ym: number) => {
  if (locale !== 'en') {
    const d = new Date(Date.UTC(Math.floor(ym / 100), (ym % 100) - 1, 15))
    return `${d.toLocaleDateString('hi-IN', { month: 'short', timeZone: 'UTC' })} ’${String(Math.floor(ym / 100)).slice(-2)}`
  }
  const s = formatYm(ym)
  return s ? `${s.slice(0, 3)} ’${s.slice(-2)}` : ''
}

type Focus = { kind: 'state'; code: string } | { kind: 'month'; ym: number } | null

export function FeedPulse({
  state,
  serious,
  peds,
  source,
  onState,
}: {
  state: string
  serious: boolean
  peds: boolean
  source: string
  onState: (code: string) => void
}) {
  const { t: tr, tp, locale } = useT()
  const name = (code: string) => nameIn(locale, code)
  const reduced = useReducedMotion() ?? false
  // undefined while loading; null when the device has no snapshot and none could be fetched.
  const [snap, setSnap] = useState<SnapshotIndex | null | undefined>(undefined)
  const [medicinesOnly, setMedicinesOnly] = useState(false)
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState<Focus>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const tiles = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    let live = true
    const now = currentSnapshot()
    if (now) setSnap(now)
    const off = onSnapshot((s) => live && setSnap(s))
    loadSnapshot().then(
      (s) => live && setSnap((prev) => s ?? prev ?? null),
      () => live && setSnap((prev) => prev ?? null),
    )
    return () => {
      live = false
      off()
    }
  }, [])

  const pulse = useMemo(
    () => (snap ? aggregate(snap, { minSeverity: serious ? 4 : undefined, peds, source: source || undefined, medicinesOnly }, state) : null),
    [snap, serious, peds, source, medicinesOnly, state],
  )

  if (snap === undefined) return <PulseSkeleton />
  if (!pulse) return null

  const steps = shadeSteps(pulse.maxState)
  const ranked = [...pulse.states.values()].sort((a, b) => b.total - a.total)
  const busiest = ranked[0]?.code ?? 'IN-HP'
  const asOf = asOfIn(locale, pulse.asOf)
  const stOf = (code: string): StateTally => pulse.states.get(code) ?? { code, total: 0, sev5: 0, serious: 0, peds: 0, grave: 0, topFailure: null }
  const following = [serious && tr('feed.serious'), peds && tr('pulse.stat.peds'), source && SOURCE_NAME[source]].filter(Boolean) as string[]
  const active = cursor ?? (state && GRID[state] ? state : busiest)

  const tileLabel = (code: string) => {
    const t = stOf(code)
    const bits = [tp('feed.alerts', t.total)]
    if (t.sev5) bits.push(tr('pulse.nSev5', { n: fmt(t.sev5) }))
    if (t.peds) bits.push(tr('pulse.nPeds', { n: fmt(t.peds) }))
    return tr('pulse.tileLabel', { state: name(code), bits: bits.join(', ') })
  }

  // Arrow keys move between tiles by position: the nearest tile in that direction.
  const move = (from: string, dx: number, dy: number) => {
    const [x0, y0] = GRID[from]
    let best: string | null = null
    let score = Infinity
    for (const c of CODES) {
      const [x, y] = GRID[c]
      const along = dx ? (x - x0) * dx : (y - y0) * dy
      const across = dx ? Math.abs(y - y0) : Math.abs(x - x0)
      if (along <= 0) continue
      const s = along + across * 2.5
      if (s < score) {
        score = s
        best = c
      }
    }
    return best
  }
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, code: string) => {
    const dir: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }
    let next: string | null = null
    if (dir[e.key]) next = move(code, ...dir[e.key])
    else if (e.key === 'Home') next = CODES[0]
    else if (e.key === 'End') next = CODES[CODES.length - 1]
    else return
    e.preventDefault()
    if (!next) return
    setCursor(next)
    tiles.current.get(next)?.focus()
  }

  const shown = focus?.kind === 'state' ? focus.code : state || null
  const month = focus?.kind === 'month' ? pulse.months.find((m) => m.ym === focus.ym) : undefined

  const t = pulse.tally
  const stats = [
    { label: tr('pulse.stat.alerts'), value: t.total, mark: null },
    { label: tr('pulse.stat.sev5'), value: t.sev5, mark: 'sev5' as const },
    { label: tr('pulse.stat.peds'), value: t.peds, mark: 'peds' as const },
    { label: tr('pulse.stat.grave'), value: t.grave, mark: null },
  ]
  const top3 = ranked.slice(0, 3).filter((r) => r.total > 0)

  return (
    <section
      aria-labelledby="pulse-title"
      data-feed-pulse
      data-motion={reduced ? 'reduce' : 'full'}
      data-pulse-total={t.total}
      data-pulse-version={pulse.asOf.toISOString()}
      className="relative mt-7 overflow-hidden rounded-2xl border bg-card"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(90% 60% at 85% 0%, color-mix(in srgb, var(--flagged) 7%, transparent), transparent 70%)' }}
      />
      <div className="relative p-4 sm:p-5">
        <p className="text-[11px] font-bold tracking-[0.18em] text-primary uppercase hi:text-xs">{tr('pulse.kicker')}</p>
        <div className="mt-1.5">
          <h3 id="pulse-title" className="min-w-0 text-xl leading-tight font-semibold tracking-[-0.03em] sm:text-2xl hi:leading-snug">
            {tr('pulse.titleLead')}
            <span className={cn(locale === 'hi' ? 'font-semibold' : [serif.className, 'pr-0.5 text-[1.12em] font-normal tracking-normal'], 'whitespace-nowrap text-primary')}>{tr('pulse.titleAccent')}</span>
          </h3>
        </div>

        <dl className="mt-4 grid grid-cols-4 gap-2 sm:gap-3" data-pulse-stats>
          {stats.map((s) => (
            <div key={s.label} className="flex min-w-0 flex-col-reverse justify-end rounded-xl border bg-background/60 px-2 py-2 sm:px-3 sm:py-2.5">
              <dt className="flex items-center gap-1 text-[10px] leading-tight font-semibold text-muted-foreground sm:text-[11px]">
                {s.mark && <Marker kind={s.mark} className="hidden text-flagged sm:inline-block" />}
                <span className="min-w-0">{s.label}</span>
              </dt>
              <dd className="mb-0.5 font-mono text-base font-semibold tracking-tight tabular-nums sm:text-xl">{fmt(s.value)}</dd>
            </div>
          ))}
        </dl>
        {/* Says which count this is: alerts in Nazar's ledger (one per batch notice, duplicates
            merged, retractions left out), which is not the same number as entities on Arkiv. */}
        <p className="mt-2 text-xs leading-5 text-pretty text-muted-foreground" data-pulse-source>
          <span className="font-semibold text-foreground/85 hi:whitespace-nowrap">{tp('pulse.ledger', pulse.ledgerTotal)}</span>
          <span className="whitespace-nowrap hi:whitespace-normal">
            <span aria-hidden="true"> · </span>
            {tr('pulse.asOf', { time: asOf })}
          </span>
        </p>

        {(state || following.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {state && (
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 py-0.5 pr-0.5 pl-3 font-semibold text-primary">
                {tr('pulse.madeInState', { state: name(state) })}
                <button
                  type="button"
                  onClick={() => onState('')}
                  data-pulse-clear
                  aria-label={tr('pulse.clearAria', { state: name(state) })}
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-[11px] font-bold tracking-wide uppercase hi:text-xs hover:bg-primary/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <X className="size-3.5" aria-hidden="true" /> {tr('pulse.clear')}
                </button>
              </span>
            )}
            {following.length > 0 && <span>{tr('pulse.counting', { list: following.join(' · ') })}</span>}
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="pulse-body"
          data-pulse-toggle
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-background/70 px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:hidden"
        >
          <MapIcon className="size-4 text-primary" aria-hidden="true" />
          {open ? tr('pulse.hideMap') : tr('pulse.showMap')}
          <ChevronDown className={cn('size-4 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
        </button>

        <p className="sr-only">
          {tr('pulse.srSummary', { time: asOf, alerts: tp('feed.alerts', t.total), where: state ? tr('pulse.srWhere', { state: name(state) }) : '', sev5: fmt(t.sev5), peds: fmt(t.peds) })}
          {top3.length > 0 && tr('pulse.srTop', { list: top3.map((r) => `${name(r.code)} ${fmt(r.total)}`).join(', ') })}
          {tr('pulse.srChoose')}
        </p>

        <div id="pulse-body" className={cn('mt-5 grid gap-6 md:mt-6 md:grid-cols-[minmax(0,1fr)_minmax(17rem,23rem)] md:gap-8', !open && 'hidden md:grid')}>
          <div className="order-2 flex min-w-0 flex-col gap-4 md:order-1">
            <Readout locale={locale} pulse={pulse} code={shown} month={month} top={ranked} stOf={stOf} selected={!!state && !focus} />
            <Seismograph months={pulse.months} undated={pulse.undated} reduced={reduced} focusYm={month?.ym ?? null} onFocus={(ym) => setFocus(ym ? { kind: 'month', ym } : null)} />
          </div>

          <div className="order-1 min-w-0 md:order-2">
            {/* On a phone the map uses the card's full width (tiles 44px or more); below ~360px it
                scrolls inside this frame rather than the page. */}
            <div className="-mx-4 overflow-x-auto px-[3px] py-1.5 min-[360px]:overflow-visible sm:mx-0 sm:px-0" data-pulse-map>
              <div
                role="group"
                aria-label={tr('pulse.mapAria')}
                className="@container relative mx-auto grid min-w-[20rem] max-w-[23rem] gap-[2px] sm:gap-1 md:min-w-0"
                style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${ROWS}, auto)` }}
                onMouseLeave={() => setFocus(null)}
              >
                {CODES.map((code) => {
                  const st = stOf(code)
                  const [x, y] = GRID[code]
                  const step = shadeFor(st.total, steps)
                  const selected = state === code
                  const dim = !!state && !selected
                  return (
                    <motion.button
                      key={code}
                      ref={(el: HTMLButtonElement | null) => void (el ? tiles.current.set(code, el) : tiles.current.delete(code))}
                      type="button"
                      data-pulse-tile={code}
                      data-pulse-count={st.total}
                      aria-label={tileLabel(code)}
                      aria-pressed={selected}
                      tabIndex={code === active ? 0 : -1}
                      onClick={() => onState(selected ? '' : code)}
                      onKeyDown={(e) => onKey(e, code)}
                      onFocus={() => {
                        setCursor(code)
                        setFocus({ kind: 'state', code })
                      }}
                      onBlur={() => setFocus(null)}
                      onMouseEnter={() => setFocus({ kind: 'state', code })}
                      initial={reduced ? false : { opacity: 0, scale: 0.55 }}
                      animate={{ opacity: dim ? 0.5 : 1, scale: 1 }}
                      transition={reduced ? { duration: 0 } : { opacity: { duration: 0.25, delay: (x + y) * 0.035 }, scale: { type: 'spring', stiffness: 380, damping: 24, delay: (x + y) * 0.035 } }}
                      whileHover={reduced ? undefined : { scale: 1.06 }}
                      whileTap={reduced ? undefined : { scale: 0.95 }}
                      style={{ gridColumn: x + 1, gridRow: y + 1, background: step < 0 ? undefined : mix(SHADE[step]) }}
                      className={cn(
                        'relative flex aspect-square min-w-0 flex-col justify-between rounded-[22%] p-[9%] text-left outline-none focus-visible:z-20 focus-visible:ring-3 focus-visible:ring-ring/60',
                        step < 0 && 'border border-border/80 bg-muted/40 text-muted-foreground',
                        step >= 0 && step < 3 && 'text-foreground',
                        step >= 3 && 'text-white dark:text-background',
                        selected && 'z-10 ring-[2.5px] ring-primary ring-offset-2 ring-offset-card',
                      )}
                    >
                      <span className="flex items-start justify-between gap-0.5">
                        <span className="text-[clamp(9px,3cqw,12px)] leading-none font-bold tracking-wide">{short(code)}</span>
                        <span className="flex gap-[2px]">
                          {st.peds > 0 && <Marker kind="peds" />}
                          {st.sev5 > 0 && <Marker kind="sev5" className={cn(!reduced && 'feed-pulse-ping rounded-full')} />}
                        </span>
                      </span>
                      <span className={cn('font-mono text-[clamp(10px,3.9cqw,15px)] leading-none font-semibold tabular-nums', st.total === 0 && 'opacity-60')}>
                        {st.total >= 1000 ? `${Math.round(st.total / 100) / 10}k` : st.total}
                      </span>
                    </motion.button>
                  )
                })}
              </div>
            </div>

            <div className="mx-auto mt-3 flex max-w-[23rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="mr-0.5">{tr('pulse.stat.alerts')}</span>
                <span className="size-3 rounded-[3px] border border-border/80 bg-muted/40" />
                <span className="font-mono">0</span>
                {steps.map((s, i) => (
                  <span key={s} className="flex items-center gap-1">
                    <span className="size-3 rounded-[3px]" style={{ background: mix(SHADE[i + (SHADE.length - steps.length)]) }} />
                    <span className="font-mono">{i === steps.length - 1 ? `${fmt(s)}+` : fmt(s)}</span>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="flex items-center gap-1"><Marker kind="sev5" className="text-foreground" /> {tr('pulse.legendSev5')}</span>
                <span className="flex items-center gap-1"><Marker kind="peds" className="text-foreground" /> {tr('pulse.stat.peds')}</span>
              </div>
            </div>
            {pulse.noState > 0 && (
              <p className="mx-auto mt-2 max-w-[23rem] text-[11px] leading-4 text-muted-foreground">
                {tp('pulse.noState', pulse.noState)}
              </p>
            )}
          </div>
        </div>

        {(pulse.nonMedicine > 0 || medicinesOnly) && (
          <div className={cn('mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground', !open && 'hidden md:flex')}>
            <button
              type="button"
              aria-pressed={medicinesOnly}
              onClick={() => setMedicinesOnly((v) => !v)}
              data-pulse-medicines
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full border bg-background px-3 font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                medicinesOnly && 'border-primary/50 bg-primary/10 text-primary hover:text-primary',
              )}
            >
              <span className={cn('grid size-3.5 place-items-center rounded-[4px] border border-current', medicinesOnly && 'bg-current')} aria-hidden="true">
                {medicinesOnly && <span className="size-1.5 rounded-[1px] bg-background" />}
              </span>
              {tr('pulse.medicinesOnly')}
            </button>
            <span>
              {medicinesOnly
                ? tp('pulse.leftOut', pulse.hiddenNonMedicine)
                : tp('pulse.includes', pulse.nonMedicine)}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

function Marker({ kind, className }: { kind: 'sev5' | 'peds'; className?: string }) {
  return kind === 'sev5' ? (
    <span aria-hidden="true" className={cn('inline-block size-[6px] shrink-0 rounded-full bg-current', className)} />
  ) : (
    <span aria-hidden="true" className={cn('inline-block size-[6px] shrink-0 rounded-full border-[1.5px] border-current', className)} />
  )
}

/** The panel beside the map: the state or month under the pointer, else the selection, else the leaders. */
function Readout({
  locale,
  pulse,
  code,
  month,
  top,
  stOf,
  selected,
}: {
  locale: Locale
  pulse: ReturnType<typeof aggregate>
  code: string | null
  month: MonthTally | undefined
  top: StateTally[]
  stOf: (code: string) => StateTally
  selected: boolean
}) {
  const { t, tp } = useT()
  const name = (c: string) => nameIn(locale, c)
  let title: string
  let lines: string[]
  let kicker: string
  if (month) {
    kicker = t('pulse.month')
    title = (locale === 'en' ? formatYm(month.ym) : formatYmLocale(locale, month.ym)) ?? ''
    const serious = month.bySeverity[3] + month.bySeverity[4]
    lines = month.total
      ? [
          t('pulse.monthLine', { alerts: tp('feed.alerts', month.total), n: fmt(serious) }),
          [month.peds && t('pulse.nPeds', { n: fmt(month.peds) }), month.grave && t('pulse.nGrave', { n: fmt(month.grave) })].filter(Boolean).join(' · ') || t('pulse.noPedsGrave'),
        ]
      : [t('pulse.emptyMonth1'), t('pulse.emptyMonth2')]
  } else if (code) {
    const st = stOf(code)
    kicker = selected ? t('pulse.showing') : t('pulse.madeIn')
    title = name(code)
    lines = st.total
      ? [
          [tp('feed.alerts', st.total), t('pulse.nSev5', { n: fmt(st.sev5) }), st.peds && t('pulse.nPeds', { n: fmt(st.peds) })].filter(Boolean).join(' · '),
          st.topFailure ? t('pulse.mostFailed', { what: failureName(locale, st.topFailure[0], failureShort(st.topFailure[0])), n: fmt(st.topFailure[1]) }) : t('pulse.noReasons'),
        ]
      : [t('pulse.emptyState1'), t('pulse.emptyState2')]
  } else {
    kicker = t('pulse.mostAlerts')
    title = top[0] && top[0].total ? name(top[0].code) : t('pulse.noMatch')
    lines = top[0] && top[0].total
      ? [
          t('pulse.topLine', { alerts: tp('feed.alerts', top[0].total), pct: Math.round((top[0].total / Math.max(1, pulse.tally.total - pulse.noState)) * 100) }),
          top.slice(1, 3).filter((r) => r.total).map((r) => `${name(r.code)} ${fmt(r.total)}`).join(' · ') || ' ',
        ]
      : [t('pulse.fewerFilters'), ' ']
  }
  return (
    <div className="min-h-[5.75rem] rounded-xl border bg-background/60 px-4 py-3" data-pulse-readout>
      <p className="text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase hi:text-xs">{kicker}</p>
      <p className="mt-0.5 truncate text-lg leading-snug font-semibold tracking-[-0.02em]">{title}</p>
      {lines.map((l, i) => (
        <p key={i} className="text-[13px] leading-5 text-muted-foreground">{l}</p>
      ))}
    </div>
  )
}

/** Alerts per month: severity 4–5 rise above the line, 1–3 hang below it, on one linear scale. */
function Seismograph({
  months,
  undated,
  reduced,
  focusYm,
  onFocus,
}: {
  months: MonthTally[]
  undated: number
  reduced: boolean
  focusYm: number | null
  onFocus: (ym: number | null) => void
}) {
  const { t, tp, locale } = useT()
  const ymName = (ym: number) => (locale === 'en' ? formatYm(ym) : formatYmLocale(locale, ym))
  // One linear scale for both sides. The line sits where the busiest months need it, so neither
  // side wastes space; the upper side keeps a little room even when serious alerts are few.
  const upMax = Math.max(0, ...months.map((m) => m.bySeverity[3] + m.bySeverity[4]))
  const downMax = Math.max(0, ...months.map((m) => m.bySeverity[0] + m.bySeverity[1] + m.bySeverity[2]))
  const shareUp = Math.min(0.78, Math.max(0.24, upMax / Math.max(1, upMax + downMax)))
  const k = Math.max(upMax / shareUp, downMax / (1 - shareUp), 1)
  const pctUp = (n: number) => `${(n / (k * shareUp)) * 100}%`
  const pctDown = (n: number) => `${(n / (k * (1 - shareUp))) * 100}%`
  const label = months.length
    ? t('pulse.chartAria', { from: ymName(months[0].ym) ?? '', to: ymName(months[months.length - 1].ym) ?? '' })
    : t('pulse.chartEmptyAria')
  const showLabel = (i: number) => {
    const ym = months[i].ym
    if (i === 0 || i === months.length - 1) return true
    if (ym % 100 !== 1) return false
    return i > 2 && i < months.length - 3
  }

  return (
    <div className="min-w-0" data-pulse-timeline>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold">{t('pulse.byMonth')}</p>
        <p className="flex items-center gap-3 text-[11px] text-muted-foreground" aria-hidden="true">
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-[2px]" style={{ background: SEV_FILL[4] }} />↑ 4–5</span>
          <span className="flex items-center gap-1"><span className="size-2.5 rounded-[2px]" style={{ background: SEV_FILL[1] }} />↓ 1–3</span>
        </p>
      </div>
      {months.length === 0 ? (
        <p className="mt-2 rounded-xl bg-muted px-3 py-4 text-center text-xs text-muted-foreground">{t('pulse.noDated')}</p>
      ) : (
        <>
          <div role="img" aria-label={label} className="relative mt-2 h-32 overflow-hidden rounded-xl border bg-background/60 sm:h-36" onMouseLeave={() => onFocus(null)}>
            <span aria-hidden="true" className="absolute inset-x-0 h-px bg-border" style={{ top: `calc(12px + ${shareUp} * (100% - 24px))` }} />
            {!reduced && <span aria-hidden="true" className="feed-pulse-sweep" />}
            <div className="relative flex h-full gap-[2px] px-1.5">
              {months.map((m, i) => {
                const up = m.bySeverity[3] + m.bySeverity[4]
                const down = m.bySeverity[0] + m.bySeverity[1] + m.bySeverity[2]
                const hot = focusYm === m.ym
                return (
                  <div
                    key={m.ym}
                    onMouseEnter={() => onFocus(m.ym)}
                    className={cn('relative flex min-w-0 flex-1 flex-col rounded-[3px] py-3 transition-colors', hot && 'bg-muted')}
                  >
                    <motion.div
                      className="flex min-h-0 flex-col justify-end"
                      style={{ transformOrigin: '50% 100%', flex: `${shareUp} 1 0` }}
                      initial={reduced ? false : { scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={reduced ? { duration: 0 } : { duration: 0.6, delay: 0.25 + i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <span className="relative block" style={{ height: pctUp(up) }}>
                        {(m.peds > 0 || m.grave > 0) && (
                          <span className="absolute inset-x-0 bottom-full mb-[3px] flex justify-center gap-[2px] text-flagged" aria-hidden="true">
                            {m.peds > 0 && <Marker kind="peds" />}
                            {m.grave > 0 && <span className="inline-block size-[6px] rotate-45 bg-current" />}
                          </span>
                        )}
                        <Stack counts={[m.bySeverity[4], m.bySeverity[3]]} fills={[SEV_FILL[4], SEV_FILL[3]]} className="rounded-t-[3px]" />
                      </span>
                    </motion.div>
                    <motion.div
                      className="flex min-h-0 flex-col pt-px"
                      style={{ transformOrigin: '50% 0%', flex: `${1 - shareUp} 1 0` }}
                      initial={reduced ? false : { scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={reduced ? { duration: 0 } : { duration: 0.6, delay: 0.25 + i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <span className="block" style={{ height: pctDown(down) }}>
                        <Stack counts={[m.bySeverity[2], m.bySeverity[1], m.bySeverity[0]]} fills={[SEV_FILL[2], SEV_FILL[1], SEV_FILL[0]]} className="rounded-b-[3px]" />
                      </span>
                    </motion.div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="relative mt-1 flex h-4 gap-[2px] px-1.5 text-[10px] text-muted-foreground" aria-hidden="true">
            {months.map((m, i) => (
              <span key={m.ym} className="relative min-w-0 flex-1">
                {showLabel(i) && (
                  <span className={cn('absolute top-0 font-mono whitespace-nowrap', i === months.length - 1 && i > 0 ? 'right-0' : 'left-0')}>{ymShort(locale, m.ym)}</span>
                )}
              </span>
            ))}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-4 text-muted-foreground">
            <span className="flex items-center gap-1" aria-hidden="true"><Marker kind="peds" className="text-flagged" /> {t('pulse.stat.peds')}</span>
            <span className="flex items-center gap-1" aria-hidden="true"><span className="inline-block size-[6px] rotate-45 bg-flagged" /> {t('pulse.legendGrave')}</span>
            {undated > 0 && <span data-pulse-undated>{tp('pulse.undated', undated)}</span>}
          </p>
          <table className="sr-only">
            <caption>{t('pulse.tableCaption')}</caption>
            <thead>
              <tr><th scope="col">{t('pulse.thMonth')}</th><th scope="col">{t('pulse.thAlerts')}</th><th scope="col">{t('pulse.thSerious')}</th><th scope="col">{t('pulse.thPeds')}</th></tr>
            </thead>
            <tbody>
              {months.filter((m) => m.total).map((m) => (
                <tr key={m.ym}><th scope="row">{ymName(m.ym)}</th><td>{m.total}</td><td>{m.bySeverity[3] + m.bySeverity[4]}</td><td>{m.peds}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

/** Severity segments of one bar, gravest first, with a 1px surface gap; empty ones are skipped. */
function Stack({ counts, fills, className }: { counts: number[]; fills: string[]; className?: string }) {
  return (
    <span className={cn('flex h-full flex-col gap-px overflow-hidden', className)}>
      {counts.map((n, i) => (n > 0 ? <span key={i} className="min-h-0" style={{ flexGrow: n, flexBasis: 0, background: fills[i] }} /> : null))}
    </span>
  )
}

function PulseSkeleton() {
  return (
    <div aria-hidden="true" data-feed-pulse-loading className="mt-7 rounded-2xl border bg-card p-4 sm:p-5">
      <span className="block h-3 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <span className="mt-3 block h-6 w-64 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <span className="mt-4 grid grid-cols-4 gap-2 sm:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="block h-14 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
        ))}
      </span>
      <span className="mt-6 hidden h-64 animate-pulse rounded-xl bg-muted motion-reduce:animate-none md:block" />
    </div>
  )
}
