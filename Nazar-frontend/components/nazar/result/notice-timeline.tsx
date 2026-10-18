'use client'

import { ChevronRight } from 'lucide-react'

import type { Alert } from '@/lib/source'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** One batch can be named in several notices (state list, then CDSCO, then WHO). Newest first. */
export function NoticeTimeline({ alerts, onOpen }: { alerts: Alert[]; onOpen: (a: Alert) => void }) {
  const { tp, t } = useT()
  const ordered = [...alerts].sort((a, b) => b.noticeOrder - a.noticeOrder)
  return (
    <div className="border-t bg-card/70 px-5 py-4 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tp('result.timeline', alerts.length)}</p>
      <ol className="mt-2" aria-label={t('result.timelineAria')}>
        {ordered.map((a, i) => (
          <li key={a.id} className="relative pl-6">
            {i < ordered.length - 1 && <span className="absolute top-5 bottom-0 left-[5px] w-px bg-border" aria-hidden="true" />}
            <span
              className={cn('absolute top-[15px] left-0 size-[11px] rounded-full border-2 bg-card', a.retraction ? 'border-caution' : 'border-flagged')}
              aria-hidden="true"
            />
            <button onClick={() => onOpen(a)} className="flex min-h-12 w-full items-center gap-3 py-2 text-left">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{a.authority}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {a.noticeDate} · {a.notice}
                  {a.retraction ? t('result.withdrawn') : ''}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
