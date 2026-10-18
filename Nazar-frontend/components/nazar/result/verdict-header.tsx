import { ScanText } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { TIER_NOTE, type Alert, type CheckResult } from '@/lib/source'
import { cn } from '@/lib/utils'
import { formatAsOf, SeverityPips, TONE } from './shared'

const HEADLINE = {
  flagged: () => 'This batch failed a government quality test',
  retracted: () => 'An alert on this batch was withdrawn',
  no_alert: (asOf: Date) => `No official alert for this batch as of ${formatAsOf(asOf)}`,
  unreadable: () => "We couldn't read the batch number clearly",
} as const

/** The headline. A look-alike is typed, not unreadable, so it asks instead; it is never a flag. */
function headline(result: CheckResult) {
  if (result.state === 'unreadable' && result.suggestion) return `Did you mean ${result.suggestion}?`
  return HEADLINE[result.state](result.asOf)
}

/** Icon, state badge, headline and the product line. Colour, icon and words always agree. */
export function VerdictHeader({ result, alert }: { result: CheckResult; alert?: Alert }) {
  const tone = TONE[result.state]
  const tierNote = alert ? TIER_NOTE[alert.tier] : undefined
  return (
    <div className="flex gap-4 p-5 sm:p-6">
      <div className={cn('grid size-12 shrink-0 place-items-center rounded-xl', tone.icon)}>
        <tone.Icon className="size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={cn('h-6 px-2.5 text-[11px] font-bold uppercase tracking-wider', tone.icon)}>{tone.label}</Badge>
          {alert && result.state === 'flagged' && <SeverityPips value={alert.severity} />}
        </div>
        <h3 className="mt-2.5 text-xl font-semibold leading-snug tracking-tight text-balance" data-verdict-headline>{headline(result)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {alert ? `${alert.brand} · ${alert.manufacturer} · ` : ''}Batch <span className="font-mono font-semibold text-foreground">{result.batch || '—'}</span>
        </p>
        {tierNote && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-caution">
            <ScanText className="size-3.5" /> {tierNote}
          </p>
        )}
      </div>
    </div>
  )
}
