'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Rss } from 'lucide-react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { API_URL } from '@/lib/source'
import { cn } from '@/lib/utils'

// "Subscribe (RSS)": the API serves the alert list as RSS and Atom ({API}/v1/alerts.rss|.atom)
// with the same filters as /v1/alerts. The link follows the Feed's current filters, so a
// reader subscribed to "Serious 4–5 · Made in Tamil Nadu" gets exactly that. Shown only when
// this build has an API; the feed reader then fetches it directly, Nazar never sees who.

export type RssFilters = { minSeverity?: number; peds?: boolean; state?: string; source?: string }

/** The absolute feed URL for these filters (a same-origin proxy path is made absolute). */
export function feedUrl(f: RssFilters, format: 'rss' | 'atom' = 'rss', origin = typeof window === 'undefined' ? '' : window.location.origin): string | null {
  if (!API_URL) return null
  const base = /^https?:\/\//.test(API_URL) ? API_URL : `${origin}${API_URL.startsWith('/') ? '' : '/'}${API_URL}`
  const p = new URLSearchParams()
  if (f.state) p.set('state', f.state)
  if (f.peds) p.set('peds', '1')
  if (f.minSeverity) p.set('minSeverity', String(f.minSeverity))
  if (f.source) p.set('source', f.source)
  const qs = p.toString()
  return `${base}/v1/alerts.${format}${qs ? `?${qs}` : ''}`
}

export function RssToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  if (!API_URL) return null
  return (
    <Button variant="ghost" className="h-11 px-3" aria-expanded={open} aria-controls="feed-rss" onClick={onToggle} data-rss-toggle>
      <Rss /> Subscribe (RSS)
    </Button>
  )
}

export function RssPanel({ filters, following }: { filters: RssFilters; following: string[] }) {
  const [format, setFormat] = useState<'rss' | 'atom'>('rss')
  const [copied, setCopied] = useState(false)
  const url = feedUrl(filters, format)
  useEffect(() => setCopied(false), [url])
  if (!url) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Feed link copied. Paste it into your feed reader.')
    } catch {
      toast.error("Couldn't copy. Select the link and copy it.")
    }
  }

  return (
    <section id="feed-rss" aria-label="Subscribe to these alerts" className="mt-2 rounded-2xl border bg-card p-4 sm:p-5" data-rss-panel>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Follow new alerts in a feed reader</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {following.length ? (
              <>
                This feed follows your filters: <span className="font-medium text-foreground">{following.join(' · ')}</span>.
              </>
            ) : (
              'This feed has every alert. Set filters above to narrow it.'
            )}
          </p>
        </div>
        <div role="group" aria-label="Feed format" className="grid h-11 grid-cols-2 overflow-hidden rounded-xl bg-background text-sm font-semibold ring-1 ring-border ring-inset">
          {(['rss', 'atom'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={format === f}
              onClick={() => setFormat(f)}
              className={cn(
                'px-3.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
                format === f && 'bg-primary/10 text-primary hover:text-primary',
              )}
            >
              {f === 'rss' ? 'RSS' : 'Atom'}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="feed-rss-url" className="sr-only">
          Feed link
        </label>
        <input
          id="feed-rss-url"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          data-rss-url
          className="h-11 w-full min-w-0 shrink-0 rounded-xl border sm:w-auto sm:flex-1 bg-muted/50 px-3 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" className="h-11" onClick={copy} data-rss-copy>
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
          </Button>
          <a href={url} target="_blank" rel="noreferrer noopener" data-rss-open className={cn(buttonVariants({ variant: 'outline' }), 'h-11 gap-1.5 px-2.5')}>
            <ExternalLink /> Open
          </a>
        </div>
      </div>
    </section>
  )
}
