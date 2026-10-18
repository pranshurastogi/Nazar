'use client'

import { useSyncExternalStore } from 'react'
import { CircleHelp, History, LoaderCircle, Search, TriangleAlert } from 'lucide-react'

import type { ResultState } from '@/lib/source/types'
import { itemState, STATE_TEXT, type SweepItem } from '@/lib/sweep'
import { cn } from '@/lib/utils'

// Pieces shared by the sweep's summary, table, cards and print sheet. Colour carries meaning only:
// red flagged, amber retracted and can't tell, slate no alert (never green).

export const STATE_TONE: Record<ResultState, { chip: string; dot: string; Icon: typeof Search }> = {
  flagged: { chip: 'border-flagged-border bg-flagged-soft text-flagged', dot: 'bg-flagged', Icon: TriangleAlert },
  retracted: { chip: 'border-caution-border bg-caution-soft text-caution', dot: 'bg-caution', Icon: History },
  unreadable: { chip: 'border-caution-border bg-caution-soft text-caution', dot: 'bg-caution', Icon: CircleHelp },
  no_alert: { chip: 'border-quiet-border bg-quiet-soft text-quiet', dot: 'bg-quiet', Icon: Search },
}

/** The row's verdict as a small chip; a pending row says it is checking. */
export function StateChip({ item, className }: { item: SweepItem; className?: string }) {
  const s = itemState(item)
  if (!s || (item.confirming && !item.result)) {
    return (
      <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border bg-muted/60 px-2 text-[11px] font-semibold whitespace-nowrap text-muted-foreground', className)}>
        <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Checking
      </span>
    )
  }
  const t = STATE_TONE[s]
  const label = STATE_TEXT[s].replace("'", '’')
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-bold whitespace-nowrap', t.chip, className)} data-chip-state={s}>
      <t.Icon className="size-3" aria-hidden="true" /> {label}
    </span>
  )
}

const WIDE = '(min-width: 768px)'
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(WIDE)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

/** True from md up: the results are a table there and cards below it (only one is rendered). */
export const useWide = () => useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => true)

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
