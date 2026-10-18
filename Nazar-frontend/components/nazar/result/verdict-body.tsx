import { Info, History } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { matchKey, type Alert, type CheckResult } from '@/lib/source'
import { cn } from '@/lib/utils'
import { TONE } from './shared'
import { SeverityWhy } from './severity-why'
import { WhatToDo } from './what-to-do'

/** How far a typed batch is from its look-alike, in words. Both fold to the same confusion key. */
function distance(typed: string, other: string) {
  const a = matchKey(typed)
  const b = matchKey(other)
  if (a.length !== b.length) return 'it looks very like'
  const n = [...a].filter((c, i) => c !== b[i]).length
  return n === 1 ? 'it is one character away from' : 'it looks very like'
}

/** A calm, tinted box for the one thing to take away: icon, a bold lead, then the quieter rest. */
function Callout({ result, icon: Icon = Info, children }: { result: CheckResult; icon?: typeof Info; children: React.ReactNode }) {
  const tone = TONE[result.state]
  return (
    <div className={cn('flex max-w-prose items-start gap-3 rounded-xl border p-3.5 text-sm leading-6', tone.callout)} data-key-message>
      <Icon className={cn('mt-1 size-4 shrink-0', tone.text)} aria-hidden="true" />
      <p className="min-w-0 text-pretty">{children}</p>
    </div>
  )
}

/** The state's key message, under the band: what to do first, or what this answer does and does not mean. */
export function VerdictBody({ result, alert, onCheck }: { result: CheckResult; alert?: Alert; onCheck: (batch: string) => void }) {
  return (
    <div className="px-5 pt-5 pb-4 sm:px-6">
      {result.state === 'flagged' && alert && (
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
          <WhatToDo />
          <SeverityWhy alert={alert} />
        </div>
      )}
      {result.state === 'retracted' && alert?.retraction && (
        <Callout result={result} icon={History}>
          <span className="font-semibold">{alert.retraction.reason}.</span>{' '}
          <span className="text-muted-foreground">
            {alert.retraction.authority}
            {alert.retraction.date ? `, ${alert.retraction.date}` : ''}. The original alert stays on record.
          </span>
        </Callout>
      )}
      {result.state === 'no_alert' && (
        <Callout result={result}>
          <span className="font-semibold">This is not a safety certificate.</span>{' '}
          <span className="text-muted-foreground">It only means no regulator has published an alert for this batch yet.</span>
        </Callout>
      )}
      {result.state === 'unreadable' &&
        (result.suggestion ? (
          // A look-alike is never a flag: amber card, no flagged badge, and the person decides.
          <div className="max-w-prose text-sm leading-6" data-lookalike={result.suggestion}>
            <p>
              <span className="font-mono font-semibold">{result.batch}</span> has no alert, but {distance(result.batch, result.suggestion)}{' '}
              <span className="font-mono font-semibold">{result.suggestion}</span>, which is named in a regulator alert.{' '}
              <span className="text-muted-foreground">Check the batch number on the pack again.</span>
            </p>
            <Button variant="outline" className="mt-3 h-11 rounded-xl border-caution-border bg-card px-4" onClick={() => onCheck(result.suggestion!)} data-lookalike-check>
              Check <span className="font-mono font-semibold">{result.suggestion}</span>
            </Button>
          </div>
        ) : (
          <Callout result={result}>
            <span className="text-muted-foreground">Batch numbers use letters, digits and - / . ( ) only. Re-read the line after “B.No.” or ask your chemist.</span>
          </Callout>
        ))}
    </div>
  )
}
