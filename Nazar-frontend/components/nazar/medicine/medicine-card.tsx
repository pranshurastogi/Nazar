'use client'

import { useState } from 'react'
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
      <div className="px-5 sm:px-6">
        <p className="text-[11px] font-bold tracking-wider text-ai uppercase">General information</p>
        <h3 className="mt-0.5 text-lg leading-snug font-semibold tracking-tight text-balance">{m.name}</h3>
        {(generic || (m.drugClass && m.drugClass !== 'unknown')) && (
          <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">
            {generic}
            {generic && m.drugClass && m.drugClass !== 'unknown' ? ' · ' : ''}
            {m.drugClass !== 'unknown' ? m.drugClass : ''}
          </p>
        )}
        {(rx || confidence) && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {rx && (
              <span className="inline-flex items-start gap-1.5 rounded-lg border border-ai-border bg-card px-2.5 py-1 text-left font-medium" data-medicine-rx>
                <FileText className="mt-px size-3.5 shrink-0 text-ai" aria-hidden="true" /> {rx}
              </span>
            )}
            {confidence && <span className="rounded-full border border-caution-border bg-caution-soft px-2.5 py-1 font-semibold text-caution">{confidence}</span>}
          </div>
        )}
        {m.lookAlikeNames.length > 0 && (
          <p className="mt-2.5 max-w-prose text-xs leading-5 text-muted-foreground">
            Easily confused with <span className="font-medium text-foreground">{m.lookAlikeNames.join(', ')}</span>. Check the name on the pack.
          </p>
        )}
      </div>

      <NazarCounts data={data} />

      <div className="mt-5 flex items-baseline justify-between gap-3 px-5 sm:px-6">
        <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">In short</h4>
        <p className="text-xs text-muted-foreground sm:hidden" aria-hidden="true">
          Swipe for more →
        </p>
      </div>
      {/* Phones swipe a row of even cards (long ones fold behind "Show more"); wider screens use a grid. */}
      <ul
        className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pb-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-6 lg:grid-cols-3"
        aria-label="About this medicine, in short cards"
        tabIndex={0}
        data-medicine-stories
      >
        {all.map((s) => (
          <StoryCard key={s.id} story={s} />
        ))}
      </ul>
    </div>
  )
}

/** Bullets a phone card shows before "Show more"; a lone extra line is shown rather than hidden. */
const PHONE_BULLETS = 3

function Bullets({ items, hideFrom, className }: { items: string[]; hideFrom?: number; className?: string }) {
  return (
    <ul className={cn('grid gap-1.5 text-sm leading-5', className)}>
      {items.map((b, i) => (
        <li key={b} className={cn('flex gap-2', hideFrom !== undefined && i >= hideFrom && 'max-sm:hidden')}>
          <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
          {b}
        </li>
      ))}
    </ul>
  )
}

/**
 * One story card. On a phone a long card (the "Be careful" list with its interactions) shows its first
 * lines and a "Show N more" button, so one tall card does not stretch the whole swipe row; from sm every
 * line shows.
 */
function StoryCard({ story: s }: { story: Story }) {
  const [open, setOpen] = useState(false)
  const hiddenCount = Math.max(0, s.bullets.length - PHONE_BULLETS) + (s.extra?.bullets.length ?? 0)
  const clamp = !open && hiddenCount >= 2
  return (
    <li
      data-story={s.id}
      className={cn(
        'flex w-[85%] max-w-[19rem] shrink-0 snap-start flex-col rounded-xl border bg-card p-4 shadow-xs sm:w-auto sm:max-w-none',
        s.tone === 'urgent' && 'border-caution-border',
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', s.tone === 'urgent' ? 'bg-caution-soft text-caution' : 'bg-ai-soft text-ai')}>
          <s.Icon className="size-4" aria-hidden="true" />
        </span>
        <h4 className="text-sm font-semibold">{s.title}</h4>
      </div>
      <Bullets items={s.bullets} hideFrom={clamp ? PHONE_BULLETS : undefined} className="mt-3" />
      {s.extra && (
        <div className={cn(clamp && 'max-sm:hidden')}>
          <p className="mt-3 border-t pt-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{s.extra.label}</p>
          <Bullets items={s.extra.bullets} className="mt-1.5" />
        </div>
      )}
      {clamp && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-mx-1 mt-2 inline-flex min-h-11 w-fit items-center rounded-lg px-1 text-sm font-semibold text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:hidden"
          data-story-more
        >
          Show {hiddenCount} more
        </button>
      )}
    </li>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Regulator alerts in Nazar, from Nazar's own ledger (not the AI). The brand count and the
 * ingredient count are kept apart on purpose: "148 alerts naming this medicine" for a common
 * ingredient like paracetamol would make an ordinary pack look dangerous.
 */
function NazarCounts({ data }: { data: MedicineExplain }) {
  const { brandName, brandAlerts, ingredientName, ingredientAlerts } = data
  if (!brandName && !ingredientAlerts) return null
  return (
    <div className="mx-5 mt-4 rounded-xl border bg-card px-3.5 py-3 text-sm sm:mx-6" data-medicine-nazar>
      {brandName && (
        <div className="flex flex-wrap items-center justify-between gap-2" data-medicine-brand-alerts={brandAlerts}>
          <p className="flex items-start gap-2">
            <Landmark className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {brandAlerts > 0 ? (
              <span>
                <span className="font-semibold">Nazar has {plural(brandAlerts, 'regulator alert', 'regulator alerts')} for {brandName}</span>{' '}
                (any batch). Only a match on your batch number means your pack is affected.
              </span>
            ) : (
              <span>
                <span className="font-semibold">No regulator alerts for {brandName}</span> in Nazar so far (any batch).
              </span>
            )}
          </p>
          {brandAlerts > 0 && (
            <Link href="/feed" className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary hover:underline">
              Open Feed <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
      {ingredientAlerts > 0 && ingredientName && (
        <p className={cn('text-xs text-muted-foreground', brandName ? 'mt-1.5 pl-6' : 'flex items-start gap-2')} data-medicine-ingredient-alerts={ingredientAlerts}>
          {!brandName && <Landmark className="mt-px size-4 shrink-0" aria-hidden="true" />}
          <span>
            {brandName
              ? `${plural(ingredientAlerts, 'other alert is', 'other alerts are')} for different products that share an ingredient such as ${ingredientName.toLowerCase()}. They are not about ${brandName}.`
              : `${plural(ingredientAlerts, 'alert in Nazar is', 'alerts in Nazar are')} for products containing ${ingredientName.toLowerCase()}, from many makers. They don't mean your pack is affected: only your batch number can tell.`}
          </span>
        </p>
      )}
    </div>
  )
}
