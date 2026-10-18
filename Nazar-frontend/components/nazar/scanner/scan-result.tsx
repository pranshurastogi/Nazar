'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CalendarClock, LoaderCircle, QrCode, RotateCcw, ScanText, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AboutMedicine } from '@/components/nazar/medicine/about-medicine'
import { queryFromPack } from '@/components/nazar/medicine/query'
import type { CodeDate } from '@/lib/scan/gs1'
import { hasConfusableChars } from '@/lib/scan/labels'
import type { PackLabel } from '@/lib/scan/pack'
import { formatCodeDate, isExpired, type ReadSource, type ScanRead } from '@/lib/scan/read'
import { validateBatch } from '@/lib/source/match'
import { cn } from '@/lib/utils'
import { PackFields } from './pack-fields'

export type Found = {
  batch: string
  source: ReadSource
  kind: ScanRead['kind']
  expiry?: CodeDate
  mfg?: CodeDate
  gtin?: string
  /** Live reads: how many of the recent frames agreed. */
  votes?: { votes: number; of: number }
  /** OCR confidence, 0-100. Codes have none: they are error-corrected. */
  confidence?: number
  /** Printed-text second opinion on a code read. */
  crossCheck: 'pending' | 'done' | 'none'
  mismatch?: { code: string; printed: string }
  /** The rest of the printed label (product, composition, maker…), read on the device. */
  pack?: PackLabel
  /** The whole-label read is still running. */
  packPending?: boolean
}

const FROM: Record<ReadSource, string> = { qr: 'QR code', datamatrix: 'Data Matrix code', barcode: 'Barcode', text: 'Printed text' }
const KIND: Partial<Record<ScanRead['kind'], string>> = { gs1: 'GS1', url: 'link', label: 'label text' }

function confidenceLabel(f: Found): { text: string; tone: 'good' | 'ok' | 'low' } {
  if (f.source !== 'text') return { text: f.kind === 'bare' ? 'Medium confidence' : 'High confidence', tone: f.kind === 'bare' ? 'ok' : 'good' }
  const pct = Math.round(f.confidence ?? 0)
  return { text: `${pct}% confidence`, tone: pct >= 85 ? 'ok' : 'low' }
}

export function ScanResult({ found, onCheck, onRescan }: { found: Found; onCheck: (batch: string, pack?: PackLabel) => void; onRescan: () => void }) {
  const [value, setValue] = useState(found.batch)
  const [pack, setPack] = useState<PackLabel | undefined>(found.pack)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => setValue(found.batch), [found.batch])
  useEffect(() => setPack(found.pack), [found.pack])
  const v = validateBatch(value)
  const conf = confidenceLabel(found)
  const expired = found.expiry && isExpired(found.expiry)

  if (found.mismatch) {
    const { code, printed } = found.mismatch
    return (
      <div className="flex flex-col rounded-2xl border border-caution-border bg-caution-soft p-5" data-scan-result="mismatch" role="alert">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-caution/15 text-caution">
            <TriangleAlert className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold leading-snug tracking-tight">Label details don&apos;t match. Show this pack to your chemist.</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              The code says batch <span className="font-mono font-semibold text-foreground">{code}</span>, the printed label says{' '}
              <span className="font-mono font-semibold text-foreground">{printed}</span>. A genuine pack prints the same batch in both places.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 min-[400px]:grid-cols-2">
          <Button variant="outline" className="h-12 rounded-xl" onClick={() => onCheck(code, pack)}>
            Check code batch <span className="font-mono">{code}</span>
          </Button>
          <Button variant="outline" className="h-12 rounded-xl" onClick={() => onCheck(printed, pack)}>
            Check printed <span className="font-mono">{printed}</span>
          </Button>
        </div>
        <Button variant="ghost" className="mt-2 h-12 rounded-xl" onClick={onRescan}>
          <RotateCcw data-icon="inline-start" /> Scan again
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
    <form
      className="flex flex-col rounded-2xl border bg-card p-5"
      data-scan-result="read"
      onSubmit={(e) => {
        e.preventDefault()
        if (v.ok) onCheck(v.batch, pack)
        else inputRef.current?.focus()
      }}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          {found.source === 'text' ? <ScanText className="size-5" /> : <QrCode className="size-5" />}
        </span>
        <h3 className="min-w-0 text-lg font-semibold leading-snug tracking-tight">
          We read <span className="font-mono">{found.batch}</span> – check it?
        </h3>
      </div>

      <label htmlFor="scan-batch" className="mt-4 block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Batch number · edit if it differs from the pack
      </label>
      <input
        ref={inputRef}
        id="scan-batch"
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-invalid={!v.ok || undefined}
        className="mt-1.5 h-14 w-full rounded-xl border bg-background px-4 font-mono text-2xl tracking-wider uppercase outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
      />

      <ul className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="How it was read">
        <li className="rounded-full border px-2.5 py-1 font-medium">
          {FROM[found.source]}
          {KIND[found.kind] ? ` · ${KIND[found.kind]}` : ''}
        </li>
        <li
          className={cn(
            'rounded-full px-2.5 py-1 font-semibold',
            conf.tone === 'good' && 'bg-primary/10 text-primary',
            conf.tone === 'ok' && 'bg-quiet-soft text-quiet',
            conf.tone === 'low' && 'bg-caution-soft text-caution',
          )}
          data-scan-confidence
        >
          {conf.text}
        </li>
        {found.votes && found.votes.of > 1 && (
          <li className="rounded-full border px-2.5 py-1 text-muted-foreground">
            {found.votes.votes} of {found.votes.of} frames agree
          </li>
        )}
      </ul>

      {(found.expiry || found.mfg) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-scan-expiry>
          <CalendarClock className="size-4 text-muted-foreground" />
          {found.expiry && (
            <span>
              Exp <span className="font-semibold">{formatCodeDate(found.expiry)}</span>
            </span>
          )}
          {found.mfg && <span className="text-muted-foreground">Mfg {formatCodeDate(found.mfg)}</span>}
          {expired && <span className="rounded-full bg-caution-soft px-2 py-0.5 text-xs font-semibold text-caution">Past its expiry date</span>}
        </p>
      )}

      {found.source === 'text' && hasConfusableChars(found.batch) && (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Printed text can be misread (0/O, 1/I, 5/S, 8/B). Compare it with the pack before you check.
        </p>
      )}
      {pack && <PackFields pack={pack} onChange={setPack} />}
      {found.packPending && found.crossCheck !== 'pending' && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" data-pack-pending>
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> Reading the rest of the label…
        </p>
      )}
      {found.crossCheck === 'pending' && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" data-scan-crosscheck="pending">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> Comparing with the printed label…
        </p>
      )}

      <div className="grid gap-2 pt-5">
        <Button type="submit" className="h-12 rounded-xl text-base font-semibold" disabled={!value.trim()}>
          Check <span className="font-mono">{v.batch || 'batch'}</span> <ArrowRight data-icon="inline-end" />
        </Button>
        <Button type="button" variant="ghost" className="h-12 rounded-xl" onClick={onRescan}>
          <RotateCcw data-icon="inline-start" /> Scan again
        </Button>
      </div>
    </form>
    <AboutMedicine query={queryFromPack(pack, value)} />
    </div>
  )
}
