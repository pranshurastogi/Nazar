import { cn } from '@/lib/utils'

/** The Nazar mark: the blue nazar eye drawn inside a capsule. */
export function NazarMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 28" className={cn('h-7 w-12', className)} aria-hidden="true">
      <rect x="1" y="1" width="46" height="26" rx="13" fill="var(--brand)" />
      <circle cx="24" cy="14" r="10" fill="#fff" />
      <circle cx="24" cy="14" r="7" fill="var(--brand-tint)" />
      <circle cx="24" cy="14" r="3.6" fill="var(--brand-ink)" />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <NazarMark className="h-6 w-10" />
      <span className="text-xl font-semibold tracking-[-0.04em]">Nazar</span>
    </div>
  )
}
