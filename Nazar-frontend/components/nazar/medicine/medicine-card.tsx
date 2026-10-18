'use client'

import Link from 'next/link'
import { Activity, ArrowRight, Cog, FileText, Landmark, ShieldAlert, Siren, Stethoscope, Thermometer } from 'lucide-react'

import type { MedicineExplain } from '@/lib/source/api'
import { cn } from '@/lib/utils'

// The AI-written body of "About this medicine": a compact header, then short story cards that
// swipe on a phone and sit in a grid on wider screens. Pure presentation; no fetching here.

type Story = { id: string; title: string; Icon: typeof Activity; bullets: string[]; extra?: { label: string; bullets: string[] }; tone?: 'urgent' }

export function stories(m: MedicineExplain['medicine']): Story[] {
  const list: Story[] = [
    { id: 'for', title: "What it's for", Icon: Stethoscope, bullets: m.whatItIsFor },
    { id: 'how', title: 'How it works', Icon: Cog, bullets: m.howItWorks ? [m.howItWorks] : [] },
    { id: 'side', title: 'Common side effects', Icon: Activity, bullets: m.commonSideEffects },
    { id: 'help', title: 'Get help now if…', Icon: Siren, bullets: m.seriousWarnings, tone: 'urgent' },
    {
      id: 'careful',
      title: 'Be careful if…',
      Icon: ShieldAlert,
      bullets: m.whoShouldBeCareful.slice(0, 4),
      extra: m.interactions.length ? { label: 'Can interact with', bullets: m.interactions.slice(0, 2) } : undefined,
    },
    { id: 'store', title: 'Storage', Icon: Thermometer, bullets: m.storage ? [m.storage] : [] },
  ]
  return list.filter((s) => s.bullets.length > 0 || s.extra)
}

const CONFIDENCE: Record<string, string | null> = {
  high: null,
  medium: 'Medium confidence',
  low: 'Low confidence · details may be wrong',
}

export function MedicineCard({ data }: { data: MedicineExplain }) {
  const m = data.medicine
  const all = stories(m)
  const generic = m.genericNames.join(', ')
  const rx = m.prescriptionStatus && m.prescriptionStatus.toLowerCase() !== 'unknown' ? m.prescriptionStatus : null
  const confidence = CONFIDENCE[m.confidence]

  return (
    <div data-medicine-card>
      <div className="px-4 sm:px-5">
        <h3 className="text-lg font-semibold leading-snug tracking-tight text-balance">{m.name}</h3>
        {(generic || (m.drugClass && m.drugClass !== 'unknown')) && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {generic}
            {generic && m.drugClass && m.drugClass !== 'unknown' ? ' · ' : ''}
            {m.drugClass !== 'unknown' ? m.drugClass : ''}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
          {rx && (
            <span className="inline-flex items-start gap-1.5 rounded-lg border border-ai-border bg-card px-2.5 py-1 text-left font-medium" data-medicine-rx>
              <FileText className="mt-px size-3.5 shrink-0 text-ai" aria-hidden="true" /> {rx}
            </span>
          )}
          {confidence && <span className="rounded-full border border-caution-border bg-caution-soft px-2.5 py-1 font-semibold text-caution">{confidence}</span>}
        </div>
        {m.lookAlikeNames.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Easily confused with <span className="font-medium text-foreground">{m.lookAlikeNames.join(', ')}</span>. Check the name on the pack.
          </p>
        )}
      </div>

      {data.nazarAlerts > 0 && (
        <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm sm:mx-5" data-medicine-nazar>
          <p className="flex items-start gap-2">
            <Landmark className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <span className="font-semibold">
                Nazar has {data.nazarAlerts} regulator {data.nazarAlerts === 1 ? 'alert' : 'alerts'}
              </span>{' '}
              naming this medicine (any batch).
            </span>
          </p>
          <Link href="/feed" className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary hover:underline">
            Open Feed <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}

      <p className="mt-4 px-4 text-xs text-muted-foreground sm:hidden" aria-hidden="true">
        Swipe for more →
      </p>
      <ul
        className="mt-1.5 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:mt-4 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-5 lg:grid-cols-3"
        aria-label="About this medicine, in short cards"
        tabIndex={0}
        data-medicine-stories
      >
        {all.map((s) => (
          <li
            key={s.id}
            data-story={s.id}
            className="flex w-[80%] max-w-[19rem] shrink-0 snap-start flex-col rounded-xl border bg-card p-4 animate-in fade-in-0 duration-300 sm:w-auto sm:max-w-none"
          >
            <div className="flex items-center gap-2.5">
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', s.tone === 'urgent' ? 'bg-caution-soft text-caution' : 'bg-ai-soft text-ai')}>
                <s.Icon className="size-4" aria-hidden="true" />
              </span>
              <h4 className="text-sm font-semibold">{s.title}</h4>
            </div>
            <ul className="mt-2.5 grid gap-1.5 text-sm leading-5">
              {s.bullets.map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
                  {b}
                </li>
              ))}
            </ul>
            {s.extra && (
              <>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{s.extra.label}</p>
                <ul className="mt-1.5 grid gap-1.5 text-sm leading-5">
                  {s.extra.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
                      {b}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
