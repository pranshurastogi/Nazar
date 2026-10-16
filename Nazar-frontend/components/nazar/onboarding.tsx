'use client'

import { useState } from 'react'
import { ArrowLeft, ArrowRight, CircleHelp, FileSearch, History, Lock, Search, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { NazarMark } from '@/components/nazar/logo'
import { Rings } from '@/components/nazar/rings'
import { cn } from '@/lib/utils'

export const ONBOARDED_KEY = 'nazar:onboarded'

const STATES = [
  { icon: TriangleAlert, label: 'Flagged', note: 'Failed a government test', tone: 'text-flagged bg-flagged-soft border-flagged-border' },
  { icon: History, label: 'Retracted', note: 'Alert was withdrawn', tone: 'text-caution bg-caution-soft border-caution-border' },
  { icon: Search, label: 'No alert found', note: 'Not a safety certificate', tone: 'text-quiet bg-quiet-soft border-quiet-border' },
  { icon: CircleHelp, label: "Can't tell", note: 'Batch number unclear', tone: 'text-caution bg-caution-soft border-caution-border' },
]

function PackIllustration() {
  return (
    <div className="mx-auto w-full max-w-72 rounded-xl border bg-background p-4 font-mono text-xs leading-6 text-muted-foreground" aria-hidden="true">
      <p className="font-sans text-sm font-semibold text-foreground">Coldrif Syrup</p>
      <p className="mt-1">
        B.No. <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-primary ring-1 ring-primary/30">SR-13</span>
      </p>
      <p>Mfg. 05/2025 &nbsp; Exp. 04/2027</p>
      <p className="truncate">Mfd. by: Sresan Pharmaceuticals</p>
    </div>
  )
}

const STEPS = [
  {
    title: 'Welcome to Nazar',
    body: 'Har batch par nazar: an eye on every batch. Nazar checks a medicine batch against alerts published by CDSCO and state drug regulators.',
    art: (
      <Rings className="mx-auto size-36">
        <NazarMark className="h-9 w-16" />
      </Rings>
    ),
  },
  {
    title: 'Find the batch number',
    body: 'Look for "B.No.", "Batch" or "Lot" on the strip, bottle or carton. Type it in, or scan the QR code on the pack.',
    art: <PackIllustration />,
  },
  {
    title: 'Four honest answers',
    body: 'Nazar never says a medicine is "safe". It only tells you what regulators have published.',
    art: (
      <ul className="grid gap-2 text-left">
        {STATES.map(({ icon: Icon, label, note, tone }) => (
          <li key={label} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5', tone)}>
            <Icon className="size-4 shrink-0" />
            <span className="text-sm font-semibold">{label}</span>
            <span className="ml-auto text-xs text-muted-foreground">{note}</span>
          </li>
        ))}
      </ul>
    ),
  },
  {
    title: 'Proof, and privacy',
    body: 'Every alert links to the regulator’s notice and its public record on Arkiv, so you can verify it yourself. Your checks stay on this device.',
    art: (
      <div className="grid grid-cols-2 gap-2 text-left">
        <div className="rounded-lg border p-3">
          <FileSearch className="size-5 text-primary" />
          <p className="mt-2 text-sm font-semibold">How do we know?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Source notice, record and wallet, one tap away.</p>
        </div>
        <div className="rounded-lg border p-3">
          <Lock className="size-5 text-primary" />
          <p className="mt-2 text-sm font-semibold">On your phone</p>
          <p className="mt-0.5 text-xs text-muted-foreground">No account. Nothing you check is uploaded.</p>
        </div>
      </div>
    ),
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
  const [step, setStep] = useState(0)
  const last = step === STEPS.length - 1
  const current = STEPS[step]

  const finish = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1')
    } catch {}
    onOpenChange(false)
    setTimeout(() => setStep(0), 300)
  }

  return (
    <Drawer open={open} onOpenChange={(next) => (next ? onOpenChange(true) : finish())} showSwipeHandle>
      <DrawerContent className="mx-auto w-full sm:max-w-md">
        <div className="overflow-y-auto px-5 pb-2 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
              {STEPS.map((_, i) => (
                <span key={i} className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-primary' : 'w-1.5 bg-border')} />
              ))}
            </div>
            {!last && (
              <Button variant="ghost" size="sm" onClick={finish}>
                Skip
              </Button>
            )}
          </div>

          <div key={step} className="animate-in fade-in-0 slide-in-from-right-2 duration-300 motion-reduce:slide-in-from-right-0">
            <div className="mt-6 min-h-44">{current.art}</div>
            <DrawerHeader className="px-0 pt-6 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
              <DrawerTitle className="text-xl font-semibold tracking-tight">{current.title}</DrawerTitle>
              <DrawerDescription className="text-left text-sm leading-6 text-pretty">{current.body}</DrawerDescription>
            </DrawerHeader>
          </div>
        </div>

        <DrawerFooter className="flex-row gap-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {step > 0 && (
            <Button variant="outline" className="h-12 px-4" onClick={() => setStep(step - 1)} aria-label="Previous step">
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
            <Button className="h-12 flex-1" onClick={() => setStep(step + 1)}>
              Next <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
