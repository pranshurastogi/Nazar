'use client'

import { Copy } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Building blocks shared by the sections of /more: one section frame, so every section has the
// same rhythm (kicker, title, a readable intro, then content), and the small icon button.

export const REPO = 'https://github.com/pranshurastogi/Nazar'
export const SCHEMA = `${REPO}/blob/main/arkiv/schema.md`

export const SECTIONS = [
  { id: 'how', label: 'How it works' },
  { id: 'sources', label: 'Sources' },
  { id: 'proof', label: 'Proof on Arkiv' },
  { id: 'mcp', label: 'AI assistants' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'settings', label: 'Settings' },
  { id: 'about', label: 'About' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

/** "02": the section's place on the page, shared by the kicker and the table of contents. */
export const sectionNumber = (id: SectionId) => String(SECTIONS.findIndex((s) => s.id === id) + 1).padStart(2, '0')

/** Prose width: about 65 characters a line at the body size. */
export const PROSE = 'max-w-[65ch]'

export function Section({
  id,
  kicker,
  title,
  intro,
  children,
  className,
}: {
  id: SectionId
  kicker: string
  title: React.ReactNode
  intro?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('scroll-mt-24 py-12 sm:py-16 lg:scroll-mt-8', className)} data-more-section={id}>
      <header className={PROSE}>
        <p className="flex items-center gap-2.5 text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
          <span className="font-mono tracking-normal text-primary/70" aria-hidden="true">{sectionNumber(id)}</span>
          <span className="h-px w-6 bg-primary/40" aria-hidden="true" />
          {kicker}
        </p>
        <h3 id={`${id}-title`} className="mt-3 text-[1.625rem] leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-3xl">
          {title}
        </h3>
        {intro && <p className="mt-3 text-[15px] leading-7 text-pretty text-muted-foreground">{intro}</p>}
      </header>
      <div className="mt-7 sm:mt-8">{children}</div>
    </section>
  )
}

export function IconButton({ label, onClick, icon: Icon = Copy }: { label: string; onClick: () => void; icon?: typeof Copy }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-11 shrink-0 rounded-xl text-muted-foreground')}>
      <Icon className="size-4" />
    </button>
  )
}

/** A quiet card used inside sections. */
export const panel = 'rounded-2xl border bg-card'
