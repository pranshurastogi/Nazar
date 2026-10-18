'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CalendarClock, LoaderCircle, Pill, QrCode, RotateCcw, ScanText, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AboutMedicine } from '@/components/nazar/medicine/about-medicine'
import { queryFromPack } from '@/components/nazar/medicine/query'
import type { CodeDate } from '@/lib/scan/gs1'
import { hasConfusableChars } from '@/lib/scan/labels'
import { packSummary, type PackLabel } from '@/lib/scan/pack'
import { formatCodeDate, isExpired, type ReadSource, type ScanRead } from '@/lib/scan/read'
import { validateBatch } from '@/lib/source/match'
import { INTL, translate, useT, type Locale, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { PackFields } from './pack-fields'

export type Found = {
  batch: string
  source: ReadSource
  kind: ScanRead['kind']
  expiry?: CodeDate
  mfg?: CodeDate
  gtin?: string
  /** A product name carried by the code itself (rare on Indian packs); merged into the label read. */
  codeName?: string
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

const FROM: Record<ReadSource, MessageKey> = { qr: 'scan.from.qr', datamatrix: 'scan.from.datamatrix', barcode: 'scan.from.barcode', text: 'scan.from.text' }
const KIND: Partial<Record<ScanRead['kind'], MessageKey>> = { gs1: 'scan.kind.gs1', url: 'scan.kind.url', label: 'scan.kind.label' }

type T = ReturnType<typeof useT>['t']

function confidenceLabel(f: Found, t: T): { text: string; tone: 'good' | 'ok' | 'low' } {
  if (f.source !== 'text') return { text: f.kind === 'bare' ? t('scan.conf.medium') : t('scan.conf.high'), tone: f.kind === 'bare' ? 'ok' : 'good' }
  const pct = Math.round(f.confidence ?? 0)
  return { text: t('scan.conf.pct', { n: pct }), tone: pct >= 85 ? 'ok' : 'low' }
}

/** "Apr 2027" in English (as before); "अप्रैल 2027" in Hindi. */
function codeDate(locale: Locale, d: CodeDate) {
  if (locale === 'en') return formatCodeDate(d)
  return new Date(Date.UTC(d.year, d.month - 1, d.day || 15)).toLocaleDateString(INTL[locale], { ...(d.day ? { day: 'numeric' } : {}), month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The ingredient line's " + 2 more" tail (built in lib/scan, in English) in the reader's language. */
export const moreIn = (locale: Locale, detail: string | undefined) =>
  detail && locale !== 'en' ? detail.replace(/ \+ (\d+) more\b/, (_, n: string) => translate(locale, 'scan.more', { n })) : detail

/** The medicine this pack is, brand first: "DOLO-650 · Paracetamol 650 mg · Micro Labs". */
function MedicineLine({ pack }: { pack?: PackLabel }) {
  const { t, locale } = useT()
  const { name, detail: read } = packSummary(pack)
  const detail = moreIn(locale, read)
  if (!name) return null
  const low = (pack?.brand ?? pack?.product)!.confidence < 0.6
  return (
    <div className="-mx-5 -mt-5 mb-4 flex items-start gap-3 rounded-t-2xl border-b bg-muted/40 px-5 py-4" data-scan-medicine>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-background text-foreground ring-1 ring-border" aria-hidden="true">
        <Pill className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">{pack?.brand ? t('scan.brandOnPack') : t('scan.medicineOnPack')}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xl leading-tight font-semibold tracking-tight break-words" data-scan-brand>
            {name}
          </span>
          {low && (
            <span className="rounded-full bg-caution-soft px-2 py-0.5 text-[11px] font-semibold text-caution" title={t('scan.lowConf')}>
              {t('scan.checkChip')}
            </span>
          )}
        </p>
        {detail && (
          <p className="mt-0.5 text-sm leading-5 text-muted-foreground break-words" data-scan-generic>
            {detail}
          </p>
        )}
      </div>
    </div>
  )
}

export function ScanResult({ found, onCheck, onRescan }: { found: Found; onCheck: (batch: string, pack?: PackLabel) => void; onRescan: () => void }) {
  const { t, tr, locale } = useT()
  const [value, setValue] = useState(found.batch)
  const [pack, setPack] = useState<PackLabel | undefined>(found.pack)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => setValue(found.batch), [found.batch])
  useEffect(() => setPack(found.pack), [found.pack])
  const v = validateBatch(value)
  const conf = confidenceLabel(found, t)
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
            <h3 className="text-lg font-semibold leading-snug tracking-tight">{t('scan.mismatch')}</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              {tr('scan.mismatchBody', {
                code: <span className="font-mono font-semibold text-foreground">{code}</span>,
                printed: <span className="font-mono font-semibold text-foreground">{printed}</span>,
              })}
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 min-[400px]:grid-cols-2">
          <Button variant="outline" className="h-12 rounded-xl" onClick={() => onCheck(code, pack)}>
            {tr('scan.checkCode', { batch: <span className="font-mono">{code}</span> })}
          </Button>
          <Button variant="outline" className="h-12 rounded-xl" onClick={() => onCheck(printed, pack)}>
            {tr('scan.checkPrinted', { batch: <span className="font-mono">{printed}</span> })}
          </Button>
        </div>
        <Button variant="ghost" className="mt-2 h-12 rounded-xl" onClick={onRescan}>
          <RotateCcw data-icon="inline-start" /> {t('scan.scanAgain')}
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
      <MedicineLine pack={pack} />
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          {found.source === 'text' ? <ScanText className="size-5" /> : <QrCode className="size-5" />}
        </span>
        <h3 className="min-w-0 text-lg font-semibold leading-snug tracking-tight">
          {tr('scan.weReadBatch', { batch: <span className="font-mono">{found.batch}</span> })}
        </h3>
      </div>

      <label htmlFor="scan-batch" className="mt-4 block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {t('scan.batchLabel')}
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

      <ul className="mt-3 flex flex-wrap gap-2 text-xs" aria-label={t('scan.howRead')}>
        <li className="rounded-full border px-2.5 py-1 font-medium">
          {t(FROM[found.source])}
          {KIND[found.kind] ? ` · ${t(KIND[found.kind]!)}` : ''}
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
            {t('scan.frames', { n: found.votes.votes, total: found.votes.of })}
          </li>
        )}
      </ul>

      {(found.expiry || found.mfg) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-scan-expiry>
          <CalendarClock className="size-4 text-muted-foreground" />
          {found.expiry && (
            <span>
              {tr('scan.exp', { date: <span className="font-semibold">{codeDate(locale, found.expiry)}</span> })}
            </span>
          )}
          {found.mfg && <span className="text-muted-foreground">{t('scan.mfg', { date: codeDate(locale, found.mfg) })}</span>}
          {expired && <span className="rounded-full bg-caution-soft px-2 py-0.5 text-xs font-semibold text-caution" data-scan-expired>{t('scan.expired')}</span>}
        </p>
      )}

      {found.source === 'text' && hasConfusableChars(found.batch) && (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t('scan.confusable')}
        </p>
      )}
      {pack && <PackFields pack={pack} onChange={setPack} />}
      {found.packPending && found.crossCheck !== 'pending' && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" data-pack-pending>
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> {t('scan.packPending')}
        </p>
      )}
      {found.crossCheck === 'pending' && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" data-scan-crosscheck="pending">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> {t('scan.crossPending')}
        </p>
      )}

      <div className="grid gap-2 pt-5">
        <Button type="submit" className="h-12 rounded-xl text-base font-semibold" disabled={!value.trim()}>
          {tr('scan.check', { batch: <span className="font-mono">{v.batch || t('scan.batchWord')}</span> })} <ArrowRight data-icon="inline-end" />
        </Button>
        <Button type="button" variant="ghost" className="h-12 rounded-xl" onClick={onRescan}>
          <RotateCcw data-icon="inline-start" /> {t('scan.scanAgain')}
        </Button>
      </div>
    </form>
    <AboutMedicine query={queryFromPack(pack, value)} />
    </div>
  )
}
