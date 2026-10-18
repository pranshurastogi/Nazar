'use client'

import { Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { copy } from '@/components/nazar/result-card'
import { cn } from '@/lib/utils'
import type { Snippet } from './data'

// The /ai page's section frame (numbered kicker, title, readable intro) and its code block. The
// rhythm matches /more so the two reference pages read as one family.

export const AI_SECTIONS = [
  { id: 'connect', label: 'How it connects' },
  { id: 'setup', label: 'Set it up' },
  { id: 'tools', label: 'Tools' },
  { id: 'rules', label: 'The rules' },
  { id: 'limits', label: 'Privacy and limits' },
] as const

export type AiSectionId = (typeof AI_SECTIONS)[number]['id']

const num = (id: AiSectionId) => String(AI_SECTIONS.findIndex((s) => s.id === id) + 1).padStart(2, '0')

export function AiSection({ id, kicker, title, intro, children, className }: { id: AiSectionId; kicker: string; title: React.ReactNode; intro?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('scroll-mt-24 py-12 sm:py-16 lg:scroll-mt-8', className)} data-ai-section={id}>
      <header className="max-w-[65ch]">
        <p className="flex items-center gap-2.5 text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
          <span className="font-mono tracking-normal" aria-hidden="true">{num(id)}</span>
          <span className="h-px w-6 bg-primary/40" aria-hidden="true" />
          {kicker}
        </p>
        <h2 id={`${id}-title`} className="mt-3 text-[1.625rem] leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-3xl">
          {title}
        </h2>
        {intro && <p className="mt-3 text-[15px] leading-7 text-pretty text-muted-foreground">{intro}</p>}
      </header>
      <div className="mt-7 sm:mt-8">{children}</div>
    </section>
  )
}

export function CodeBlock({ s, className }: { s: Snippet; className?: string }) {
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-2xl border bg-card', className)} data-mcp-snippet>
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 py-1 pr-1.5 pl-4">
        <p className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
          {s.title}
          {s.file && <code className="ml-1.5 font-mono font-medium text-foreground">{s.file}</code>}
        </p>
        <Button variant="ghost" className="h-11 shrink-0 px-3 text-xs" onClick={() => copy(s.code, s.label)} aria-label={`Copy ${s.label}`} data-mcp-copy>
          <Copy /> Copy
        </Button>
      </div>
      <pre className={cn('overflow-x-auto p-4 font-mono text-[12px] leading-5', s.wrap && 'break-all whitespace-pre-wrap')} tabIndex={0} aria-label={s.file ? `${s.title} ${s.file}` : s.label}>
        <code>{s.code}</code>
      </pre>
    </div>
  )
}
