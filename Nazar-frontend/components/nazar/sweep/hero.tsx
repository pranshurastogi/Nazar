'use client'

import { SentinelEye, type SentinelState } from '@/components/ui/sentinel-core'
import { serif } from '@/lib/fonts'
import { cn } from '@/lib/utils'

/** The top of /sweep: eyebrow, the headline with its one serif phrase, a plain lede, and the eye. */
export function SweepHero({ eye }: { eye: SentinelState }) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6 pt-4 md:pt-8" aria-labelledby="sweep-title">
      <p className="col-start-1 row-start-1 self-center text-[11px] font-bold tracking-[0.18em] text-primary uppercase sm:self-start">
        Shelf sweep <span className="block sm:inline"><span className="hidden sm:inline">· </span>for chemists, pharmacies and NGOs</span>
      </p>
      {/* One eye: beside the eyebrow on a phone, beside the whole hero from sm up. It scans while checking. */}
      <div className="col-start-2 row-start-1 sm:row-span-3">
        <SentinelEye state={eye} className="w-20 shrink-0 sm:w-36 lg:w-44" />
      </div>
      <h1
        id="sweep-title"
        className="col-span-2 mt-3 max-w-2xl text-[clamp(2.25rem,7vw,3.25rem)] leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:col-span-1"
        data-sweep-hero
      >
        Check a whole shelf, <span className={cn(serif.className, 'pr-1 text-[1.1em] font-normal tracking-[-0.01em] whitespace-nowrap text-primary')}>in one go.</span>
      </h1>
      <p className="col-span-2 mt-4 max-w-xl text-base leading-7 text-pretty text-muted-foreground sm:col-span-1">
        Paste or upload up to 500 batch numbers from your stock list. Nazar matches every one against CDSCO, state regulator and WHO alerts on this device, then confirms the flagged ones with the
        live record.
      </p>
    </section>
  )
}
