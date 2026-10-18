import { Button } from '@/components/ui/button'
import { matchKey, type Alert, type CheckResult } from '@/lib/source'
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

/** The state-specific explanation under the headline. */
export function VerdictBody({ result, alert, onCheck }: { result: CheckResult; alert?: Alert; onCheck: (batch: string) => void }) {
  return (
    <div className="bg-card/70 px-5 py-4 sm:px-6">
      {result.state === 'flagged' && alert && (
        <div className="grid gap-4 sm:grid-cols-2">
          <WhatToDo />
          <SeverityWhy alert={alert} />
        </div>
      )}
      {result.state === 'retracted' && alert?.retraction && (
        <p className="text-sm">
          <span className="font-semibold">{alert.retraction.reason}.</span>{' '}
          <span className="text-muted-foreground">
            {alert.retraction.authority}
            {alert.retraction.date ? `, ${alert.retraction.date}` : ''}. The original alert stays on record.
          </span>
        </p>
      )}
      {result.state === 'no_alert' && (
        <p className="text-sm">
          <span className="font-semibold">This is not a safety certificate.</span>{' '}
          <span className="text-muted-foreground">It only means no regulator has published an alert for this batch yet.</span>
        </p>
      )}
      {result.state === 'unreadable' && (
        <div className="text-sm">
          {result.suggestion ? (
            // A look-alike is never a flag: amber card, no flagged badge, and the person decides.
            <div data-lookalike={result.suggestion}>
              <p>
                <span className="font-mono font-semibold">{result.batch}</span> has no alert, but {distance(result.batch, result.suggestion)}{' '}
                <span className="font-mono font-semibold">{result.suggestion}</span>, which is named in a regulator alert.{' '}
                <span className="text-muted-foreground">Check the batch number on the pack again.</span>
              </p>
              <Button variant="outline" className="mt-3 h-11 rounded-xl border-caution-border px-4" onClick={() => onCheck(result.suggestion!)} data-lookalike-check>
                Check <span className="font-mono font-semibold">{result.suggestion}</span>
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Batch numbers use letters, digits and - / . ( ) only. Re-read the line after “B.No.” or ask your chemist.</p>
          )}
        </div>
      )}
    </div>
  )
}
