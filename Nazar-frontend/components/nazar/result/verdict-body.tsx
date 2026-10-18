import type { Alert, CheckResult } from '@/lib/source'
import { SeverityWhy } from './severity-why'
import { WhatToDo } from './what-to-do'

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
            <p>
              Did you mean{' '}
              <button className="font-mono font-semibold text-primary underline underline-offset-2" onClick={() => onCheck(result.suggestion!)}>
                {result.suggestion}
              </button>
              ? Check the manufacturer on the pack before trusting a look-alike.
            </p>
          ) : (
            <p className="text-muted-foreground">Batch numbers use letters, digits and - / . ( ) only. Re-read the line after “B.No.” or ask your chemist.</p>
          )}
        </div>
      )}
    </div>
  )
}
