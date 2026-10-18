'use client'

import { useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { BatchArt, DotGrid, ProofArt, StatesArt, WatchArt } from '@/components/nazar/onboarding-art'
import { useT, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export const ONBOARDED_KEY = 'nazar:onboarded'

/** Copy lives in the dictionaries (onboarding.s{i}.*); each step names its key prefix and its points. */
const STEPS = [
  { id: 's0', points: 3, Art: WatchArt },
  { id: 's1', points: 3, Art: BatchArt },
  { id: 's2', points: 2, Art: StatesArt },
  { id: 's3', points: 2, Art: ProofArt },
] as const

export function Onboarding({
  open,
  onOpenChange,
  onTry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onTry: (batch: string) => void
}) {
  const { t } = useT()
  const [[step, dir], setStep] = useState<[number, number]>([0, 1])
  const last = step === STEPS.length - 1
  const { id, Art } = STEPS[step]
  const kicker = t(`onboarding.${id}.kicker`)
  const title = t(`onboarding.${id}.title`)
  const body = t(`onboarding.${id}.body`)
  const points = Array.from({ length: STEPS[step].points }, (_, i) => t(`onboarding.${id}.p${i + 1}` as MessageKey))

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
              <div className="flex items-center gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label={t('onboarding.progress', { n: step + 1, total: STEPS.length })}>
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={t('onboarding.goTo', { n: i + 1 })}
                    onClick={() => go(i)}
                    className={cn('h-1.5 rounded-full transition-all duration-300', i === step ? 'w-7 bg-primary' : i < step ? 'w-3 bg-primary/40' : 'w-3 bg-border')}
                  />
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={finish} className={cn(last && 'invisible')}>
                {t('onboarding.skip')}
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
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary hi:text-xs">{kicker}</p>
                <DialogTitle className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem] hi:leading-snug">{title}</DialogTitle>
                <DialogDescription className="mt-3 text-[15px] leading-6 text-pretty text-muted-foreground hi:leading-7">{body}</DialogDescription>
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
                <Button variant="outline" className="h-12 px-4" onClick={() => go(step - 1)} aria-label={t('onboarding.previous')}>
                  <ArrowLeft />
                </Button>
              )}
              {last ? (
                <>
                  <Button variant="outline" className="h-12 flex-1" onClick={finish}>
                    {t('onboarding.start')}
                  </Button>
                  <Button
                    className="h-12 flex-1"
                    onClick={() => {
                      finish()
                      onTry('SR-13')
                    }}
                  >
                    {t('onboarding.try')}
                  </Button>
                </>
              ) : (
                <Button className="h-12 flex-1" onClick={() => go(step + 1)}>
                  {step === 0 ? t('onboarding.showMe') : t('onboarding.next')} <ArrowRight data-icon="inline-end" />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MotionConfig>
  )
}
