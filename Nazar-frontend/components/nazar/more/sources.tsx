'use client'

import Link from 'next/link'
import { ArrowRight, ExternalLink, ListChecks } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { timeAgo } from '@/components/nazar/status-pill'
import { stateName, type SourceList } from '@/lib/source'
import { cn } from '@/lib/utils'
import { istClock, panel, Section } from './shared'

/** The regulators Nazar reads: live from the API with each one's last run, else the built-in list. */
export function Sources({ list, now }: { list: SourceList | null; now: number }) {
  const on = list?.items.filter((s) => s.enabled).length ?? 0
  return (
    <Section
      id="sources"
      kicker="Sources"
      title="Where the alerts come from"
      intro="Only official regulators. Each is re-checked on a schedule, and every alert links back to the document it came from."
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-sources-from={list?.source ?? 'loading'}>
          <span className={cn('size-1.5 rounded-full', list?.source === 'api' ? 'bg-primary' : 'bg-muted-foreground/50')} aria-hidden="true" />
          {!list ? 'Loading sources…' : list.source === 'api' ? 'Live · Nazar API, with each source’s last run' : 'Built-in list · the Nazar API is not reachable, so last runs are not shown'}
        </p>
        {list && (
          <p className="text-xs font-medium text-muted-foreground">
            {on} on · {list.items.length - on} off
          </p>
        )}
      </div>
      <ul className={cn(panel, 'divide-y overflow-hidden')} aria-busy={!list} aria-label="Regulator sources">
        {!list &&
          [0, 1, 2, 3].map((i) => (
            <li key={i} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <span className="grid flex-1 gap-2">
                <span className="block h-3.5 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <span className="block h-3 w-3/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              </span>
            </li>
          ))}
        {list?.items.map((s) => {
          const where = s.jurisdiction === 'IN' ? 'All India' : (stateName(s.jurisdiction.replace('IN-TG', 'IN-TS')) ?? s.jurisdiction)
          return (
            <li key={s.id} className="flex items-start gap-3 px-4 py-4 sm:px-5" data-source-row={s.id} data-enabled={s.enabled}>
              <span
                className={cn('mt-1.5 size-2 shrink-0 rounded-full', s.enabled ? (s.lastRun && !s.lastRun.ok ? 'bg-caution' : 'bg-primary') : 'bg-muted-foreground/40')}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold">{s.authority}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{s.id}</span>
                </p>
                <p className="mt-0.5 max-w-[60ch] text-[13px] leading-5 text-muted-foreground">{s.description}</p>
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="rounded-full border px-2 py-0.5 font-medium text-muted-foreground">{where}</span>
                  {s.enabled ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">On</span>
                  ) : (
                    <span className="rounded-full bg-caution-soft px-2 py-0.5 font-semibold text-caution">Off</span>
                  )}
                  {s.enabled && s.lastRun && (
                    <span className="text-muted-foreground" title={istClock(s.lastRun.lastCheckedMs)}>
                      Last run {timeAgo(s.lastRun.lastCheckedMs, now)}
                      {s.lastRun.ok ? '' : ' · failed, will retry'}
                    </span>
                  )}
                </p>
                {!s.enabled && s.disabledReason && <p className="mt-1.5 text-xs leading-5 text-caution">{s.disabledReason}</p>}
              </div>
              <a
                href={s.homepage}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Open ${s.authority} website`}
                title={`Open ${s.authority} website`}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11 shrink-0 text-muted-foreground')}
              >
                <ExternalLink className="size-4" />
              </a>
            </li>
          )
        })}
      </ul>
      <Link
        href="/sweep"
        className={cn(panel, 'group mt-4 flex items-center gap-4 p-4 transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:p-5')}
        data-sweep-card
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <ListChecks className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Shelf sweep: check a whole stock list against these sources</span>
          <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">For chemists, pharmacies and NGOs. Paste or upload up to 500 batches; the list is processed on your device and exports as CSV.</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
      </Link>
    </Section>
  )
}
