'use client'

import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { currentSnapshot, onSnapshot, type PipelineStatus } from '@/lib/source'
import { translate, useT, type Locale, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** The worker renews its heartbeat every 5 minutes; after 20 it is considered stopped. */
const LIVE_WINDOW_MS = 20 * 60 * 1000

/** "4 min ago" / "4 मिनट पहले". English unless a locale is passed (callers outside the translated surfaces stay English). */
export function timeAgo(ms: number, now = Date.now(), locale: Locale = 'en') {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return translate(locale, 'time.justNow')
  const m = Math.round(s / 60)
  if (m < 60) return translate(locale, 'time.minAgo', { n: m })
  const h = Math.round(m / 60)
  if (h < 48) return translate(locale, 'time.hAgo', { n: h })
  return translate(locale, 'time.dAgo', { n: Math.round(h / 24) })
}

function describe(status: PipelineStatus, now: number, savedAt: Date | null, locale: Locale) {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars)
  const ago = (ms: number) => timeAgo(ms, now, locale)
  switch (status.kind) {
    case 'checking':
      return { live: false, short: t('status.connecting.short'), long: t('status.connecting.long'), tip: t('status.connecting.tip') }
    case 'api':
    case 'arkiv': {
      const via = status.kind === 'api' ? 'Nazar API' : 'Arkiv'
      if (status.lastOkMs === null) {
        return {
          live: false,
          short: t('status.idle'),
          long: status.kind === 'api' ? t('status.apiNoRun') : t('status.arkivPaused'),
          tip: t('status.noReportTip', { via }),
        }
      }
      const fresh = now - status.lastOkMs < LIVE_WINDOW_MS
      return {
        live: fresh,
        short: fresh ? t('status.live') : t('status.idle'),
        long: fresh ? t('status.liveLong', { ago: ago(status.lastOkMs) }) : t('status.idleLong', { ago: ago(status.lastOkMs) }),
        tip: t('status.heartbeatTip', { via }),
      }
    }
    case 'offline':
      if (savedAt) {
        return {
          live: false,
          short: t('status.saved.short'),
          long: t('status.saved.long'),
          tip: t('status.saved.tip', { ago: ago(savedAt.getTime()) }),
        }
      }
      return {
        live: false,
        short: t('status.offline.short'),
        long: t('status.offline.long'),
        tip: t('status.offline.tip'),
      }
  }
}

export function StatusPill({ status }: { status: PipelineStatus }) {
  const { t, locale } = useT()
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
  const d = describe(status, now, savedAt, locale)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            data-status={status.kind}
            aria-label={t('status.aria', { text: d.long })}
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
