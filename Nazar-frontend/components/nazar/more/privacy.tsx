'use client'

import { ArrowRight, Ban, Code2, Smartphone, TriangleAlert } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { AUTHOR, SocialChips } from '@/components/nazar/author-links'
import { cn } from '@/lib/utils'
import { panel, REPO, Section } from './shared'

export function Privacy() {
  return (
    <Section
      id="privacy"
      kicker="Privacy"
      title="Nothing about you leaves this device"
      intro="To answer a check, only the batch number is sent to the Nazar API or the public Arkiv network. It is not linked to you, and your cabinet list is never uploaded."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className={cn(panel, 'p-5')}>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Smartphone className="size-4" aria-hidden="true" />
            </span>
            Stays on this device
          </p>
          <ul className="mt-3 grid gap-2 text-[13px] leading-5 text-muted-foreground">
            <li>Your recent checks</li>
            <li>Your medicine cabinet: names, batches, notes and expiry dates</li>
            <li>Your theme and whether you have seen the guide</li>
          </ul>
        </div>
        <div className={cn(panel, 'p-5')}>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Ban className="size-4" aria-hidden="true" />
            </span>
            Never collected
          </p>
          <ul className="mt-3 grid gap-2 text-[13px] leading-5 text-muted-foreground">
            <li>No account, name, phone number or email</li>
            <li>No location, contacts or camera images</li>
            <li>No analytics, ads or tracking cookies</li>
          </ul>
        </div>
      </div>
    </Section>
  )
}

export function About() {
  return (
    <Section id="about" kicker="About" title="Built in the open">
      <div className={cn(panel, 'grid gap-4 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center')}>
        <p className="max-w-[60ch] text-[15px] leading-7">
          Nazar is built by{' '}
          <a href={AUTHOR.site} target="_blank" rel="noreferrer noopener me" className="font-semibold underline-offset-2 hover:underline">
            Pranshu Rastogi
          </a> and released under the <span className="font-semibold">MIT licence</span>. The pipeline,
          the app and the Arkiv schema are all public.
        </p>
        <a href={REPO} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants({ variant: 'outline' }), 'h-12 rounded-xl px-4')}>
          <Code2 /> View on GitHub <ArrowRight data-icon="inline-end" />
        </a>
      </div>
      <div className="mt-4" data-about-author>
        <p className="text-sm font-semibold">Find Pranshu online</p>
        <SocialChips className="mt-2.5" />
      </div>
      <p className="mt-4 flex items-start gap-2.5 rounded-2xl border border-caution-border bg-caution-soft px-4 py-3.5 text-[13px] leading-5 text-caution" data-disclaimer>
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>Nazar repeats what regulators publish. It does not test medicines and is not medical advice. If a medicine has harmed someone, contact a doctor.</span>
      </p>
    </Section>
  )
}
