'use client'

import { Fragment } from 'react'
import { motion } from 'motion/react'
import {
  ArrowRight,
  Baby,
  Bot,
  Check,
  CircleHelp,
  Clock,
  Database,
  Fingerprint,
  Globe,
  Landmark,
  Link2,
  Lock,
  ScanEye,
  X,
} from 'lucide-react'

import { SentinelEye } from '@/components/ui/sentinel-core'
import { SeverityPips } from '@/components/nazar/result/shared'
import { PROJECT, PUBLISHER } from '@/lib/source'
import { DEMO_ALERTS } from '@/lib/source/demo'
import { cn } from '@/lib/utils'

// The six pictures of the journey. Each one shows the same alert, COLDRIF batch SR-13, at one
// step of its life: a line in a WHO notice, a checked row, a case, an Arkiv entity, an answer on
// a phone and three ways to verify it. The story is driven by the record Nazar ships as its
// built-in copy of WHO Medical Product Alert N°5/2025, so every value shown is a real one.
//
// `live` is true inside the sticky stage on desktop: the batch token is a shared layout element
// (layoutId), so it travels from scene to scene. Inline (phones, reduced motion) it is static.

const SR13 = DEMO_ALERTS.find((a) => a.batch === 'SR-13')!
const WHO_ROWS = DEMO_ALERTS.filter((a) => a.sourceId === SR13.sourceId)
const [NOTICE_NO, NOTICE_TITLE] = SR13.notice.split(': ')

export const STORY = {
  batch: SR13.batch,
  key: SR13.batch.toLowerCase().replace(/[^a-z0-9]/g, ''),
  brand: SR13.brand,
  maker: SR13.manufacturer.split(',')[0],
  failure: SR13.failure,
  /** "48.6%": the finding in a few characters. */
  finding: SR13.failure.match(/[\d.]+%/)?.[0] ?? '',
  authority: SR13.authority,
  noticeNo: NOTICE_NO,
  noticeTitle: NOTICE_TITLE,
  noticeDate: SR13.noticeDate,
  noticeUrl: SR13.noticeUrl,
  sha: SR13.sourceSha ?? '',
  rules: SR13.severityRules,
  severity: SR13.severity,
  peds: SR13.peds,
  expiry: SR13.expiry,
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Apr 2027" -> 202704, the exp_ym attribute. */
const ym = (s: string) => {
  const [m, y] = s.split(' ')
  const i = MONTHS.indexOf(m)
  return i >= 0 ? `${y}${String(i + 1).padStart(2, '0')}` : s
}
const shortHex = (h: string, a = 6, b = 4) => (h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h)
const maker = (m: string) => m.split(',')[0]

function Token({ live, children, className }: { live: boolean; children: React.ReactNode; className?: string }) {
  const cls = cn(
    'inline-flex items-center rounded-md bg-primary px-1.5 py-px font-mono text-[11.5px] font-semibold whitespace-nowrap text-primary-foreground shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_16%,transparent)]',
    className,
  )
  if (!live) return <span className={cls}>{children}</span>
  return (
    <motion.span layoutId="hw-token" transition={{ type: 'spring', stiffness: 210, damping: 28 }} className={cls}>
      {children}
    </motion.span>
  )
}

/** Fields that arrive one after another when the scene is live. */
function Stagger({ live, i, children, className }: { live: boolean; i: number; children: React.ReactNode; className?: string }) {
  if (!live) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.18 + i * 0.09, duration: 0.35, ease: 'easeOut' }}>
      {children}
    </motion.div>
  )
}

const label = 'text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase'
const bars = (widths: string[]) => (
  <div className="grid gap-1.5">
    {widths.map((w, i) => (
      <span key={i} className="block h-1.5 rounded-full bg-muted" style={{ width: w }} />
    ))}
  </div>
)

// ---- 1. A regulator publishes a notice

export function NoticeScene({ live }: { live: boolean }) {
  return (
    <div className="relative mx-auto w-full max-w-[19.5rem] rounded-xl border bg-card p-4 shadow-[0_24px_48px_-28px_rgb(10_21_48/0.45)]">
      <div className="flex items-center justify-between gap-2">
        <span className={cn(label, 'flex items-center gap-1.5')}>
          <Landmark className="size-3.5" aria-hidden="true" /> {STORY.authority}
        </span>
        <span className="rounded border border-flagged-border bg-flagged-soft px-1.5 font-mono text-[10px] font-bold text-flagged">PDF</span>
      </div>
      <p className="mt-3 text-[13px] leading-snug font-semibold">{STORY.noticeNo}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
        {STORY.noticeTitle} · {STORY.noticeDate}
      </p>
      <div className="mt-3">{bars(['100%', '94%', '62%'])}</div>
      <table className="mt-3 w-full text-left text-[10.5px]">
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th className="py-1 pr-2 font-semibold">Product</th>
            <th className="py-1 pr-2 font-semibold">Batch</th>
            <th className="py-1 font-semibold">Maker</th>
          </tr>
        </thead>
        <tbody>
          {WHO_ROWS.map((a) => {
            const hit = a.id === SR13.id
            return (
              <tr key={a.id} className={cn('border-b last:border-b-0', hit ? 'bg-primary/[0.07]' : 'text-muted-foreground')}>
                <td className={cn('py-1.5 pr-2', hit && 'font-semibold text-foreground')}>{a.brand}</td>
                <td className="py-1.5 pr-2 font-mono">{hit ? <Token live={live}>{a.batch}</Token> : a.batch}</td>
                <td className="truncate py-1.5">{maker(a.manufacturer).replace(' Pvt Ltd', '')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-3">{bars(['86%', '48%'])}</div>
    </div>
  )
}

// ---- 2. Nazar reads it

export function ReadScene({ live }: { live: boolean }) {
  const fields = [
    { k: 'Product', v: <span className="font-semibold">{STORY.brand}</span> },
    { k: 'Batch', v: <Token live={live}>{STORY.batch}</Token> },
    { k: 'Maker', v: STORY.maker },
    { k: 'Finding', v: `DEG ${STORY.finding} w/v` },
  ]
  return (
    <div className="mx-auto grid w-full max-w-[19.5rem] gap-2.5">
      <div className="relative overflow-hidden rounded-xl border bg-card p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold">{STORY.noticeNo}</p>
            <div className="mt-2 w-40">{bars(['100%', '80%', '90%'])}</div>
          </div>
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
            <ScanEye className="size-6" />
          </span>
        </div>
        <span className="hw-scanwrap pointer-events-none absolute inset-0" aria-hidden="true">
          <span className="block h-px w-full bg-primary shadow-[0_0_14px_3px_color-mix(in_srgb,var(--primary)_45%,transparent)]" />
        </span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[11px]">
        <Fingerprint className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="font-semibold">SHA-256</span>
        <span className="min-w-0 truncate font-mono text-muted-foreground">{shortHex(STORY.sha, 10, 6)}</span>
      </div>
      <div className="rounded-xl border bg-card p-1.5">
        {fields.map((f, i) => (
          <Stagger key={f.k} live={live} i={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px]">
            <span className="w-14 shrink-0 text-muted-foreground">{f.k}</span>
            <span className="min-w-0 flex-1 truncate">{f.v}</span>
            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
            </span>
          </Stagger>
        ))}
        <Stagger live={live} i={fields.length} className="mt-0.5 flex items-center gap-2 rounded-md border-t border-dashed px-2 pt-2 pb-1 text-[11px] text-muted-foreground">
          <span className="grid size-4 shrink-0 place-items-center rounded-full border border-muted-foreground/40">
            <X className="size-2.5" strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">A row with no batch number</span>
          <span className="font-semibold">Rejected</span>
        </Stagger>
      </div>
    </div>
  )
}

// ---- 3. It becomes a case

export function CaseScene({ live }: { live: boolean }) {
  return (
    <div className="mx-auto grid w-full max-w-[19.5rem] gap-2.5">
      <div className="rounded-xl border bg-card p-3.5">
        <p className={label}>Match key</p>
        <div className="mt-2 flex items-center gap-2.5">
          <Token live={live}>{STORY.batch}</Token>
          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <code className="rounded-md border bg-muted px-1.5 py-px font-mono text-[11.5px] font-semibold">{STORY.key}</code>
        </div>
        <p className="mt-2.5 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
          Also finds
          {['SR 13', 'sr-13', 'SR13'].map((v) => (
            <span key={v} className="rounded border px-1 font-mono">{v}</span>
          ))}
        </p>
      </div>
      <div className="rounded-xl border border-caution-border bg-caution-soft p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="flex flex-wrap items-center gap-1 font-mono text-[11.5px] font-semibold">
            <span>5R-13</span>
            <span className="text-muted-foreground">·</span>
            <span>SR-I3</span>
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-caution px-2 py-0.5 text-[10px] font-bold text-white uppercase dark:text-background">
            <CircleHelp className="size-3" aria-hidden="true" /> Can&apos;t tell
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-caution">One character away. Nazar asks you to re-read the pack.</p>
      </div>
      <div className="rounded-xl border bg-card p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className={label}>Severity</p>
          <span className="flex items-center gap-2 text-[11px] font-semibold text-flagged">
            <SeverityPips value={STORY.severity} /> {STORY.severity} of 5
          </span>
        </div>
        <ul className="mt-2 grid gap-1 text-[11px] leading-4 text-muted-foreground">
          {STORY.rules.map((r) => (
            <li key={r} className="flex gap-1.5">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
              {r}
            </li>
          ))}
        </ul>
        {STORY.peds && (
          <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-flagged-border px-2 py-0.5 text-[10.5px] font-semibold text-flagged">
            <Baby className="size-3" aria-hidden="true" /> Child Shield
          </p>
        )}
      </div>
    </div>
  )
}

// ---- 4. It is written to Arkiv

export function ArkivScene({ live }: { live: boolean }) {
  const attrs: [string, React.ReactNode][] = [
    ['project', PROJECT],
    ['t', 'alert'],
    ['batch', <Token key="t" live={live}>{STORY.key}</Token>],
    ['sev', String(STORY.severity)],
    ['src', SR13.sourceId],
    ['peds', STORY.peds ? '1' : '0'],
    ['exp_ym', ym(STORY.expiry)],
  ]
  return (
    <div className="mx-auto w-full max-w-[19.5rem] overflow-hidden rounded-xl border bg-card shadow-[0_24px_48px_-28px_rgb(10_21_48/0.45)]">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3.5 py-2.5">
        <p className="flex items-center gap-1.5 text-[11.5px] font-semibold">
          <Database className="size-3.5 text-primary" aria-hidden="true" /> Arkiv entity
          <span className="rounded bg-primary/10 px-1.5 font-mono text-[10.5px] text-primary">alert</span>
        </p>
        <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" /> read-only
        </span>
      </div>
      <dl className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 px-3.5 py-3 font-mono text-[11px]">
        {attrs.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate">{v}</dd>
          </Fragment>
        ))}
      </dl>
      <div className="grid gap-1.5 border-t px-3.5 py-3 text-[11px]">
        <p className="flex items-center gap-2">
          <Fingerprint className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="text-muted-foreground">Signed by</span>
          <span className="ml-auto font-mono font-medium">{shortHex(PUBLISHER)}</span>
        </p>
        <p className="flex items-center gap-2">
          <Link2 className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="text-muted-foreground">Notice</span>
          <span className="ml-auto font-mono font-medium">sha {shortHex(STORY.sha, 6, 4)}</span>
        </p>
        <p className="flex items-center gap-2">
          <Clock className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="text-muted-foreground">Expires</span>
          <span className="ml-auto font-medium">{STORY.expiry} + 180 days</span>
        </p>
      </div>
    </div>
  )
}

// ---- 5. You check your batch

const LEGEND = [
  { label: 'Flagged', dot: 'bg-flagged' },
  { label: 'Retracted', dot: 'bg-caution' },
  { label: 'No alert found', dot: 'bg-quiet' },
  { label: "Can't tell", dot: 'bg-caution' },
]

export function CheckScene({ live }: { live: boolean }) {
  return (
    <div className="mx-auto grid w-full max-w-[19.5rem] justify-items-center gap-3">
      <div className="w-[15.5rem] rounded-[1.9rem] border-[5px] border-foreground/80 bg-background p-2.5 shadow-[0_28px_50px_-30px_rgb(10_21_48/0.6)]">
        <div className="mx-auto h-1.5 w-14 rounded-full bg-foreground/15" />
        <div className="mt-2.5 rounded-xl border bg-card px-3 py-2">
          <p className="text-[9.5px] font-semibold text-muted-foreground">Batch number</p>
          <div className="mt-1">
            <Token live={live}>{STORY.batch}</Token>
          </div>
        </div>
        <div className="mt-2 rounded-xl border border-flagged-border bg-flagged-soft p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-md bg-flagged px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-white uppercase dark:text-background">Flagged</span>
            <SentinelEye state="flagged" follow={false} className="w-11" />
          </div>
          <p className="mt-1.5 text-[12.5px] leading-snug font-semibold">This batch failed a government quality test</p>
          <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
            {STORY.brand} · {STORY.maker}
          </p>
          <p className="mt-2 border-t border-flagged-border pt-2 text-[10.5px] leading-4">Stop using it and keep the pack.</p>
        </div>
        <p className="mt-2 px-1 text-[9.5px] text-muted-foreground">
          {STORY.authority} · {STORY.noticeDate}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-x-5 gap-y-1">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground">
            <span className={cn('size-2 rounded-full', l.dot)} aria-hidden="true" /> {l.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---- 6. Anyone can verify

export function VerifyScene({ live }: { live: boolean }) {
  const paths = [
    { Icon: Database, title: 'The Arkiv page', line: <>batch = <Token live={live}>{STORY.key}</Token></> },
    { Icon: Globe, title: 'Arkiv explorer', line: <span className="font-mono">address/{shortHex(PUBLISHER)}</span> },
    { Icon: Bot, title: 'Your AI assistant', line: <span className="font-mono">check_batch(&quot;{STORY.batch}&quot;)</span> },
  ]
  return (
    <div className="mx-auto grid w-full max-w-[19.5rem] gap-2">
      {paths.map(({ Icon, title, line }, i) => (
        <Stagger key={title} live={live} i={i} className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold">{title}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{line}</p>
          </div>
        </Stagger>
      ))}
      <div className="mt-1 flex items-center gap-2 px-1">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10.5px] font-semibold text-muted-foreground">Same signed entity, same WHO notice</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}

export const SCENES = [NoticeScene, ReadScene, CaseScene, ArkivScene, CheckScene, VerifyScene]
