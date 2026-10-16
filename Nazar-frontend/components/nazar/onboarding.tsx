'use client'

import { useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { BatchArt, DotGrid, ProofArt, StatesArt, WatchArt } from '@/components/nazar/onboarding-art'
import { cn } from '@/lib/utils'

export const ONBOARDED_KEY = 'nazar:onboarded'

const STEPS = [
  {
    kicker: 'Welcome',
    title: 'An eye on every batch',
    body: 'Har batch par nazar. Nazar checks a medicine batch against the alerts CDSCO and state drug regulators publish, in seconds.',
    points: ['Free, no account', 'Official sources only', 'Works for chemists and families'],
    Art: WatchArt,
  },
  {
    kicker: 'Step 1',
    title: 'Find the batch number',
    body: 'Look for "B.No.", "Batch" or "Lot" on the strip, bottle or carton. It usually sits next to the Mfg. and Exp. dates.',
    points: ['Strips: on the foil edge', 'Bottles: on the label or cap', 'Type it in, or scan the QR'],
    Art: BatchArt,
  },
  {
    kicker: 'Step 2',
    title: 'Four honest answers',
    body: 'Nazar never says a medicine is "safe". It tells you exactly what regulators have published, and nothing more.',
    points: ['Colour, icon and words always agree', '"No alert found" is never green'],
    Art: StatesArt,
  },
  {
    kicker: 'Step 3',
    title: 'Proof you can check',
    body: 'Every alert links back to the regulator’s notice and its public record on Arkiv. Your own checks never leave this device.',
    points: ['Tap "How do we know?" on any result', 'No tracking of what you check'],
    Art: ProofArt,
  },
]

export function Onboarding({
  open,
  onOpenChange,
  onTry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onTry: (batch: string) => void
}) {
  const [[step, dir], setStep] = useState<[number, number]>([0, 1])
  const last = step === STEPS.length - 1
  const { kicker, title, body, points, Art } = STEPS[step]

  const go = (next: number) => setStep([next, next > step ? 1 : -1])
  const finish = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1')
    } catch {}
    onOpenChange(false)
    setTimeout(() => setStep([0, 1]), 300)
  }

  return (
    <MotionConfig reducedMotion="user">
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : finish())}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[calc(100%-2rem)] gap-0 overflow-y-auto rounded-3xl p-0 sm:max-w-[min(56rem,calc(100%-3rem))] md:grid-cols-[1.1fr_1fr] md:overflow-hidden"
        >
          {/* Illustration panel */}
          <div className="relative grid min-h-64 place-items-center overflow-hidden border-b bg-accent/50 px-6 py-8 md:min-h-[30rem] md:border-r md:border-b-0">
            <DotGrid />
            <AnimatePresence mode="wait" custom={dir}>
              <motion.div
                key={step}
                custom={dir}
                className="relative grid w-full place-items-center"
                initial={{ opacity: 0, x: dir * 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir * -40 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
              >
                <Art />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Copy and controls */}
          <div className="flex min-w-0 flex-col p-6 sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Go to step ${i + 1}`}
                    onClick={() => go(i)}
                    className={cn('h-1.5 rounded-full transition-all duration-300', i === step ? 'w-7 bg-primary' : i < step ? 'w-3 bg-primary/40' : 'w-3 bg-border')}
                  />
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={finish} className={cn(last && 'invisible')}>
                Skip
              </Button>
            </div>

            <AnimatePresence mode="wait" custom={dir}>
              <motion.div
                key={step}
                className="mt-6 flex-1 md:mt-10"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
              >
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">{kicker}</p>
                <DialogTitle className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">{title}</DialogTitle>
                <DialogDescription className="mt-3 text-[15px] leading-6 text-pretty text-muted-foreground">{body}</DialogDescription>
                <ul className="mt-5 grid gap-2.5">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex gap-2">
              {step > 0 && (
                <Button variant="outline" className="h-12 px-4" onClick={() => go(step - 1)} aria-label="Previous step">
                  <ArrowLeft />
                </Button>
              )}
              {last ? (
                <>
                  <Button variant="outline" className="h-12 flex-1" onClick={finish}>
                    Start checking
                  </Button>
                  <Button
                    className="h-12 flex-1"
                    onClick={() => {
                      finish()
                      onTry('SR-13')
                    }}
                  >
                    Try SR-13
                  </Button>
                </>
              ) : (
                <Button className="h-12 flex-1" onClick={() => go(step + 1)}>
                  {step === 0 ? 'Show me how' : 'Next'} <ArrowRight data-icon="inline-end" />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MotionConfig>
  )
}
