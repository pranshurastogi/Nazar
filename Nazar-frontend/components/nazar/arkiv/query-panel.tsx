'use client'

import { useState } from 'react'
import { ChevronDown, Code2, Copy, Globe, Server, Terminal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { copy } from '@/components/nazar/result-card'
import { cn } from '@/lib/utils'

// "How it works": the exact Arkiv query the current filters produce, as the node parses it
// and as a TypeScript program, plus where it runs: through the Nazar API or straight from
// this browser to the public Arkiv RPC (no Nazar server involved).

export type RunMode = 'api' | 'browser'

export function QueryPanel({
  query,
  sdk,
  mode,
  onMode,
  apiAvailable,
  meta,
}: {
  query: string
  sdk: string
  mode: RunMode
  onMode: (m: RunMode) => void
  apiAvailable: boolean
  meta: string | null
}) {
  const [tab, setTab] = useState<'query' | 'sdk'>('query')
  // Folded on phones (the entities matter more there); always open from lg up.
  const [open, setOpen] = useState(false)
  const text = tab === 'query' ? query : sdk
  return (
    <section aria-labelledby="live-query-title" className="min-w-0 overflow-hidden rounded-2xl border bg-card" data-query-panel data-query={query}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.16em] text-primary uppercase">How it works</p>
          <h2 id="live-query-title" className="text-base font-semibold tracking-tight">Live Arkiv query</h2>
        </div>
        <Button
          variant="outline"
          className="h-10 rounded-xl px-3 text-xs lg:hidden"
          aria-expanded={open}
          aria-controls="query-body"
          onClick={() => setOpen((o) => !o)}
          data-query-toggle
        >
          {open ? 'Hide query' : 'Show query'} <ChevronDown className={cn('transition-transform', open && 'rotate-180')} data-icon="inline-end" />
        </Button>
        <div role="radiogroup" aria-label="Where the query runs" className="flex rounded-xl border bg-muted/50 p-1">
          {(
            [
              { m: 'api', label: 'Via Nazar API', Icon: Server },
              { m: 'browser', label: 'From my browser', Icon: Globe },
            ] as const
          ).map(({ m, label, Icon }) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              data-mode={m}
              disabled={m === 'api' && !apiAvailable}
              onClick={() => onMode(m)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-muted-foreground transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
                mode === m && 'bg-card text-foreground shadow-sm',
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
      </div>
      <div id="query-body" className={cn(!open && 'max-lg:hidden')}>
      <p className="px-4 pt-3 text-xs leading-5 text-muted-foreground sm:px-5" data-mode-note>
        {mode === 'browser'
          ? 'Your browser sends this query to the public Arkiv RPC itself. No Nazar server is involved, which is the point: the data does not need us.'
          : 'The Nazar API runs this exact query against Arkiv for you, caches it for a minute and returns the same entities.'}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2 px-4 sm:px-5">
        <div role="tablist" aria-label="Query format" className="flex gap-1">
          {(
            [
              { t: 'query', label: 'Query string', Icon: Terminal },
              { t: 'sdk', label: 'TypeScript SDK', Icon: Code2 },
            ] as const
          ).map(({ t, label, Icon }) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`qtab-${t}`}
              aria-selected={tab === t}
              aria-controls="qpanel"
              onClick={() => setTab(t)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                tab === t && 'bg-primary/10 text-primary hover:text-primary',
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <Button variant="ghost" className="h-11 px-3 text-xs" onClick={() => copy(text, tab === 'query' ? 'Query' : 'SDK snippet')} aria-label={tab === 'query' ? 'Copy query string' : 'Copy SDK snippet'}>
          <Copy /> Copy
        </Button>
      </div>
      <div id="qpanel" role="tabpanel" aria-labelledby={`qtab-${tab}`} className="mx-4 mt-2 mb-4 overflow-hidden rounded-xl border bg-muted/40 sm:mx-5">
        <pre tabIndex={0} aria-label={tab === 'query' ? 'Arkiv query string' : 'Arkiv SDK snippet'} className={cn('max-h-72 overflow-auto p-3 font-mono text-[11.5px] leading-5', tab === 'query' && 'whitespace-pre-wrap break-all')}>
          <code data-query-string={tab === 'query' ? '' : undefined} data-sdk-snippet={tab === 'sdk' ? '' : undefined}>
            {tab === 'query' ? query.split(' AND ').map((part, i) => (
              <span key={i} className="block">
                {i > 0 && <span className="text-primary">AND </span>}
                {part}
              </span>
            )) : text}
          </code>
        </pre>
      </div>
      {meta && <p className="border-t px-4 py-2.5 font-mono text-[11px] text-muted-foreground sm:px-5" data-query-meta aria-live="polite">{meta}</p>}
      </div>
    </section>
  )
}
