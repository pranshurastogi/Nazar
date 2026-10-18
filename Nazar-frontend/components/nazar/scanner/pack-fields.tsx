'use client'

import { useId, useState } from 'react'
import { Check, Pencil } from 'lucide-react'

import { useT, type MessageKey } from '@/lib/i18n'
import { genericOf, type PackField, type PackLabel } from '@/lib/scan/pack'
import { cn } from '@/lib/utils'

// The rest of the label, read on the device: brand, product, composition, maker, licence, MRP. Shown as a
// tidy list with a per-field confidence hint; "Edit" turns every value into an input.

type Key = 'brand' | 'product' | 'composition' | 'form' | 'packSize' | 'manufacturer' | 'manufacturerState' | 'licence' | 'mrp'

const ROWS: { key: Key; label: MessageKey; multiline?: boolean }[] = [
  { key: 'brand', label: 'scan.field.brand' },
  { key: 'product', label: 'scan.field.product' },
  { key: 'composition', label: 'scan.field.composition', multiline: true },
  { key: 'form', label: 'scan.field.form' },
  { key: 'packSize', label: 'scan.field.packSize' },
  { key: 'manufacturer', label: 'scan.field.manufacturer' },
  { key: 'manufacturerState', label: 'scan.field.manufacturerState' },
  { key: 'licence', label: 'scan.field.licence' },
  { key: 'mrp', label: 'scan.field.mrp' },
]

/** With a brand read, the product line is the generic description (unless it only repeats the brand, "Sinarest Tablets"). */
const labelOf = (r: (typeof ROWS)[number], pack: PackLabel): MessageKey => (r.key === 'product' && genericOf(pack) && pack.brand ? 'scan.field.generic' : r.label)

/** Lowest confidence that still reads as fine; below it the value gets a "check" hint. */
const OK = 0.6

function fieldOf(pack: PackLabel, key: Key): { value: string; confidence: number } | undefined {
  if (key === 'composition') {
    if (!pack.composition.length) return undefined
    return { value: pack.composition.map((c) => c.value).join('\n'), confidence: Math.min(...pack.composition.map((c) => c.confidence)) }
  }
  return pack[key] as PackField | undefined
}

/** Applies edited text back onto the label, keeping confidences for untouched values. */
function withEdit(pack: PackLabel, key: Key, value: string): PackLabel {
  const v = value.trim()
  if (key === 'composition') {
    const lines = value.split('\n').map((l) => l.trim()).filter(Boolean)
    return { ...pack, composition: lines.map((l) => pack.composition.find((c) => c.value === l) ?? { value: l, confidence: 1 }) }
  }
  const next = { ...pack }
  if (v) next[key] = { value: v, confidence: (pack[key] as PackField | undefined)?.value === v ? (pack[key] as PackField).confidence : 1 }
  else delete next[key]
  return next
}

export function PackFields({ pack, onChange }: { pack: PackLabel; onChange: (p: PackLabel) => void }) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const id = useId()
  const rows = ROWS.filter((r) => editing || fieldOf(pack, r.key))
  if (!rows.length && !pack.schedule) return null

  return (
    <div className="mt-4 rounded-xl border bg-background/60" data-pack-fields>
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('scan.onLabel')}</p>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          aria-pressed={editing}
          className="inline-flex min-h-12 min-w-12 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {editing ? <Check className="size-4" aria-hidden="true" /> : <Pencil className="size-4" aria-hidden="true" />}
          {editing ? t('scan.done') : t('scan.edit')}
        </button>
      </div>
      {pack.schedule && (
        <p className="mx-3.5 mt-3 inline-flex rounded-full border border-caution-border bg-caution-soft px-2.5 py-1 text-xs font-semibold text-caution" data-pack-schedule>
          {t('scan.schedule', { s: pack.schedule.value })}
        </p>
      )}
      <dl className="grid gap-0 px-3.5 py-1.5 text-sm">
        {rows.map((r) => {
          const f = fieldOf(pack, r.key)
          const low = f && f.confidence < OK
          const inputId = `${id}-${r.key}`
          return (
            <div key={r.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 border-b border-border/60 py-2 last:border-0" data-pack-field={r.key}>
              <dt className="pt-0.5 text-xs font-medium text-muted-foreground">
                {editing ? <label htmlFor={inputId}>{t(labelOf(r, pack))}</label> : t(labelOf(r, pack))}
              </dt>
              <dd className="min-w-0">
                {editing ? (
                  r.multiline ? (
                    <textarea
                      id={inputId}
                      rows={Math.max(2, (f?.value.split('\n').length ?? 1) + 0)}
                      defaultValue={f?.value ?? ''}
                      onBlur={(e) => onChange(withEdit(pack, r.key, e.target.value))}
                      className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
                    />
                  ) : (
                    <input
                      id={inputId}
                      defaultValue={f?.value ?? ''}
                      onBlur={(e) => onChange(withEdit(pack, r.key, e.target.value))}
                      autoComplete="off"
                      className="h-10 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
                    />
                  )
                ) : (
                  <span className="flex items-start justify-between gap-2">
                    <span className={cn('min-w-0 break-words whitespace-pre-line', r.key === 'licence' && 'font-mono text-[13px]')}>{f?.value}</span>
                    {low && (
                      <span className="shrink-0 rounded-full bg-caution-soft px-2 py-0.5 text-[11px] font-semibold text-caution" title={t('scan.readWith', { n: Math.round(f.confidence * 100) })}>
                        {t('scan.checkChip')}
                      </span>
                    )}
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
