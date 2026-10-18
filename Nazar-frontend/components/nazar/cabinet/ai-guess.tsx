'use client'

import { useState } from 'react'
import { Bot, ChevronDown, Info, LoaderCircle, Lock, RotateCcw, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Offered only when the photo read is weak (no name, a poorly read name, or no batch). It sends the
// label's OCR text and the device's own reads as hints, never the photo, and says so before the tap.

export type AiState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; filled: number; suggested: number; confidence: 'high' | 'medium' | 'low'; model: string }
  | { kind: 'disabled'; message: string }
  | { kind: 'limited'; message: string; minutes: number | null }
  | { kind: 'error'; message: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function AiGuessPanel({ state, text, reason, onGuess }: { state: AiState; text: string; reason: string; onGuess: () => void }) {
  const [showText, setShowText] = useState(false)
  const canSend = text.trim().length >= 3

  if (state.kind === 'disabled') {
    return (
      <p className="flex items-start gap-2 rounded-xl border bg-muted/50 px-3.5 py-3 text-sm leading-6 text-muted-foreground" role="status" data-ai-panel data-ai-state="disabled">
        <Info className="mt-1 size-4 shrink-0" aria-hidden="true" />
        <span>
          {state.message} Type the missing details from the pack.
        </span>
      </p>
    )
  }

  return (
    <section className="rounded-2xl border border-dashed border-ai-border bg-ai-soft px-4 py-3.5" aria-labelledby="ai-guess-title" data-ai-panel data-ai-state={state.kind} aria-busy={state.kind === 'loading' || undefined}>
      <h3 id="ai-guess-title" className="flex items-center gap-2 text-sm font-semibold">
        <Bot className="size-4 shrink-0 text-ai" aria-hidden="true" />
        {state.kind === 'done' ? 'AI guess added' : reason}
      </h3>

      {state.kind === 'done' ? (
        <div className="mt-1 text-[13px] leading-5 text-muted-foreground" role="status" data-ai-done>
          <p>
            {state.filled
              ? `Filled ${plural(state.filled, 'empty field')}, marked “AI guess”. Check each against the pack before you save.`
              : state.suggested
                ? 'Nothing was changed. The AI’s suggestions are under the fields: use them only if they match the pack.'
                : 'The AI could not add anything. Type the missing details from the pack.'}
          </p>
          {state.filled > 0 && state.suggested > 0 && <p className="mt-1">Other suggestions sit under their fields and change nothing unless you tap Use this.</p>}
          {state.confidence === 'low' && <p className="mt-1 font-medium text-caution">The AI was not sure about this one.</p>}
          <p className="mt-1.5 text-xs text-ai">AI guess from the label text{state.model ? ` · ${state.model}` : ''} · not regulator data · may be wrong</p>
        </div>
      ) : (
        <>
          {canSend ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Nazar can ask an AI to guess the missing details from the words it read on the label.</p>
          ) : (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Almost no text could be read, so there is nothing to guess from. Try a closer, sharper photo in good light, or type the details.</p>
          )}

          {(state.kind === 'limited' || state.kind === 'error') && (
            <p className="mt-2 rounded-lg border bg-card px-3 py-2 text-sm leading-6" role="alert" data-ai-error={state.kind}>
              {state.message}
              {state.kind === 'limited' && (state.minutes ? ` Try again in ${plural(state.minutes, 'minute')}.` : ' Try again in a few minutes.')}
              {state.kind === 'error' && ' You can try again, or type the details.'}
            </p>
          )}

          {canSend && (
            <>
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-12 w-full rounded-xl bg-card px-4 font-semibold min-[420px]:w-auto"
                onClick={onGuess}
                disabled={state.kind === 'loading' || state.kind === 'limited'}
                data-ai-guess
              >
                {state.kind === 'loading' ? (
                  <>
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Guessing…
                  </>
                ) : state.kind === 'error' ? (
                  <>
                    <RotateCcw aria-hidden="true" /> Try the AI guess again
                  </>
                ) : (
                  <>
                    <Sparkles aria-hidden="true" /> Guess with AI
                  </>
                )}
              </Button>
              <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground" data-ai-disclosure>
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>Only the text read from the label is sent to Nazar&apos;s server for Gemini to guess. The photo stays on this phone.</span>
              </p>
              <button
                type="button"
                className="mt-1 inline-flex min-h-9 items-center gap-1 rounded-lg text-xs font-semibold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                aria-expanded={showText}
                aria-controls="ai-sent-text"
                onClick={() => setShowText((v) => !v)}
              >
                See exactly what is sent
                <ChevronDown className={cn('size-3.5 transition-transform motion-reduce:transition-none', showText && 'rotate-180')} aria-hidden="true" />
              </button>
              {showText && (
                <pre id="ai-sent-text" className="mt-1 max-h-36 overflow-y-auto rounded-lg border bg-card px-3 py-2 font-mono text-[11px] leading-4 break-words whitespace-pre-wrap text-muted-foreground">
                  {text.trim().slice(0, 4000)}
                </pre>
              )}
            </>
          )}
          {state.kind === 'loading' && (
            <p className="sr-only" role="status">
              Asking the AI to guess from the label text…
            </p>
          )}
        </>
      )}
    </section>
  )
}
