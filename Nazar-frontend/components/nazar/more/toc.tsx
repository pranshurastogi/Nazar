'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { SECTIONS, sectionNumber, type SectionId } from './shared'

// "On this page": a sticky rail beside the reference sections on desktop, and a sticky,
// horizontally scrolling chip row on phones. Both mark the section you are reading.

/** The section whose top has passed 30% of the screen height. */
export function useActiveSection(): SectionId {
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id)
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const line = window.innerHeight * 0.3
      let current: SectionId = SECTIONS[0].id
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= line) current = s.id
      }
      // At the very bottom the last section is current even if it is short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1].id
      setActive(current)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])
  return active
}

export function TocRail({ active }: { active: SectionId }) {
  return (
    <nav aria-label="On this page" className="sticky top-8 hidden lg:block" data-toc="rail">
      <p className="text-[11px] font-bold tracking-[0.16em] text-muted-foreground uppercase">On this page</p>
      <ol className="mt-4 grid border-l">
        {SECTIONS.map((s) => {
          const on = s.id === active
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={on ? 'location' : undefined}
                className={cn(
                  '-ml-px flex min-h-10 items-center gap-3 border-l-2 border-transparent pl-4 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  on && 'border-primary font-semibold text-foreground',
                )}
              >
                <span className={cn('font-mono text-[11px]', on ? 'text-primary' : 'text-muted-foreground/70')}>{sectionNumber(s.id)}</span>
                {s.label}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function TocChips({ active }: { active: SectionId }) {
  const rowRef = useRef<HTMLOListElement>(null)
  // Keep the current chip in view inside the row, without scrolling the page.
  useEffect(() => {
    const row = rowRef.current
    const chip = row?.querySelector<HTMLElement>(`[data-toc-chip="${active}"]`)
    if (!row || !chip) return
    const left = chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2
    row.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [active])

  return (
    <nav aria-label="On this page" className="sticky top-0 z-20 -mx-4 mt-4 border-b bg-background/90 backdrop-blur-lg sm:-mx-6 lg:hidden" data-toc="chips">
      <ol ref={rowRef} className="flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
        {SECTIONS.map((s) => {
          const on = s.id === active
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                data-toc-chip={s.id}
                aria-current={on ? 'location' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  on && 'border-primary/30 bg-primary/10 text-primary',
                )}
              >
                {s.label}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
