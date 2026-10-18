import type { Alert } from '@/lib/source'

/** The failure in the regulator's words and the fixed rules that produced the severity. */
export function SeverityWhy({ alert }: { alert: Alert }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Why severity {alert.severity}</p>
      <p className="mt-2 text-sm font-medium">{alert.failure}</p>
      <ul className="mt-1.5 grid gap-1 text-xs text-muted-foreground">
        {alert.severityRules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  )
}
