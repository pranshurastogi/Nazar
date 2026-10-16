import { cn } from '@/lib/utils'

/** Concentric-ring motif used for empty states and illustrations. */
export function Rings({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn('relative grid size-28 place-items-center', className)} aria-hidden="true">
      <svg viewBox="0 0 120 120" className="absolute inset-0 size-full text-primary">
        <circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" strokeOpacity=".10" strokeWidth="1.5" />
        <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="1.5" />
        <circle cx="60" cy="60" r="30" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeOpacity=".30" strokeWidth="1.5" />
      </svg>
      <div className="relative text-primary [&_svg]:size-6">{children}</div>
    </div>
  )
}
