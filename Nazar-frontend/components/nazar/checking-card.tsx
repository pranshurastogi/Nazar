import { NazarMark } from '@/components/nazar/logo'
import type { Stage } from '@/lib/source'

const STAGE_TEXT: Record<Stage, string> = {
  api: 'Asking the Nazar API…',
  arkiv: 'Reading published alerts on Arkiv directly…',
}

/** Placeholder shown while a check is in flight. Shaped like a result card so nothing jumps when it lands. */
export function CheckingCard({ batch, stage }: { batch: string; stage: Stage }) {
  return (
    <section aria-busy="true" aria-label={`Checking batch ${batch}`} className="overflow-hidden rounded-2xl border bg-card">
      <div className="nazar-progress h-0.5 bg-primary/10" aria-hidden="true" />
      <div className="flex gap-4 p-5 sm:p-6">
        <div className="relative grid size-12 shrink-0 place-items-center" aria-hidden="true">
          <svg viewBox="0 0 48 48" className="absolute inset-0 size-full text-primary">
            <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="1.5" />
            <circle cx="24" cy="24" r="15" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.5" />
            <circle
              cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeDasharray="24 140" className="origin-center animate-spin [animation-duration:1.4s] motion-reduce:animate-none"
            />
          </svg>
          <NazarMark className="relative size-8 motion-safe:animate-[nazar-rock_1.6s_ease-in-out_infinite]" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block h-6 w-24 animate-pulse motion-reduce:animate-none rounded-full bg-muted" />
          <h3 className="mt-2.5 text-xl font-semibold leading-snug tracking-tight">
            Checking batch <span className="font-mono">{batch}</span>
          </h3>
          <p role="status" className="mt-1 text-sm text-muted-foreground">{STAGE_TEXT[stage]}</p>
        </div>
      </div>
      <div className="grid gap-2 border-t bg-card/70 px-5 py-4 sm:px-6" aria-hidden="true">
        <span className="h-3 w-3/4 animate-pulse motion-reduce:animate-none rounded bg-muted" />
        <span className="h-3 w-1/2 animate-pulse motion-reduce:animate-none rounded bg-muted" />
      </div>
    </section>
  )
}
