'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BookOpenText, ChevronDown, Info, LoaderCircle, RotateCcw, Sparkles, Stethoscope, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { API_URL } from '@/lib/source/config'
import { apiExplainMedicine, apiLikelyDown, type MedicineExplain, type MedicineQuery } from '@/lib/source/api'
import type { ResultState } from '@/lib/source'
import { cn } from '@/lib/utils'
import { AutoHeight } from './auto-height'
import { MedicineCard } from './medicine-card'
import { nameOf, realName } from './query'

// "About this medicine": opt-in, AI-written general information, kept visibly apart from the
// regulator verdict. Nothing is fetched until the person asks; on a flagged batch the official
// warning comes first, every time. When the label named no medicine (only "Tablet", say), the card
// asks for the name before anything is sent.

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; data: MedicineExplain }
  | { kind: 'disabled' }
  | { kind: 'limited'; message: string }
  | { kind: 'error'; message: string }

const queryKey = (q: MedicineQuery) => JSON.stringify([q.product, q.brand, q.composition, q.form])

/** Same rhythm everywhere in the module: 20 px sides on phones, 24 px from sm. */
const PAD = 'px-5 sm:px-6'

export function AboutMedicine({ query, verdict, className }: { query: MedicineQuery | null; verdict?: ResultState; className?: string }) {
  const reduce = useReducedMotion() ?? false
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [why, setWhy] = useState(false)
  const [typed, setTyped] = useState('')
  const [nameError, setNameError] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const whyId = useId()
  const nameId = useId()
  const key = query ? queryKey(query) : ''

  useEffect(() => {
    setState({ kind: 'idle' })
    setTyped('')
    setNameError(false)
    return () => ctrl.current?.abort()
  }, [key])

  // A build without an API (static deploy), or an API that just failed, cannot answer: show nothing rather than a dead button.
  if (!query || !API_URL || (state.kind === 'idle' && apiLikelyDown())) return null

  const name = nameOf(query)
  const typedName = realName(typed.replace(/\s+/g, ' ').trim())
  const shown = name ?? typedName ?? null

  const ask = async () => {
    // No name on the label: ask with the name the person typed, never with "Tablet" or nothing.
    const q = name ? query : typedName ? { ...query, product: typedName.slice(0, 110) } : null
    if (!q) {
      setNameError(true)
      nameRef.current?.focus()
      return
    }
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    setState({ kind: 'loading' })
    const r = await apiExplainMedicine(q, { signal: c.signal })
    if (c.signal.aborted) return
    if (r.ok) setState({ kind: 'done', data: r.data })
    else if (r.kind === 'disabled') setState({ kind: 'disabled' })
    else if (r.kind === 'limited') setState({ kind: 'limited', message: r.message })
    else setState({ kind: 'error', message: r.message })
  }

  // Disabled on the server: one quiet, tidy note, no card.
  if (state.kind === 'disabled') {
    return (
      <p
        className={cn('mt-4 flex items-center gap-2.5 rounded-2xl border border-dashed border-ai-border px-5 py-3.5 text-sm text-muted-foreground sm:px-6', className)}
        data-medicine="disabled"
        role="status"
      >
        <Info className="size-4 shrink-0 text-ai" aria-hidden="true" /> General medicine information isn&apos;t available right now.
      </p>
    )
  }

  const fade = reduce ? { initial: false as const } : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.22, ease: 'easeOut' as const } }

  return (
    <section
      className={cn('mt-4 overflow-hidden rounded-2xl border border-ai-border bg-ai-soft shadow-xs', className)}
      data-medicine={state.kind}
      aria-label="About this medicine: AI-generated general information"
      aria-busy={state.kind === 'loading' || undefined}
    >
      {verdict === 'flagged' && (
        <div className={cn('flex items-start gap-2.5 border-b border-flagged-border bg-flagged-soft py-3', PAD)} data-medicine-official-warning>
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-flagged" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-pretty text-flagged">This batch has an official alert – don&apos;t use it.</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Anything below is about the medicine in general, not about this batch.</p>
          </div>
        </div>
      )}

      {/* The disclosure: a badge, then the two caveats; the (i) explains where the text comes from. */}
      <div className={cn('flex items-center gap-2 pt-3.5', PAD)} data-medicine-ai-label>
        {/* Badge and caveats on one line from sm; on a phone the caveats sit under the badge instead of wrapping beside it. */}
        <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-ai px-2.5 text-[11px] font-bold tracking-wider text-white uppercase dark:text-background">
            <Sparkles className="size-3" aria-hidden="true" /> AI-generated
          </span>
          <span className="text-xs leading-4 text-muted-foreground">Not from a regulator · may be wrong</span>
        </div>
        <button
          type="button"
          className="-mr-3 ml-auto grid size-11 shrink-0 place-items-center rounded-full text-ai outline-none hover:bg-ai-border/40 focus-visible:ring-3 focus-visible:ring-ring/40"
          aria-expanded={why}
          aria-controls={whyId}
          aria-label="Why this is marked AI-generated"
          onClick={() => setWhy((v) => !v)}
        >
          <Info className="size-4" aria-hidden="true" />
        </button>
      </div>
      {why && (
        <motion.p
          {...fade}
          id={whyId}
          className="mx-5 mt-1 rounded-xl border border-ai-border bg-card px-3.5 py-2.5 text-xs leading-5 text-muted-foreground sm:mx-6"
          role="note"
        >
          This text is written by an AI model from general medical knowledge. It is not part of any regulator notice, is not checked on Arkiv, and can be
          incomplete or wrong. Only the verdict above comes from official sources. Nazar sends the medicine&apos;s name and ingredients, never your photo or who you are.
        </motion.p>
      )}

      <AutoHeight reduce={reduce}>
        <motion.div key={state.kind} {...fade} className="pt-3 pb-5">
          {state.kind === 'idle' && (
            <div className={PAD} data-medicine-prompt data-medicine-named={name ? 'label' : 'ask'}>
              <div className="flex items-start gap-3.5">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-ai-border bg-card text-ai dark:bg-ai/10" aria-hidden="true">
                  <BookOpenText className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold tracking-wider text-ai uppercase">General information</p>
                  <h3 className="mt-0.5 text-base leading-snug font-semibold tracking-tight text-balance" data-medicine-name>
                    About {name ? <span>{name}</span> : 'this medicine'}
                  </h3>
                  <p className="mt-1 max-w-prose text-sm leading-5 text-pretty text-muted-foreground">What it&apos;s for, side effects, when to get help.</p>
                </div>
              </div>

              {/* From sm the field and button line up with the text column; on a phone they span the panel. */}
              <div className="sm:pl-[3.625rem]">
                {!name && (
                  <div className="mt-4" data-medicine-confirm-name>
                    <label htmlFor={nameId} className="text-sm font-medium">
                      We couldn&apos;t read the medicine&apos;s name. Type it as printed on the pack.
                    </label>
                    <input
                      ref={nameRef}
                      id={nameId}
                      value={typed}
                      onChange={(e) => {
                        setTyped(e.target.value)
                        if (nameError) setNameError(false)
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && ask()}
                      placeholder="e.g. Dolo 650"
                      autoComplete="off"
                      maxLength={110}
                      aria-invalid={nameError || undefined}
                      aria-describedby={nameError ? `${nameId}-err` : undefined}
                      className="mt-2 h-11 w-full rounded-xl border border-ai-border bg-card px-3.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 sm:max-w-sm"
                    />
                    {nameError && (
                      <p id={`${nameId}-err`} className="mt-1.5 text-xs font-medium text-caution" role="status">
                        Type the medicine&apos;s name, not just its form (like “Tablet”).
                      </p>
                    )}
                  </div>
                )}

                <Button
                  className="mt-4 h-11 w-full rounded-xl border border-ai/25 bg-card px-4 font-semibold text-foreground shadow-xs hover:bg-ai/10 dark:bg-ai/10 dark:hover:bg-ai/20 sm:w-auto [&_svg]:text-ai"
                  onClick={ask}
                >
                  <Sparkles data-icon="inline-start" aria-hidden="true" /> Show general information <ChevronDown data-icon="inline-end" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}

          {state.kind === 'loading' && <Skeleton name={shown} />}

          {(state.kind === 'error' || state.kind === 'limited') && (
            <div className={PAD} data-medicine-error={state.kind} role="alert">
              <div className="flex items-start gap-3 rounded-xl border border-ai-border bg-card p-3.5">
                <Info className="mt-0.5 size-4 shrink-0 text-ai" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm">{state.message}</p>
                  {state.kind === 'limited' && <p className="mt-0.5 text-xs text-muted-foreground">Please try again in a few minutes. The verdict above is not affected.</p>}
                  {state.kind === 'error' && (
                    <Button variant="outline" className="mt-3 h-11 rounded-xl px-4" onClick={ask}>
                      <RotateCcw data-icon="inline-start" /> Try again
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {state.kind === 'done' && <MedicineCard data={state.data} />}
        </motion.div>
      </AutoHeight>

      <footer className={cn('flex items-start gap-2.5 border-t border-ai-border bg-card/60 py-3 text-xs leading-5', PAD)} data-medicine-footer>
        <Stethoscope className="mt-0.5 size-4 shrink-0 text-ai" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-pretty text-foreground">Not medical advice. Ask your doctor or pharmacist.</p>
          {state.kind === 'done' && <p className="text-muted-foreground">Written by AI from general medical knowledge – may be incomplete.</p>}
        </div>
      </footer>
    </section>
  )
}

/** Shaped like the finished card (title, chips, Nazar's count, story cards), so it opens without a jump. */
function Skeleton({ name }: { name: string | null }) {
  const bar = 'block animate-pulse rounded bg-ai-border/50 motion-reduce:animate-none'
  return (
    <div data-medicine-skeleton>
      <p className="sr-only" role="status">Loading general information…</p>
      <div className={PAD} aria-hidden="true">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> Writing a short summary{name ? ` about ${name}` : ''}…
        </p>
        <span className={cn(bar, 'mt-3 h-6 w-52 max-w-full')} />
        <span className={cn(bar, 'mt-2 h-4 w-72 max-w-full bg-ai-border/40')} />
        <span className={cn(bar, 'mt-3 h-7 w-56 max-w-full rounded-lg bg-ai-border/40')} />
        <span className="mt-4 block h-16 animate-pulse rounded-xl border bg-card motion-reduce:animate-none" />
      </div>
      <div className="mt-5 flex gap-3 overflow-hidden px-5 sm:grid sm:grid-cols-2 sm:px-6 lg:grid-cols-3" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={cn(
              'h-44 w-[85%] max-w-[19rem] shrink-0 animate-pulse rounded-xl border bg-card p-4 motion-reduce:animate-none sm:w-auto sm:max-w-none',
              i >= 2 && 'hidden sm:block',
              i >= 4 && 'sm:hidden lg:block',
            )}
          >
            <span className="flex items-center gap-2.5">
              <span className="size-8 rounded-lg bg-ai-soft" />
              <span className="h-3.5 w-24 rounded bg-muted" />
            </span>
            <span className="mt-4 block h-3 w-11/12 rounded bg-muted" />
            <span className="mt-2.5 block h-3 w-4/5 rounded bg-muted" />
            <span className="mt-2.5 block h-3 w-2/3 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
