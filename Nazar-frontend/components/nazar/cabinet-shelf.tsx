'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { CircleHelp, Clock, History, LoaderCircle, Plus, Search, ShieldCheck, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SentinelEye, type SentinelState } from '@/components/ui/sentinel-core'
import { expiryStatus, formatExpiry, type CabinetItem } from '@/lib/cabinet'
import type { ResultState } from '@/lib/source'
import { cn } from '@/lib/utils'
import './cabinet-shelf.css'

// "Your shelf, watched": the cabinet drawn as shelves of capsules under the sentinel eye.
// It is an overview only. Each capsule opens the matching row in the list below, which keeps
// the full answer, the proof and the Edit / Remove actions. Colour follows the result states:
// red flagged, amber retracted or can't tell, slate no alert found (never green, never "safe").

type Tone = ResultState | 'pending'

const TONE: Record<Tone, { icon: typeof Search; label: string }> = {
  flagged: { icon: TriangleAlert, label: 'Flagged' },
  retracted: { icon: History, label: 'Alert retracted' },
  unreadable: { icon: CircleHelp, label: "Can't tell" },
  no_alert: { icon: Search, label: 'No alert found' },
  pending: { icon: Clock, label: 'Not checked yet' },
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "3:42 pm" today, "17 Oct, 3:42 pm" otherwise. */
function asOf(ms: number, now: number) {
  const d = new Date(ms)
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return new Date(now).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`
}

/** The small eye printed on every capsule's clear half, like the Nazar mark. */
function CapsuleEye() {
  return (
    <svg viewBox="0 0 24 14" className="cab-cap-eye" aria-hidden="true">
      <path d="M2 7 C 7 0.5, 17 0.5, 22 7 C 17 13.5, 7 13.5, 2 7 Z" fill="none" strokeWidth="1.6" />
      <circle cx="12" cy="7" r="3.2" />
    </svg>
  )
}

function Capsule({ tone, checking, ghost }: { tone: Tone; checking?: boolean; ghost?: boolean }) {
  const Icon = TONE[tone].icon
  return (
    <span className="cab-pill" data-tone={ghost ? 'ghost' : tone} data-checking={checking ? '' : undefined} aria-hidden="true">
      <span className="cab-pill-a">
        {ghost ? (
          <Plus className="size-4" />
        ) : checking ? (
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Icon className="size-[15px]" strokeWidth={2.4} />
        )}
      </span>
      <span className="cab-pill-b">{!ghost && <CapsuleEye />}</span>
    </span>
  )
}

function ShelfItem({ item, checking, now, onOpen }: { item: CabinetItem; checking: boolean; now: number; onOpen: (id: string) => void }) {
  const tone: Tone = item.last?.state ?? 'pending'
  const exp = expiryStatus(item.expiry, new Date(now))
  // A capsule settles (drops into place, rings once) when an answer lands during this visit,
  // never on first paint. Reduced motion skips both; the colour and label still change.
  const firstAt = useRef(item.last?.at)
  const at = item.last?.at
  const settled = at !== undefined && at !== firstAt.current
  const [ping, setPing] = useState(0)
  useEffect(() => {
    if (settled) setPing((p) => p + 1)
  }, [at, settled])

  const expText = exp ? (exp.kind === 'expired' ? 'Expired' : 'Expires soon') : null
  const label = [
    `${item.name}, batch ${item.batch}`,
    checking ? `${TONE[tone].label}, checking now` : TONE[tone].label,
    exp ? `${exp.label} (${formatExpiry(item.expiry)})` : null,
    'Show details',
  ]
    .filter(Boolean)
    .join('. ')

  return (
    <li className="cab-cell" data-shelf-item={item.id} data-shelf-batch={item.batch} data-shelf-state={tone}>
      <button type="button" className="cab-slot group" onClick={() => onOpen(item.id)} aria-label={label} data-shelf-checking={checking ? '' : undefined}>
        {expText && (
          <span className="cab-exp" data-shelf-expiry={exp!.kind}>
            <Clock className="size-2.5" aria-hidden="true" strokeWidth={2.6} />
            {expText}
          </span>
        )}
        <motion.span
          key={settled ? at : 'first'}
          className="cab-pill-wrap"
          initial={settled ? { y: -14, scale: 1.08, rotate: -6 } : false}
          animate={{ y: 0, scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 15, mass: 0.7 }}
        >
          <Capsule tone={tone} checking={checking} />
          {ping > 0 && <span key={ping} className="cab-ping" data-tone={tone} aria-hidden="true" />}
          <span className="cab-contact" aria-hidden="true" />
        </motion.span>
        <span className="cab-tag">
          <span className={cn('cab-tag-name', tone === 'flagged' && 'text-flagged')}>{item.name}</span>
          <span className="cab-tag-batch">{item.batch}</span>
        </span>
      </button>
    </li>
  )
}

type Part = { text: string; tone?: Tone }
type Summary = { tone: 'scanning' | 'flagged' | 'caution' | 'pending' | 'no_alert'; title: string; parts: Part[]; note?: string; eye: SentinelState }

function summarise(items: CabinetItem[], progress: { done: number; total: number } | null, now: number): Summary {
  const count = (s: Tone) => items.filter((i) => (i.last?.state ?? 'pending') === s).length
  const flagged = count('flagged')
  const retracted = count('retracted')
  const unreadable = count('unreadable')
  const quiet = count('no_alert')
  const pending = count('pending')
  const latest = items.reduce((m, i) => Math.max(m, i.last?.at ?? 0), 0)
  const parts: Part[] = [
    flagged ? { text: `${flagged} flagged`, tone: 'flagged' as const } : null,
    retracted ? { text: plural(retracted, 'retracted alert'), tone: 'retracted' as const } : null,
    unreadable ? { text: `${unreadable} can't tell`, tone: 'unreadable' as const } : null,
    quiet ? { text: `${quiet} no alert found`, tone: 'no_alert' as const } : null,
    pending ? { text: `${pending} not checked yet`, tone: 'pending' as const } : null,
    latest ? { text: `as of ${asOf(latest, now)}` } : null,
  ].filter((p): p is Part => p !== null)
  // The red banner above already says how many are flagged, so the shelf names what it watches
  // and lets the coloured counts carry the rest.
  const watching = `Watching ${plural(items.length, 'medicine')}`

  if (progress) {
    return {
      tone: 'scanning',
      title: 'Scanning your shelf',
      parts: [{ text: `Checking ${Math.min(progress.done + 1, progress.total)} of ${progress.total} against regulator alerts…` }],
      eye: 'scanning',
    }
  }
  if (flagged) return { tone: 'flagged', title: watching, parts, eye: 'flagged' }
  if (retracted || unreadable) return { tone: 'caution', title: watching, parts, eye: 'retracted' }
  if (pending) return { tone: 'pending', title: watching, parts, eye: 'idle' }
  return {
    tone: 'no_alert',
    title: `No alerts for ${items.length === 1 ? 'this batch' : 'these batches'} as of ${asOf(latest, now)}`,
    parts: [],
    note: 'That only means no published alert names them yet. It is not a safety certificate. Nazar checks again each time you open your cabinet.',
    eye: 'no_alert',
  }
}

const PART_TONE: Record<Tone, string> = {
  flagged: 'font-semibold text-flagged',
  retracted: 'font-semibold text-caution',
  unreadable: 'font-semibold text-caution',
  no_alert: 'text-quiet',
  pending: 'text-muted-foreground',
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="What the colours mean">
      <li className="flex items-center gap-1.5"><span className="cab-dot" data-tone="flagged" aria-hidden="true" />Flagged</li>
      <li className="flex items-center gap-1.5"><span className="cab-dot" data-tone="retracted" aria-hidden="true" />Can&apos;t tell or retracted</li>
      <li className="flex items-center gap-1.5"><span className="cab-dot" data-tone="no_alert" aria-hidden="true" />No alert found, not a safety check</li>
    </ul>
  )
}

export function CabinetShelf({
  items,
  now,
  checkingId,
  progress,
  onOpen,
}: {
  /** Already ordered: flagged first. */
  items: CabinetItem[]
  now: number
  checkingId: string | null
  progress: { done: number; total: number } | null
  onOpen: (id: string) => void
}) {
  const s = summarise(items, progress, now)
  const running = progress !== null

  return (
    <section className="cab-frame mt-5" data-shelf data-shelf-tone={s.tone} aria-labelledby="shelf-title">
      <div className="flex items-center gap-3 px-4 pt-4 sm:gap-5 sm:px-6 sm:pt-5">
        <SentinelEye state={s.eye} className="w-[4.25rem] shrink-0 sm:w-28" />
        <div className="min-w-0 flex-1">
          <h3 id="shelf-title" className="text-[11px] font-bold tracking-[0.18em] text-primary uppercase">
            Your shelf, watched
          </h3>
          <p className={cn('mt-1 text-[15px] leading-snug font-semibold text-pretty sm:text-lg', s.tone === 'no_alert' ? 'text-quiet' : 'text-foreground')} data-shelf-summary={s.tone}>
            {s.title}
          </p>
          {s.parts.length > 0 && (
            <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[13px] leading-5 text-muted-foreground" data-shelf-counts>
              {s.parts.map((p, i) => (
                <span key={p.text} className="whitespace-nowrap">
                  <span className={p.tone ? PART_TONE[p.tone] : undefined}>{p.text}</span>
                  {i < s.parts.length - 1 && <span aria-hidden="true"> ·</span>}
                </span>
              ))}
            </p>
          )}
          {s.note && <p className="mt-0.5 max-w-xl text-[13px] leading-5 text-pretty text-muted-foreground">{s.note}</p>}
        </div>
      </div>

      <div className="cab-wall mx-2.5 mt-4 sm:mx-5">
        {running && <span className="cab-beam" data-shelf-beam aria-hidden="true" />}
        <ul className="cab-rows" aria-label="Medicines on your shelf. Choose one to see its details.">
          {items.map((item) => (
            <ShelfItem key={item.id} item={item} checking={checkingId === item.id} now={now} onOpen={onOpen} />
          ))}
        </ul>
      </div>

      <div className="px-4 pt-3 pb-4 sm:px-6">
        <Legend />
      </div>
    </section>
  )
}

/** The empty cabinet: bare shelves, the eye waiting, and one clear way to start. */
export function EmptyShelf({ onAdd, onTry }: { onAdd: () => void; onTry: () => void }) {
  return (
    <section className="cab-frame mt-5" data-cabinet-empty data-shelf-empty aria-labelledby="shelf-empty-title">
      <div className="cab-wall mx-2.5 mt-2.5 sm:mx-5 sm:mt-5">
        <div className="flex justify-center pt-4 pb-1 sm:pt-6">
          <SentinelEye state="idle" className="w-24 sm:w-32" />
        </div>
        <ul className="cab-rows cab-rows-empty" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="cab-cell">
              <span className="cab-slot">
                <span className="cab-pill-wrap">
                  <Capsule tone="pending" ghost />
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col items-center px-5 pt-5 pb-6 text-center sm:pb-8">
        <h3 id="shelf-empty-title" className="text-lg font-semibold">Your cabinet is empty</h3>
        <p className="mt-1 max-w-sm text-sm leading-6 text-pretty text-muted-foreground">
          Put the medicines you keep at home on this shelf. Nazar watches each batch and re-checks it against regulator alerts whenever you come back.
        </p>
        <div className="mt-5 flex w-full flex-col items-stretch justify-center gap-2 min-[420px]:w-auto min-[420px]:flex-row min-[420px]:items-center">
          <Button className="h-12 px-5 font-semibold" onClick={onAdd} data-shelf-add>
            <Plus /> Add your first medicine
          </Button>
          <Button variant="outline" className="h-12 px-4" onClick={onTry}>
            Try adding <span className="font-mono font-semibold">SR-13</span>
          </Button>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground" data-shelf-privacy>
          <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
          <span>
            Saved only on this <span className="sm:hidden">phone</span>
            <span className="hidden sm:inline">device</span>. Never sent to any server.
          </span>
        </p>
      </div>
    </section>
  )
}
