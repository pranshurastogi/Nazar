import { Baby } from 'lucide-react'

/** Shown on flagged paediatric formulations. */
export function ChildShield() {
  return (
    <div className="mx-5 mb-4 flex items-start gap-3 rounded-xl border border-flagged-border bg-card p-3.5 sm:mx-6">
      <Baby className="mt-0.5 size-5 shrink-0 text-flagged" />
      <p className="text-sm">
        <span className="font-semibold">Child Shield.</span> This is a children&apos;s formulation. If a child has taken it, contact a doctor now.
      </p>
    </div>
  )
}
