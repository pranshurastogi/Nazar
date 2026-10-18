'use client'

import { useState } from 'react'
import { Bot, ChevronDown, FlaskConical, Info, LoaderCircle, Lock, RotateCcw, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Offered only when the photo read is weak (no name, a poorly read name, or no batch). It sends the
// label's OCR text and the device's own reads as hints, never the photo, and says so before the tap.
// With the opt-in "Use AI to fill missing details" switch on (remembered on this device), the guess runs
// by itself once a weak photo read finishes. "Get salts and details" is the small version for a read that
// found the name but not the ingredients.

export type AiState =
  | { kind: 'idle' }
  | { kind: 'loading'; auto?: boolean }
  | { kind: 'done'; filled: number; suggested: number; confidence: 'high' | 'medium' | 'low'; model: string }
  | { kind: 'disabled'; message: string }
  | { kind: 'limited'; message: string; minutes: number | null }
  | { kind: 'error'; message: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The opt-in switch: after a photo, fill missing details with AI by itself. Off until the person turns it on. */
export const AUTOFILL_KEY = 'nazar:ai-autofill'

export function readAutoFill(): boolean {
  try {
    return localStorage.getItem(AUTOFILL_KEY) === '1'
  } catch {
    return false
  }
}

export function writeAutoFill(on: boolean) {
  try {
    if (on) localStorage.setItem(AUTOFILL_KEY, '1')
    else localStorage.removeItem(AUTOFILL_KEY)
  } catch {}
}

function AutoFillSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="mt-3 flex items-start gap-3 border-t border-ai-border/70 pt-3" data-ai-autofill-row>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="ai-autofill-label"
        aria-describedby="ai-autofill-hint"
        onClick={() => onChange(!on)}
        className="relative -m-2 grid size-12 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
        data-ai-autofill={on ? 'on' : 'off'}
      >
        <span className={cn('h-6 w-10 rounded-full border transition-colors motion-reduce:transition-none', on ? 'border-ai bg-ai' : 'border-ai-border bg-card')} aria-hidden="true" />
        <span
          className={cn(
            'absolute top-1/2 left-1/2 size-4 -translate-y-1/2 rounded-full shadow-sm transition-transform motion-reduce:transition-none',
            on ? 'translate-x-[2px] bg-ai-soft' : '-translate-x-[18px] bg-ai',
          )}
          aria-hidden="true"
        />
      </button>
      <span className="min-w-0 pt-0.5">
        <span id="ai-autofill-label" className="block text-sm font-semibold">
          Use AI to fill missing details
        </span>
        <span id="ai-autofill-hint" className="block text-xs leading-5 text-muted-foreground">
          After each photo, when the name or batch is missing. Only the label text is sent. Saved on this device.
        </span>
      </span>
    </div>
  )
}

export function AiGuessPanel({
  state,
  text,
  reason,
  onGuess,
  prominent,
  autoFill,
  onAutoFill,
}: {
  state: AiState
  text: string
  reason: string
  onGuess: () => void
  /** No medicine name was read: the name matters most, so the offer is louder. */
  prominent?: boolean
  autoFill?: boolean
  onAutoFill?: (on: boolean) => void
}) {
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
    <section
      className={cn('rounded-2xl border bg-ai-soft px-4 py-3.5', prominent && state.kind !== 'done' ? 'border-ai/60 shadow-sm' : 'border-dashed border-ai-border')}
      aria-labelledby="ai-guess-title"
      data-ai-panel
      data-ai-state={state.kind}
      data-ai-prominent={prominent ? '' : undefined}
      aria-busy={state.kind === 'loading' || undefined}
    >
      <h3 id="ai-guess-title" className={cn('flex items-center gap-2 font-semibold', prominent && state.kind !== 'done' ? 'text-base' : 'text-sm')}>
        <Bot className="size-4 shrink-0 text-ai" aria-hidden="true" />
        {state.kind === 'done' ? 'AI guess added' : state.kind === 'loading' && state.auto ? 'Filling missing details with AI' : reason}
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
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {state.kind === 'loading' && state.auto
                ? 'Your switch is on, so Nazar is asking an AI to guess the missing details from the words it read on the label.'
                : prominent
                  ? 'The name is what you need most. Nazar can ask an AI to find it, and the salts, from the words it read on the label.'
                  : 'Nazar can ask an AI to guess the missing details from the words it read on the label.'}
            </p>
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
                variant={prominent ? 'default' : 'outline'}
                className={cn('mt-3 h-12 w-full rounded-xl px-4 font-semibold', prominent ? 'text-base' : 'bg-card min-[420px]:w-auto')}
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
              {onAutoFill && <AutoFillSwitch on={!!autoFill} onChange={onAutoFill} />}
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

/**
 * "Get salts and details": the name is known (from the label or the AI) but the ingredients are not. Sends
 * the same label text (never the photo) and fills only the empty composition and maker, from what the
 * label text says.
 */
export function AiDetails({ state, onRun, name }: { state: AiState; onRun: () => void; name: string }) {
  if (state.kind === 'disabled') return null
  if (state.kind === 'done') {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-dashed border-ai-border bg-ai-soft px-3.5 py-2.5 text-[13px] leading-5 text-muted-foreground" role="status" data-ai-details data-ai-details-state="done">
        <Bot className="mt-0.5 size-4 shrink-0 text-ai" aria-hidden="true" />
        <span>
          {state.filled
            ? 'Salts added from the label text, marked “AI guess”. Check them against the pack.'
            : 'The label text did not name the salts. Type them from the pack if you want them saved.'}
          <span className="mt-0.5 block text-xs text-ai">AI guess · not regulator data · may be wrong</span>
        </span>
      </p>
    )
  }
  return (
    <div className="rounded-xl border border-dashed border-ai-border bg-ai-soft px-3.5 py-3" data-ai-details data-ai-details-state={state.kind} aria-busy={state.kind === 'loading' || undefined}>
      <p className="text-sm leading-6 text-muted-foreground">
        We have the name, <span className="font-semibold text-foreground">{name}</span>, but not what is in it.
      </p>
      {(state.kind === 'limited' || state.kind === 'error') && (
        <p className="mt-1.5 text-sm leading-6" role="alert" data-ai-details-error={state.kind}>
          {state.message}
          {state.kind === 'limited' && ' Try again in a few minutes.'}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="mt-2 h-12 w-full rounded-xl bg-card px-4 font-semibold min-[420px]:w-auto"
        onClick={onRun}
        disabled={state.kind === 'loading' || state.kind === 'limited'}
        data-ai-details-run
      >
        {state.kind === 'loading' ? (
          <>
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Reading the salts…
          </>
        ) : (
          <>
            <FlaskConical aria-hidden="true" /> Get salts and details
          </>
        )}
      </Button>
      <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>An AI reads the salts from the label text only. The photo stays on this phone.</span>
      </p>
      {state.kind === 'loading' && (
        <p className="sr-only" role="status">
          Asking the AI for the salts from the label text…
        </p>
      )}
    </div>
  )
}
