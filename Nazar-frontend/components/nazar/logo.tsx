import { cn } from '@/lib/utils'

/** The Nazar mark: an eye looking out of a medicine capsule. Square artwork; boxes keep its ratio. */
export function NazarMark({ className, priority, ...rest }: { className?: string; priority?: boolean } & Record<`data-${string}`, unknown>) {
  return (
    // A plain <img>: the 256 px PNG is already optimised and must work in every shell, including static export.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/nazar-mark-256.png"
      alt=""
      aria-hidden="true"
      width={256}
      height={256}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      draggable={false}
      className={cn('size-8 select-none object-contain', className)}
      {...rest}
    />
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <NazarMark className="size-9" priority />
      <span className="text-xl font-semibold tracking-[-0.04em]">Nazar</span>
    </div>
  )
}

/** The mark, gently rocking and breathing: used wherever Nazar is working on something. */
export function NazarLoader({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="img" aria-label={label} className={cn('relative grid size-16 place-items-center', className)}>
      <span className="absolute inset-0 rounded-full bg-primary/10 motion-safe:animate-[nazar-halo_2.4s_ease-in-out_infinite]" aria-hidden="true" />
      <NazarMark className="relative size-[78%] motion-safe:animate-[nazar-rock_2.4s_ease-in-out_infinite]" />
    </span>
  )
}
