'use client'

import { Check, LoaderCircle, Lock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SentinelEye } from '@/components/ui/sentinel-core'
import type { PhotoStage } from '@/lib/scan/photo'
import { cn } from '@/lib/utils'
import './add.css'

// While the photo is read on the device: the sentinel eye scanning, the photo itself (it never
// leaves the page) and the three steps, so a slow first read (the text engine downloads once) is
// never a blank wait.

const STEPS: { stage: PhotoStage; label: string }[] = [
  { stage: 'opening', label: 'Opening the photo' },
  { stage: 'code', label: 'Looking for a QR or Data Matrix code' },
  { stage: 'text', label: 'Reading the printed label' },
]

export function PhotoReading({ stage, thumb, onCancel }: { stage: PhotoStage; thumb: string | null; onCancel: () => void }) {
  const at = STEPS.findIndex((s) => s.stage === stage)
  return (
    <div className="px-5 pt-2 pb-5" data-cabinet-reading aria-busy="true">
      <div className="relative mx-auto flex w-full max-w-xs flex-col items-center overflow-hidden rounded-2xl border bg-muted/40 px-4 pt-5 pb-4">
        {thumb && (
          // A local blob: URL, so a plain <img>: nothing is uploaded or optimised.
          <img src={thumb} alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover opacity-[0.14] blur-[1px] dark:opacity-[0.1]" />
        )}
        <span className="cab-read-beam" aria-hidden="true" />
        <SentinelEye state="scanning" follow={false} className="relative w-32" />
        <p className="relative mt-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" /> Your photo stays on this phone
        </p>
      </div>

      <ol className="mx-auto mt-4 grid w-full max-w-xs gap-2" aria-label="Reading steps">
        {STEPS.map((s, i) => {
          const done = i < at
          const now = i === at
          return (
            <li key={s.stage} className={cn('flex items-center gap-2.5 text-sm', !done && !now && 'text-muted-foreground/70')} data-read-step={s.stage} data-read-state={done ? 'done' : now ? 'now' : 'next'}>
              <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border', done && 'border-primary/30 bg-primary/10 text-primary', now && 'border-primary text-primary')}>
                {done ? <Check className="size-3.5" aria-hidden="true" /> : now ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              </span>
              <span className={cn(now && 'font-semibold')}>{s.label}</span>
              <span className="sr-only">{done ? ' – done' : now ? ' – in progress' : ''}</span>
            </li>
          )
        })}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {STEPS[at]?.label ?? 'Reading the photo'}…
      </p>
      <p className="mx-auto mt-3 max-w-xs text-center text-xs leading-5 text-pretty text-muted-foreground">The first read can take a little longer while the text reader loads.</p>

      <div className="mt-4 flex justify-center">
        <Button type="button" variant="outline" className="h-12 rounded-xl px-5" onClick={onCancel} data-read-cancel>
          Cancel
        </Button>
      </div>
    </div>
  )
}
