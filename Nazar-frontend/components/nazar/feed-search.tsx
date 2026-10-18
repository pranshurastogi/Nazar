'use client'

import { Fragment, useMemo } from 'react'
import Link from 'next/link'
import { ArrowRight, Search, X } from 'lucide-react'

import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// The Alerts page's search: a box at the top of the list, the words it matched highlighted in
// each row, and an offer to check the query as a batch when it looks like one.

/** Lowercase, accents folded, the same way the search compares words. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch)

/**
 * Marks the parts of `text` where a word starts with one of `terms` (the search is prefix-based,
 * so "sres" lights up "Sres" in "Sresan"). Plain text when nothing matches.
 */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => {
    if (!terms.length || !text) return null
    // Folding can change length (é → e + accent, then dropped), so fold character by character
    // and keep a map back to the original positions.
    let folded = ''
    const at: number[] = []
    for (let i = 0; i < text.length; i++) {
      const f = fold(text[i])
      for (let k = 0; k < f.length; k++) at.push(i)
      folded += f
    }
    const ranges: [number, number][] = []
    for (let i = 0; i < folded.length; i++) {
      if (isWordChar(folded[i - 1]) || !isWordChar(folded[i])) continue
      let best = 0
      for (const t of terms) if (t.length > best && folded.startsWith(t, i)) best = t.length
      if (!best) continue
      const start = at[i]
      const end = (at[i + best - 1] ?? text.length - 1) + 1
      ranges.push([start, end])
      i += best - 1
    }
    if (!ranges.length) return null
    const out: { text: string; hit: boolean }[] = []
    let pos = 0
    for (const [s, e] of ranges) {
      if (s > pos) out.push({ text: text.slice(pos, s), hit: false })
      out.push({ text: text.slice(s, e), hit: true })
      pos = e
    }
    if (pos < text.length) out.push({ text: text.slice(pos), hit: false })
    return out
  }, [text, terms])

  if (!parts) return <>{text}</>
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} data-hl className="rounded-[3px] bg-primary/15 px-px text-inherit ring-1 ring-primary/20 dark:bg-primary/25">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  )
}

/** True when some word of `text` starts with one of `terms`. */
export const mentions = (text: string | null | undefined, terms: string[]) => {
  if (!text || !terms.length) return false
  const words = fold(text).split(/[^\p{L}\p{N}]+/u)
  return terms.some((t) => words.some((w) => w.startsWith(t)))
}

export function FeedSearchBox({ value, onChange, busy }: { value: string; onChange: (v: string) => void; busy: boolean }) {
  const { t } = useT()
  return (
    <section role="search" aria-label={t('feed.searchAria')} className="mt-7">
      <label htmlFor="feed-q" className="mb-1.5 block px-1 text-xs font-semibold text-muted-foreground">
        {t('feed.searchLabel')}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          id="feed-q"
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && value && (e.preventDefault(), onChange(''))}
          placeholder={t('feed.searchPlaceholder')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={100}
          aria-describedby="feed-q-hint"
          aria-busy={busy || undefined}
          data-feed-search
          className={cn(
            'h-14 w-full rounded-2xl border bg-card pr-14 pl-11 text-base font-medium text-foreground shadow-xs outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground/80 hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 [&::-webkit-search-cancel-button]:appearance-none',
            value && 'border-primary/40',
          )}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('feed.searchClear')}
            data-feed-search-clear
            className="absolute top-1/2 right-1.5 grid size-11 -translate-y-1/2 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <X className="size-[18px]" aria-hidden="true" />
          </button>
        )}
      </div>
      <p id="feed-q-hint" className="mt-1.5 px-1 text-xs leading-5 text-muted-foreground">
        {t('feed.searchHint')}
      </p>
    </section>
  )
}

/** "Check this batch": shown when the query looks like a batch number. */
export function CheckBatchOffer({ batch, className }: { batch: string; className?: string }) {
  const { t } = useT()
  return (
    <Link
      href={`/?batch=${encodeURIComponent(batch)}`}
      data-feed-check-batch={batch}
      className={cn(
        'group flex min-h-12 items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-2.5 text-sm transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-primary/10',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="text-muted-foreground">{t('feed.looksLikeBatch')}</span>
        <span className="font-semibold text-primary">
          {t('feed.checkThisBatch')}<span className="font-mono">{batch}</span>
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  )
}
