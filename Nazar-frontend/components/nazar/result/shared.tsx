'use client'

import { CircleHelp, Copy, ExternalLink, History, Search, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { buttonVariants } from '@/components/ui/button'
import { type Answerer, type ResultState, type Tier } from '@/lib/source'
import { formatAsOfIn, tNow, useT, type MessageKey } from '@/lib/i18n'
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

/** How an alert was read from its document; the words live in the dictionary (method.*). */
export const METHOD_LABEL: Record<string, MessageKey> = {
  api: 'method.api',
  text: 'method.text',
  ocr: 'method.ocr',
  llm: 'method.llm',
  html: 'method.html',
  curated: 'method.curated',
}

/** Notes on how an alert was matched, by tier (tier.*); auto and curator-only need none. */
export const TIER_KEY: Partial<Record<Tier, MessageKey>> = { machine_read: 'tier.machine_read', drug_level: 'tier.drug_level' }

/** "18 Oct, 4:29 pm IST": always Indian time, as on the share page, whatever the device's zone. */
export const formatAsOf = (d: Date) => formatAsOfIn('en', d)

export const shorten = (v: string) => (v.length > 16 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v)

export async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(tNow('toast.copied', { what }))
  } catch {
    toast(tNow('toast.copyFailed'))
  }
}

export function SeverityPips({ value }: { value: number }) {
  const { t } = useT()
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={t('result.severityOf', { n: value })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('h-2 w-3.5 rounded-full', i <= value ? 'bg-flagged' : 'bg-flagged/15')} />
      ))}
    </span>
  )
}

/** Subtle label naming the source that answered. Never coloured green. */
export function SourceTag({ source, className }: { source: Answerer; className?: string }) {
  const { t } = useT()
  const live = source === 'api' || source === 'arkiv'
  return (
    <span data-source={source} className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <span className={cn('size-1.5 rounded-full', live ? 'bg-primary' : 'bg-muted-foreground/50')} aria-hidden="true" />
      {t(`source.${source}`)}
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
  const { t } = useT()
  const label = t('copy.aria', { what })
  return (
    <button
      onClick={() => copy(value, what)}
      aria-label={label}
      title={label}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-9 text-muted-foreground', className)}
    >
      <Copy className="size-4" />
    </button>
  )
}

/** A shortened hash with copy and (optionally) explorer buttons. */
export function HashValue({ value, what, href, className }: { value: string; what: string; href?: string | null; className?: string }) {
  const { t } = useT()
  return (
    <span className={cn('flex items-center justify-end gap-0.5', className)}>
      <span className="font-mono text-xs" title={value}>{shorten(value)}</span>
      <CopyButton value={value} what={what} />
      {href && <IconLink href={href} label={t('proof.openInExplorer', { what })} />}
    </span>
  )
}
