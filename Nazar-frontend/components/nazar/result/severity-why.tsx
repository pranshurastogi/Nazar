import type { Alert } from '@/lib/source'

/** The failure in the regulator's words and the fixed rules that produced the severity. */
export function SeverityWhy({ alert }: { alert: Alert }) {
  return (
    <div className="sm:border-l sm:pl-6">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Why severity {alert.severity}</p>
      <p className="mt-2.5 text-sm leading-5 font-medium">{alert.failure}</p>
      <ul className="mt-1.5 grid gap-1 text-xs leading-5 text-muted-foreground">
        {alert.severityRules.map((r) => (
          <li key={r}>{r}</li>
        ))}
        {/* The instant (snapshot) answer carries no rules; hold their line so the live answer lands without a jump. */}
        {!alert.severityRules.length && alert.fromSnapshot && (
          <li aria-hidden="true" className="flex h-5 items-center" data-rules-pending>
            <span className="h-2.5 w-36 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </li>
        )}
      </ul>
    </div>
  )
}
