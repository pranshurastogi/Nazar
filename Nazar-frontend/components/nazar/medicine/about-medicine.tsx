'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Bot, Info, LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { API_URL } from '@/lib/source/config'
import { apiExplainMedicine, apiLikelyDown, type MedicineExplain, type MedicineQuery } from '@/lib/source/api'
import type { ResultState } from '@/lib/source'
import { MedicineCard } from './medicine-card'

// "About this medicine": opt-in, AI-written general information, kept visibly apart from the
// regulator verdict. Nothing is fetched until the person asks; on a flagged batch the official
// warning comes first, every time.

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; data: MedicineExplain }
  | { kind: 'disabled' }
  | { kind: 'limited'; message: string }
  | { kind: 'error'; message: string }

const queryKey = (q: MedicineQuery) => JSON.stringify([q.product, q.brand, q.composition, q.form])

/** A readable name for the prompt line: brand/product first, else the first ingredient. */
const nameOf = (q: MedicineQuery) => q.product || q.brand || q.composition?.[0] || 'this medicine'

export function AboutMedicine({ query, verdict, className }: { query: MedicineQuery | null; verdict?: ResultState; className?: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [why, setWhy] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  const whyId = useId()
  const titleId = useId()
  const key = query ? queryKey(query) : ''

  useEffect(() => {
    setState({ kind: 'idle' })
    return () => ctrl.current?.abort()
  }, [key])

  // A build without an API (static deploy), or an API that just failed, cannot answer: show nothing rather than a dead button.
  if (!query || !API_URL || (state.kind === 'idle' && apiLikelyDown())) return null

  const ask = async () => {
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    setState({ kind: 'loading' })
    const r = await apiExplainMedicine(query, { signal: c.signal })
    if (c.signal.aborted) return
    if (r.ok) setState({ kind: 'done', data: r.data })
    else if (r.kind === 'disabled') setState({ kind: 'disabled' })
    else if (r.kind === 'limited') setState({ kind: 'limited', message: r.message })
    else setState({ kind: 'error', message: r.message })
  }

  // Disabled on the server: one quiet line, no card.
  if (state.kind === 'disabled') {
    return (
      <p className={'mt-4 flex items-center gap-2 px-1 text-sm text-muted-foreground ' + (className ?? '')} data-medicine="disabled" role="status">
        <Info className="size-4 shrink-0" aria-hidden="true" /> General medicine information isn&apos;t available right now.
      </p>
    )
  }

  return (
    <section
      className={'mt-4 overflow-hidden rounded-2xl border border-dashed border-ai-border bg-ai-soft ' + (className ?? '')}
      data-medicine={state.kind}
      aria-labelledby={titleId}
      aria-busy={state.kind === 'loading' || undefined}
    >
      {verdict === 'flagged' && (
        <div className="border-b border-flagged-border bg-flagged-soft px-4 py-3 sm:px-5" data-medicine-official-warning>
          <p className="flex items-start gap-2 text-sm font-semibold text-flagged">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            This batch has an official alert – don&apos;t use it.
          </p>
          <p className="mt-0.5 pl-6 text-xs text-muted-foreground">Anything below is about the medicine in general, not about this batch.</p>
        </div>
      )}

      <div className="flex items-start gap-2 px-4 pt-3.5 sm:px-5" data-medicine-ai-label>
        <Bot className="mt-0.5 size-4 shrink-0 text-ai" aria-hidden="true" />
        <p id={titleId} className="min-w-0 flex-1 text-xs font-semibold leading-5 text-ai">
          AI-generated general information · not from a regulator · may be wrong
        </p>
        <button
          type="button"
          className="-my-3 -mr-3 grid size-12 shrink-0 place-items-center rounded-full text-ai hover:bg-ai-border/40 focus-visible:ring-3 focus-visible:ring-ring/40 outline-none"
          aria-expanded={why}
          aria-controls={whyId}
          aria-label="Why this is marked AI-generated"
          onClick={() => setWhy((v) => !v)}
        >
          <Info className="size-4" aria-hidden="true" />
        </button>
      </div>
      {why && (
        <p id={whyId} className="mx-4 mt-2 rounded-lg border border-ai-border bg-card px-3 py-2 text-xs leading-5 text-muted-foreground sm:mx-5" role="note">
          This text is written by an AI model from general medical knowledge. It is not part of any regulator notice, is not checked on Arkiv, and can be
          incomplete or wrong. Only the verdict above comes from official sources. Nazar sends the medicine&apos;s name and ingredients, never your photo or who you are.
        </p>
      )}

      <div className="py-4">
        {state.kind === 'idle' && (
          <div className="px-4 sm:px-5" data-medicine-prompt>
            <h3 className="text-base font-semibold tracking-tight">Want to know what this medicine is for?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Short, general notes about <span className="font-medium text-foreground">{nameOf(query)}</span>: uses, side effects and when to get help.
            </p>
            <Button variant="outline" className="mt-3 h-12 rounded-xl bg-card px-4 font-semibold" onClick={ask}>
              Show general information
            </Button>
          </div>
        )}

        {state.kind === 'loading' && (
          <div className="px-4 sm:px-5" data-medicine-skeleton>
            <p className="sr-only" role="status">Loading general information…</p>
            <span aria-hidden="true" className="block h-5 w-48 animate-pulse rounded bg-ai-border/50 motion-reduce:animate-none" />
            <span aria-hidden="true" className="mt-2 block h-3.5 w-64 max-w-full animate-pulse rounded bg-ai-border/40 motion-reduce:animate-none" />
            <div className="mt-4 flex gap-3 overflow-hidden sm:grid sm:grid-cols-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-36 w-[80%] shrink-0 animate-pulse rounded-xl border bg-card motion-reduce:animate-none sm:w-auto" />
              ))}
            </div>
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" aria-hidden="true">
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> Writing a short summary…
            </p>
          </div>
        )}

        {(state.kind === 'error' || state.kind === 'limited') && (
          <div className="px-4 sm:px-5" data-medicine-error={state.kind} role="alert">
            <p className="text-sm">{state.message}</p>
            {state.kind === 'error' && (
              <Button variant="outline" className="mt-3 h-12 rounded-xl bg-card px-4" onClick={ask}>
                <RotateCcw data-icon="inline-start" /> Try again
              </Button>
            )}
          </div>
        )}

        {state.kind === 'done' && <MedicineCard data={state.data} />}
      </div>

      <footer className="border-t border-ai-border px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5" data-medicine-footer>
        <p className="font-semibold text-foreground">Not medical advice. Ask your doctor or pharmacist.</p>
        {state.kind === 'done' && <p>Written by AI from general medical knowledge – may be incomplete.</p>}
      </footer>
    </section>
  )
}
