import { NazarLoader } from '@/components/nazar/logo'

/** Route-level loader: shown while a page segment streams in. */
export default function Loading() {
  return (
    <div className="grid min-h-[60dvh] place-items-center" aria-busy="true">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <NazarLoader className="size-20" label="Loading Nazar" />
        <span>Looking closely…</span>
      </div>
    </div>
  )
}
