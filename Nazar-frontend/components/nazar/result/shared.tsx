'use client'

import { CircleHelp, Copy, ExternalLink, History, Search, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { buttonVariants } from '@/components/ui/button'
import { SOURCE_LABEL, type Answerer, type ResultState } from '@/lib/source'
import { cn } from '@/lib/utils'

// Small pieces shared by the result card, its proof sheet and the on-chain proof module.

/**
 * Per-state styling. `card` is the outer border, `band` the tinted header, `icon` the solid tile and
 * chip, `callout` the calm box that carries the key message. Red flagged, amber retracted and can't
 * tell, slate no alert; never green, and nothing here implies a medicine is fine to use.
 */
export const TONE: Record<
  ResultState,
  { card: string; band: string; icon: string; text: string; callout: string; Icon: typeof Search; label: string }
> = {
  flagged: { card: 'border-flagged-border', band: 'bg-flagged-soft', icon: 'bg-flagged text-white dark:text-background', text: 'text-flagged', callout: 'border-flagged-border bg-flagged-soft/60', Icon: TriangleAlert, label: 'Flagged' },
  retracted: { card: 'border-caution-border', band: 'bg-caution-soft', icon: 'bg-caution text-white dark:text-background', text: 'text-caution', callout: 'border-caution-border bg-caution-soft/60', Icon: History, label: 'Retracted' },
  no_alert: { card: 'border-quiet-border', band: 'bg-quiet-soft', icon: 'bg-quiet text-white dark:text-background', text: 'text-quiet', callout: 'border-quiet-border bg-quiet-soft/60', Icon: Search, label: 'No alert found' },
  unreadable: { card: 'border-caution-border', band: 'bg-caution-soft', icon: 'bg-caution text-white dark:text-background', text: 'text-caution', callout: 'border-caution-border bg-caution-soft/60', Icon: CircleHelp, label: "Can't tell" },
}

export const METHOD_LABEL: Record<string, string> = {
  api: 'Regulator data feed',
  text: 'PDF text layer',
  ocr: 'OCR of a scanned page',
  llm: 'AI-assisted read, checked against the source',
  html: 'Regulator web page',
  curated: 'Entered by a curator',
}

/** "18 Oct, 4:29 pm IST": always Indian time, as on the share page, whatever the device's zone. */
export const formatAsOf = (d: Date) =>
  `${d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST`

export const shorten = (v: string) => (v.length > 16 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v)

export async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${what} copied`)
  } catch {
    toast(`Couldn't copy. Long-press to select it instead.`)
  }
}

export function SeverityPips({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`Severity ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('h-2 w-3.5 rounded-full', i <= value ? 'bg-flagged' : 'bg-flagged/15')} />
      ))}
    </span>
  )
}

/** Subtle label naming the source that answered. Never coloured green. */
export function SourceTag({ source, className }: { source: Answerer; className?: string }) {
  const live = source === 'api' || source === 'arkiv'
  return (
    <span data-source={source} className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <span className={cn('size-1.5 rounded-full', live ? 'bg-primary' : 'bg-muted-foreground/50')} aria-hidden="true" />
      {SOURCE_LABEL[source]}
    </span>
  )
}

export function IconLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      title={label}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-9 text-muted-foreground', className)}
    >
      <ExternalLink className="size-4" />
    </a>
  )
}

export function CopyButton({ value, what, className }: { value: string; what: string; className?: string }) {
  return (
    <button
      onClick={() => copy(value, what)}
      aria-label={`Copy ${what}`}
      title={`Copy ${what}`}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-9 text-muted-foreground', className)}
    >
      <Copy className="size-4" />
    </button>
  )
}

/** A shortened hash with copy and (optionally) explorer buttons. */
export function HashValue({ value, what, href, className }: { value: string; what: string; href?: string | null; className?: string }) {
  return (
    <span className={cn('flex items-center justify-end gap-0.5', className)}>
      <span className="font-mono text-xs" title={value}>{shorten(value)}</span>
      <CopyButton value={value} what={what} />
      {href && <IconLink href={href} label={`Open ${what} in the Arkiv explorer`} />}
    </span>
  )
}
