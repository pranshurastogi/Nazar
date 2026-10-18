import { Baby } from 'lucide-react'

import { isMedicine } from '@/lib/source/map'
import type { Alert } from '@/lib/source/types'

/** Shown on flagged children's medicines. A kids' shampoo or hand rub is not "taken", so it gets no banner. */
export function ChildShield({ alert }: { alert: Alert }) {
  if (!alert.peds || !isMedicine(alert)) return null
  return (
    <div className="mx-5 mb-4 flex items-start gap-3 rounded-xl border border-flagged-border bg-card p-3.5 sm:mx-6" data-child-shield>
      <Baby className="mt-0.5 size-5 shrink-0 text-flagged" aria-hidden="true" />
      <p className="text-sm">
        <span className="font-semibold">Child Shield.</span> This is a children&apos;s formulation. If a child has taken it, contact a doctor now.
      </p>
    </div>
  )
}
