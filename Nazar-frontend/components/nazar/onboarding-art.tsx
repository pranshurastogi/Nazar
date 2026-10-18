'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { CircleHelp, FileText, Hash, History, Lock, Search, Smartphone, TriangleAlert } from 'lucide-react'

import { NazarMark } from '@/components/nazar/logo'
import { regionName, useT } from '@/lib/i18n'
import { stateName } from '@/lib/source/labels'
import { STATIC_SOURCES } from '@/lib/source/sources'
import { cn } from '@/lib/utils'

/** Subtle dot grid behind every illustration. */
export function DotGrid({ className }: { className?: string }) {
  return (
    <svg className={cn('pointer-events-none absolute inset-0 size-full text-primary', className)} aria-hidden="true">
      <defs>
        <pattern id="nazar-dots" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" fill="currentColor" fillOpacity=".16" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#nazar-dots)" />
    </svg>
  )
}

const SPOTS = [
  { pos: 'left-[-14%] top-[14%]', d: 0.2 },
  { pos: 'right-[-18%] top-[4%]', d: 0.35 },
  { pos: 'left-[-8%] bottom-[8%]', d: 0.5 },
  { pos: 'right-[-14%] bottom-[18%]', d: 0.65 },
]

/**
 * The regulators the pipeline actually reads right now: enabled sources only (switched-off
 * ones like Kerala and Telangana stay out), named by state or authority, curators excluded.
 */
const SOURCES = [
  ...new Map(
    STATIC_SOURCES.filter((s) => s.enabled && s.id !== 'curated').map((s) => {
      const label = s.jurisdiction === 'IN' ? s.authority : (stateName(s.jurisdiction) ?? s.authority)
      return [label, { label, region: s.jurisdiction === 'IN' ? null : s.jurisdiction }] as const
    }),
  ).values(),
]
  .slice(0, SPOTS.length)
  .map((src, i) => ({ ...src, ...SPOTS[i]! }))

/** Step 1: the nazar eye at the centre of pulsing rings, with the regulators it watches. */
export function WatchArt() {
  const { locale } = useT()
  return (
    <div className="relative grid size-56 place-items-center sm:size-64">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute inset-0 rounded-full border-2 border-primary/40"
          initial={{ scale: 0.35, opacity: 0 }}
          animate={{ scale: 1, opacity: [0, 0.7, 0] }}
          transition={{ duration: 3.6, repeat: Infinity, delay: i * 1.2, ease: 'easeOut' }}
        />
      ))}
      <span className="absolute inset-[18%] rounded-full border border-primary/15 bg-primary/5" />
      <motion.div
        className="relative grid size-24 place-items-center rounded-full bg-card ring-1 ring-primary/20"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      >
        <motion.div
          animate={{ scaleY: [1, 1, 0.12, 1, 1] }}
          transition={{ duration: 4.5, repeat: Infinity, times: [0, 0.9, 0.93, 0.96, 1] }}
        >
          <NazarMark className="size-16" />
        </motion.div>
      </motion.div>
      {SOURCES.map((s) => (
        <motion.span
          key={s.label}
          className={cn('absolute rounded-full border bg-card px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-foreground', s.pos)}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1, translateY: [0, -4, 0] }}
          transition={{
            opacity: { delay: s.d, duration: 0.3 },
            scale: { delay: s.d, type: 'spring', stiffness: 300, damping: 18 },
            translateY: { delay: s.d + 0.4, duration: 3, repeat: Infinity, ease: 'easeInOut' },
          }}
        >
          <span className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-primary align-middle" />
          {s.region ? regionName(locale, s.region, s.label) : s.label}
        </motion.span>
      ))}
    </div>
  )
}

/** Step 2: a syrup bottle whose label is scanned until the batch number lights up. */
export function BatchArt() {
  const { t } = useT()
  return (
    <div className="relative flex items-center gap-5 sm:gap-7">
      <motion.svg
        viewBox="0 0 120 200"
        className="h-52 w-auto sm:h-60"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 160, damping: 18 }}
        aria-hidden="true"
      >
        <rect x="42" y="4" width="36" height="22" rx="4" className="fill-primary" />
        <rect x="46" y="26" width="28" height="14" className="fill-card stroke-border" strokeWidth="2" />
        <path d="M46 40 Q24 48 22 70 V184 Q22 196 34 196 H86 Q98 196 98 184 V70 Q96 48 74 40 Z" className="fill-card stroke-border" strokeWidth="2.5" />
        <path d="M24 120 V184 Q24 194 34 194 H86 Q96 194 96 184 V120 Z" className="fill-caution/25" />
        <rect x="28" y="72" width="64" height="78" rx="5" className="fill-background stroke-border" strokeWidth="1.5" />
        <text x="60" y="88" textAnchor="middle" className="fill-foreground text-[9px] font-semibold">Coldrif</text>
        <rect x="36" y="94" width="48" height="3" rx="1.5" className="fill-muted-foreground/30" />
        <rect x="36" y="101" width="34" height="3" rx="1.5" className="fill-muted-foreground/30" />
        <motion.rect
          x="31" y="109" width="58" height="15" rx="3"
          className="fill-primary/12 stroke-primary"
          strokeWidth="1.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0, 1, 1] }}
          transition={{ duration: 3.2, repeat: Infinity, times: [0, 0.45, 0.55, 1] }}
        />
        <text x="60" y="119.5" textAnchor="middle" className="fill-foreground font-mono text-[7px] font-semibold">B.No. SR-13</text>
        <rect x="36" y="130" width="48" height="3" rx="1.5" className="fill-muted-foreground/30" />
        <rect x="36" y="137" width="40" height="3" rx="1.5" className="fill-muted-foreground/30" />
        <motion.rect
          x="26" width="68" height="2" rx="1"
          className="fill-primary"
          initial={{ y: 72, opacity: 0 }}
          animate={{ y: [72, 148, 116], opacity: [0, 1, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, times: [0, 0.4, 0.55], ease: 'easeInOut' }}
        />
      </motion.svg>

      <div className="grid gap-2.5">
        <motion.div
          className="rounded-xl border bg-card px-3.5 py-2.5"
          initial={{ x: -12, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.35 }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hi:text-[11px]">{t('onboarding.art.batchRead')}</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-primary">SR-13</p>
        </motion.div>
        {['B.No.', 'Batch', 'Lot'].map((l, i) => (
          <motion.span
            key={l}
            className="w-fit rounded-md border border-dashed border-primary/40 bg-card/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            initial={{ x: -12, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 + i * 0.12 }}
          >
            {l}
          </motion.span>
        ))}
      </div>
    </div>
  )
}

const STATES: { icon: typeof Search; state: 'flagged' | 'retracted' | 'no_alert' | 'unreadable'; tone: string; tile: string }[] = [
  { icon: TriangleAlert, state: 'flagged', tone: 'text-flagged bg-flagged-soft border-flagged-border', tile: 'bg-flagged text-white dark:text-background' },
  { icon: History, state: 'retracted', tone: 'text-caution bg-caution-soft border-caution-border', tile: 'bg-caution text-white dark:text-background' },
  { icon: Search, state: 'no_alert', tone: 'text-quiet bg-quiet-soft border-quiet-border', tile: 'bg-quiet text-white dark:text-background' },
  { icon: CircleHelp, state: 'unreadable', tone: 'text-caution bg-caution-soft border-caution-border', tile: 'bg-caution text-white dark:text-background' },
]

/** Step 3: the four result states, with a highlight that walks through them. */
export function StatesArt() {
  const { t } = useT()
  const [active, setActive] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % STATES.length), 1700)
    return () => clearInterval(id)
  }, [])

  return (
    <ul className="grid w-full max-w-80 gap-2.5">
      {STATES.map(({ icon: Icon, state, tone, tile }, i) => (
        <motion.li
          key={state}
          className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-[box-shadow,opacity] duration-300', tone, active === i ? 'opacity-100 ring-2 ring-current/30' : 'opacity-75')}
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1, scale: active === i ? 1.03 : 1 }}
          transition={{ delay: i * 0.08, type: 'spring', stiffness: 260, damping: 22 }}
        >
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', tile)}>
            <Icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight">{t(`state.${state}`)}</span>
            <span className="block truncate text-xs text-muted-foreground">{t(`onboarding.art.${state}`)}</span>
          </span>
        </motion.li>
      ))}
    </ul>
  )
}

function Node({ icon: Icon, title, sub, delay }: { icon: React.ComponentType<{ className?: string }>; title: string; sub: string; delay: number }) {
  return (
    <motion.div
      className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5"
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 22 }}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{title}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{sub}</span>
      </span>
    </motion.div>
  )
}

function Link({ delay }: { delay: number }) {
  return (
    <div className="relative mx-auto h-5 w-px overflow-hidden bg-primary/20">
      <motion.span
        className="absolute inset-x-0 h-2 bg-primary"
        initial={{ y: -8 }}
        animate={{ y: 20 }}
        transition={{ delay, duration: 1.1, repeat: Infinity, ease: 'linear', repeatDelay: 0.6 }}
      />
    </div>
  )
}

/** Step 4: the chain of proof from notice to public record, and the phone that keeps your checks. */
export function ProofArt() {
  const { t } = useT()
  return (
    <div className="grid w-full max-w-80 gap-0">
      <Node icon={FileText} title={t('onboarding.art.notice')} sub="CDSCO · TN DC · PDF" delay={0.05} />
      <Link delay={0.3} />
      <Node icon={Hash} title={t('onboarding.art.fingerprinted')} sub="sha256 9f2c…a71e" delay={0.2} />
      <Link delay={0.6} />
      <Node icon={NazarIcon} title={t('onboarding.art.record')} sub="entity 0x4be1…09dc" delay={0.35} />
      <motion.div
        className="mt-3 flex items-center gap-2 self-center rounded-full border border-dashed bg-card/70 px-3 py-1.5 text-xs text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
      >
        <Smartphone className="size-3.5" />
        {t('onboarding.art.device')}
        <Lock className="size-3.5 text-primary" />
      </motion.div>
    </div>
  )
}

function NazarIcon({ className }: { className?: string }) {
  return <NazarMark className={cn('size-6', className)} />
}
