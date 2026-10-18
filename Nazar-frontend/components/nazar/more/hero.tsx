'use client'

import Link from 'next/link'
import { ArrowDown, ArrowUpRight, Database, Fingerprint, Landmark } from 'lucide-react'

import { SentinelEye } from '@/components/ui/sentinel-core'
import { timeAgo } from '@/components/nazar/status-pill'
import { serif } from '@/lib/fonts'
import { checkPath } from '@/lib/share'
import { explorerAddress, PUBLISHER, type SourceList } from '@/lib/source'
import type { ArkivSummary } from '@/lib/source/directory'
import { cn } from '@/lib/utils'
import { STORY } from './scenes'
import { istClock } from './shared'

// The top of /more: one headline, one plain promise, the sentinel eye, and three live facts.
// The numbers are read the way the rest of the app reads them (sources from the API or the
// built-in list, counts from the Arkiv summary). A number Nazar cannot read is never invented:
// the cell says where to look instead.

export type SummaryState = { kind: 'loading' } | { kind: 'ok'; data: ArkivSummary } | { kind: 'none' }

const nf = new Intl.NumberFormat('en-IN')
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

function Stat({ Icon, value, label, sub, stat, busy }: { Icon: typeof Landmark; value: React.ReactNode; label: string; sub: React.ReactNode; stat: string; busy?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b px-5 py-3.5 last:border-b-0 sm:items-start sm:border-r sm:border-b-0 sm:p-5 sm:last:border-r-0" data-stat={stat} aria-busy={busy || undefined}>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-lg leading-tight font-semibold tracking-tight tabular-nums" data-stat-value>
            {busy ? <span className="inline-block h-4 w-10 animate-pulse rounded bg-muted align-middle motion-reduce:animate-none" /> : value}
          </span>
          <span className="text-[13px] font-medium">{label}</span>
        </p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{sub}</p>
      </div>
    </div>
  )
}

export function Hero({ sources, summary, now }: { sources: SourceList | null; summary: SummaryState; now: number }) {
  // Regulator feeds only: Nazar's own curated list is not a regulator.
  const on = sources?.items.filter((s) => s.enabled && s.id !== 'curated').length ?? 0
  const counted = summary.kind === 'ok' ? Date.parse(summary.data.generatedAt) : NaN
  return (
    <section
      className="relative overflow-hidden rounded-3xl border bg-card"
      style={{ backgroundImage: 'radial-gradient(110% 80% at 85% 0%, color-mix(in srgb, var(--primary) 10%, transparent), transparent 62%)' }}
      aria-labelledby="more-hero-title"
      data-more-hero
    >
      <div className="grid items-center gap-6 px-5 pt-7 pb-8 sm:px-8 sm:pt-10 sm:pb-10 md:grid-cols-[minmax(0,1fr)_13rem] lg:px-10">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-3 text-xs tracking-[0.12em] text-muted-foreground uppercase">
              <span className="h-px w-7 bg-current opacity-70" aria-hidden="true" /> How it works
            </p>
            <span className="-my-3 block w-16 md:hidden">
              <SentinelEye state="idle" className="w-full" />
            </span>
          </div>
          <h1 id="more-hero-title" className="mt-4 text-[clamp(2.25rem,7vw,3.6rem)] leading-[0.98] font-medium tracking-[-0.045em] text-balance">
            How Nazar works, <span className={cn(serif.className, 'font-normal tracking-[-0.02em] text-primary')}>and how to check it.</span>
          </h1>
          <p className="mt-5 max-w-[52ch] text-base leading-7 text-pretty text-muted-foreground">
            Nazar only repeats what regulators publish. Follow one real alert from a WHO notice to your phone, then verify every step without trusting us.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a href="#how" className="inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-transform hover:-translate-y-px motion-reduce:transition-none" data-hero-follow>
              Follow one alert <ArrowDown className="size-4" aria-hidden="true" />
            </a>
            <Link href={checkPath(STORY.batch)} className="inline-flex min-h-11 items-center gap-1.5 border-b border-foreground/30 text-sm font-medium hover:border-foreground">
              Check {STORY.batch} yourself <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="hidden justify-items-center md:grid">
          <SentinelEye state="idle" className="w-52" />
          <p className={cn(serif.className, 'mt-1 text-lg text-muted-foreground')}>Har batch par nazar</p>
          <p className="text-[11px] tracking-wide text-muted-foreground">An eye on every batch</p>
        </div>
      </div>

      <div className="grid border-t bg-card/70 sm:grid-cols-3" data-hero-stats>
        <Stat
          stat="sources"
          Icon={Landmark}
          busy={!sources}
          value={on}
          label={on === 1 ? 'regulator source on' : 'regulator sources on'}
          sub={sources?.source === 'api' ? 'Live from the Nazar API' : 'From the built-in list'}
        />
        {summary.kind === 'none' ? (
          <Stat
            stat="alerts"
            Icon={Database}
            value="Public"
            label="on Arkiv"
            sub={
              <Link href="/arkiv" className="font-medium text-primary underline-offset-2 hover:underline">
                Count the alerts yourself
              </Link>
            }
          />
        ) : (
          <Stat
            stat="alerts"
            Icon={Database}
            busy={summary.kind === 'loading'}
            value={summary.kind === 'ok' ? nf.format(summary.data.alerts.total) : null}
            label="alerts on Arkiv"
            sub={summary.kind === 'ok' && Number.isFinite(counted) ? <span title={istClock(counted)}>Counted {timeAgo(counted, now || Date.now())}</span> : 'Reading Arkiv…'}
          />
        )}
        <Stat
          stat="publisher"
          Icon={Fingerprint}
          value={<span className="font-mono text-[15px]">{short(PUBLISHER)}</span>}
          label=""
          sub={
            <a href={explorerAddress(PUBLISHER)} target="_blank" rel="noreferrer noopener" className="-my-3 inline-flex min-h-11 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline">
              One wallet signs every alert <ArrowUpRight className="size-3" aria-hidden="true" />
            </a>
          }
        />
      </div>
    </section>
  )
}
