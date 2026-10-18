'use client'

import { Copy, ExternalLink } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { copy } from '@/components/nazar/result-card'
import { EXPLORER_URL, SOURCE_NAME, stateName } from '@/lib/source'
import { cn } from '@/lib/utils'

// Small pieces shared by the Arkiv directory's overview, results and entity drawer.

export const explorerEntity = (key: string) => `${EXPLORER_URL}/entity/${key}`

export const shortKey = (k: string) => (k.length > 14 ? `${k.slice(0, 8)}…${k.slice(-6)}` : k)

export const SOURCE_LABEL: Record<string, string> = { ...SOURCE_NAME, curated: 'Curated by Nazar' }
export const sourceLabel = (id: string) => SOURCE_LABEL[id] ?? id

export const CATEGORY_LABEL: Record<string, string> = {
  nsq: 'Not of standard quality',
  spurious: 'Spurious (fake)',
  adulterated: 'Adulterated',
  misbranded: 'Misbranded',
}

export const FAILURE_LABEL: Record<string, string> = {
  assay: 'Assay',
  dissolution: 'Dissolution',
  description: 'Description',
  identification: 'Identification',
  labelling: 'Labelling',
  sterility: 'Sterility',
  particulate: 'Particulate matter',
  disintegration: 'Disintegration',
  uniformity: 'Uniformity',
  spurious: 'Spurious',
  ph: 'pH',
  microbial: 'Microbial',
  related_substances: 'Related substances',
  glycol: 'Toxic glycol (DEG/EG)',
  endotoxin: 'Endotoxin',
  other: 'Other',
}

export const placeName = (code: string) => (code === 'unknown' ? 'State not listed' : (stateName(code) ?? code))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const ym = (v: unknown) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 190001) return null
  const m = n % 100
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${Math.floor(n / 100)}` : null
}

/** "Feb 2027": entity lifetimes are estimates from block times, so a day would be false precision. */
export const monthYear = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

/** The category attribute in plain words ("nsq" → "Not of standard quality"). */
export const categoryLabel = (cat: string) => CATEGORY_LABEL[cat] ?? cat

/** A readable title for an entity: product and batch for an alert, the title for a notice. */
export function entityTitle(type: string, payload: Record<string, unknown>, attr: (name: string) => string | number | null) {
  if (type === 'alert') {
    const product = String(payload.product ?? attr('brand') ?? 'Alert')
    const batch = attr('batch_raw') ?? attr('batch')
    return batch ? `${product} · Batch ${String(batch)}` : product
  }
  if (type === 'notice') return String(payload.title ?? 'Regulator notice')
  if (type === 'heartbeat') return `Pipeline heartbeat · ${String(attr('worker') ?? 'worker')}`
  if (type === 'retraction') return 'Retraction'
  return 'Arkiv entity'
}

export const shortDate = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const nf = (n: number) => n.toLocaleString('en-IN')
/** Block numbers read best as plain digits, the way explorers print them. */
export const blk = (b: string | number | null | undefined) => (b === null || b === undefined || b === '' ? '—' : `#${String(b)}`)

export function Chip({ children, tone = 'muted', title, className }: { children: React.ReactNode; tone?: 'muted' | 'primary' | 'flagged' | 'caution'; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1 truncate rounded-md border px-2 font-mono text-[11px] font-medium',
        tone === 'muted' && 'border-border bg-muted/60 text-foreground/80',
        tone === 'primary' && 'border-primary/25 bg-primary/10 text-primary',
        tone === 'flagged' && 'border-flagged-border bg-flagged-soft text-flagged',
        tone === 'caution' && 'border-caution-border bg-caution-soft text-caution',
        className,
      )}
    >
      {children}
    </span>
  )
}

// 44px: the minimum comfortable touch target
const iconBtn = cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-11 shrink-0 rounded-xl text-muted-foreground')

export function CopyButton({ value, what, className }: { value: string; what: string; className?: string }) {
  return (
    <button type="button" onClick={() => copy(value, what)} aria-label={`Copy ${what.toLowerCase()}`} title={`Copy ${what.toLowerCase()}`} className={cn(iconBtn, className)}>
      <Copy className="size-4" />
    </button>
  )
}

export function ExplorerLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" aria-label={label} title={label} className={cn(iconBtn, className)}>
      <ExternalLink className="size-4" />
    </a>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded bg-muted motion-reduce:animate-none', className)} />
}

export function Panel({ title, kicker, children, className, actions, id }: { title: string; kicker?: string; children: React.ReactNode; className?: string; actions?: React.ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className={cn('rounded-2xl border bg-card p-4 sm:p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {kicker && <p className="text-[11px] font-bold tracking-[0.16em] text-primary uppercase">{kicker}</p>}
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold tracking-tight">{title}</h2>
        </div>
        {actions}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}
