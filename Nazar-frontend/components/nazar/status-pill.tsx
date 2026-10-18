'use client'

import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { currentSnapshot, onSnapshot, type PipelineStatus } from '@/lib/source'
import { cn } from '@/lib/utils'

/** The worker renews its heartbeat every 5 minutes; after 20 it is considered stopped. */
const LIVE_WINDOW_MS = 20 * 60 * 1000

export function timeAgo(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

function describe(status: PipelineStatus, now: number, savedAt: Date | null) {
  switch (status.kind) {
    case 'checking':
      return { live: false, short: 'Connecting', long: 'Connecting…', tip: 'Looking for the Nazar API and Arkiv.' }
    case 'api':
    case 'arkiv': {
      const via = status.kind === 'api' ? 'Nazar API' : 'Arkiv'
      if (status.lastOkMs === null) {
        return {
          live: false,
          short: 'Idle',
          long: status.kind === 'api' ? 'API live · no pipeline run yet' : 'Arkiv · pipeline paused',
          tip: `Answers come from ${via}. The pipeline has not reported in recently.`,
        }
      }
      const fresh = now - status.lastOkMs < LIVE_WINDOW_MS
      return {
        live: fresh,
        short: fresh ? 'Live' : 'Idle',
        long: fresh ? `Pipeline live · checked ${timeAgo(status.lastOkMs, now)}` : `Pipeline idle · last run ${timeAgo(status.lastOkMs, now)}`,
        tip: `Heartbeat read from ${via}. Regulator sites are re-checked every few minutes.`,
      }
    }
    case 'offline':
      if (savedAt) {
        return {
          live: false,
          short: 'Saved copy',
          long: 'Live sources down · saved copy',
          tip: `Neither the Nazar API nor Arkiv answered. Checks use Nazar's saved copy of every published alert, from ${timeAgo(savedAt.getTime(), now)}.`,
        }
      }
      return {
        live: false,
        short: 'Offline',
        long: 'Offline · demo data',
        tip: 'Neither the Nazar API nor Arkiv answered. Checks use built-in sample alerts.',
      }
  }
}

export function StatusPill({ status }: { status: PipelineStatus }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  // Whether Nazar's saved copy of the alert set is loaded (on the device or from the site), so an
  // offline status never claims demo data while real alerts are answering. Read after mount.
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  useEffect(() => {
    setSavedAt(currentSnapshot()?.generatedAt ?? null)
    return onSnapshot((s) => setSavedAt(s.generatedAt))
  }, [])
  const d = describe(status, now, savedAt)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            data-status={status.kind}
            aria-label={`Status: ${d.long}`}
            className="h-11 min-w-0 shrink gap-2 rounded-full border-0 bg-card px-3.5 text-xs font-semibold text-muted-foreground shadow-xs ring-1 ring-border ring-inset"
          />
        }
      >
        <span className="relative grid size-2 place-items-center" aria-hidden="true">
          {d.live && <span className="absolute size-2 animate-ping rounded-full bg-primary/40 [animation-duration:2.4s] motion-reduce:hidden" />}
          <span className={cn('size-2 rounded-full', d.live ? 'bg-primary' : status.kind === 'offline' ? 'bg-muted-foreground/50' : 'bg-caution')} />
        </span>
        <span className="truncate sm:hidden">{d.short}</span>
        <span className="hidden truncate sm:inline">{d.long}</span>
      </TooltipTrigger>
      <TooltipContent>{d.tip}</TooltipContent>
    </Tooltip>
  )
}
