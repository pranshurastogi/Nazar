'use client'

import { Popover } from '@base-ui/react/popover'
import { Bot, QrCode, ScanText } from 'lucide-react'

import { cn } from '@/lib/utils'
import { isLow, type Source, type Suggestion } from './prefill'

// The small line under a pre-filled field that says where its value came from: the printed label
// (with the reader's confidence), a code on the pack, or an AI guess (with the label text it quoted).
// Typing in the field removes it: the value is then the person's own.

const CODE: Record<string, string> = { qr: 'QR code', datamatrix: 'Data Matrix code', barcode: 'barcode', text: 'label' }
const chip = 'inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs leading-4 font-semibold'

export function FieldSource({ source, field }: { source: Source; field: string }) {
  if (source.kind === 'label') {
    const pct = Math.round(source.confidence * 100)
    const low = isLow(source)
    return (
      <span className={cn(chip, low ? 'border border-caution-border bg-caution-soft text-caution' : 'bg-muted text-muted-foreground')} data-field-source="label" data-confidence={pct}>
        <ScanText className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          Read from the label · {pct}%{low ? ' · check this' : ''}
        </span>
      </span>
    )
  }
  if (source.kind === 'code') {
    return (
      <span className={cn(chip, 'bg-primary/10 text-primary')} data-field-source="code">
        <QrCode className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">From the {CODE[source.from] ?? 'code'} · high confidence</span>
      </span>
    )
  }
  return <AiChip quote={source.quote} field={field} />
}

/** "AI guess · check this", with the label text the model quoted, opened by tap, click, focus+Enter or hover. */
export function AiChip({ quote, field }: { quote?: string; field: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        openOnHover
        delay={150}
        className={cn(
          chip,
          'relative cursor-pointer border border-dashed border-ai-border bg-ai-soft text-ai outline-none after:absolute after:-inset-2 hover:bg-ai-border/40 focus-visible:ring-3 focus-visible:ring-ring/40',
        )}
        aria-label={`AI guess for ${field}, check this. Show what the AI read`}
        data-field-source="ai"
      >
        <Bot className="size-3.5 shrink-0" aria-hidden="true" />
        AI guess · check this
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-[60]">
          <Popover.Popup
            className="w-[min(18rem,calc(100vw-2rem))] origin-(--transform-origin) rounded-xl border border-ai-border bg-popover p-3 text-xs leading-5 text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
            data-ai-evidence
          >
            <Popover.Title className="flex items-center gap-1.5 text-xs font-semibold text-ai">
              <Bot className="size-3.5" aria-hidden="true" /> Guessed by AI, not regulator data
            </Popover.Title>
            <Popover.Description render={<div />} className="mt-1.5 grid gap-1.5 text-muted-foreground">
              {quote ? (
                <p>
                  From the label text: <q className="font-mono text-[12px] font-semibold text-foreground">{quote}</q>
                </p>
              ) : (
                <p>The AI did not quote the label for this one, so check it carefully.</p>
              )}
              <p>Compare it with the pack and change it if it differs.</p>
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** A guess for a field the label already read well (or the person typed): shown, never applied without a tap. */
export function SuggestionRow({ s, display, onUse, onDismiss }: { s: Suggestion; display: string; onUse: () => void; onDismiss: () => void }) {
  return (
    <div className="mt-1.5 rounded-xl border border-dashed border-ai-border bg-ai-soft px-3 pt-2 pb-1 text-xs leading-5" data-ai-suggestion={s.field}>
      <p className="flex items-start gap-1.5 text-muted-foreground">
        <Bot className="mt-0.5 size-3.5 shrink-0 text-ai" aria-hidden="true" />
        <span className="min-w-0">
          AI suggests <span className="font-semibold break-words text-foreground">{display}</span>
          {s.quote && (
            <span className="block">
              From the label text: <q className="font-mono text-[11px]">{s.quote}</q>
            </span>
          )}
        </span>
      </p>
      <div className="mt-0.5 flex gap-1 pl-3.5">
        <button type="button" onClick={onUse} className="min-h-10 rounded-lg px-2.5 font-semibold text-primary outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40">
          Use this
        </button>
        <button type="button" onClick={onDismiss} className="min-h-10 rounded-lg px-2.5 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40">
          Keep mine
        </button>
      </div>
    </div>
  )
}
