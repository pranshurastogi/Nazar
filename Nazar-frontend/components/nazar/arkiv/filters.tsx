'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { STATE_NAME } from '@/lib/source'
import { CATEGORIES, FAILURES, FORMS, filterCount, type DirectoryFilters } from '@/lib/source/directory'
import { cn } from '@/lib/utils'
import { CATEGORY_LABEL, FAILURE_LABEL, SOURCE_LABEL } from './shared'

// The filter panel. Every control maps to one typed Arkiv attribute (see arkiv/schema.md);
// the query panel next to it shows the predicate each one adds.

type Apply = (patch: Partial<DirectoryFilters>) => void

const fieldCls =
  'h-11 w-full appearance-none rounded-xl border bg-background pl-3 pr-9 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30'
const inputCls =
  'h-11 w-full rounded-xl border bg-background px-3 text-sm font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30'

const STATES = Object.entries(STATE_NAME).sort((a, b) => a[1].localeCompare(b[1]))
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

function Field({ id, label, attr, children }: { id: string; label: string; attr: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2 text-xs font-semibold text-muted-foreground">
        <span>{label}</span>
        <code className="font-mono text-[11px] font-normal text-muted-foreground">{attr}</code>
      </label>
      {children}
    </div>
  )
}

function Select({ id, value, onChange, all, options }: { id: string; value: string; onChange: (v: string) => void; all: string; options: [string, string][] }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(fieldCls, value && 'border-primary/50 bg-primary/5')}>
        <option value="">{all}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  )
}

const toMonth = (ym: number) => (ym ? `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, '0')}` : '')
const fromMonth = (v: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(v)
  return m ? Number(m[1]) * 100 + Number(m[2]) : 0
}

function MonthInput({ id, value, onChange }: { id: string; value: number; onChange: (ym: number) => void }) {
  return <input id={id} type="month" min="2013-01" max="2099-12" value={toMonth(value)} onChange={(e) => onChange(fromMonth(e.target.value))} className={cn(inputCls, value && 'border-primary/50 bg-primary/5')} />
}

/** Text that only reaches the filters once it is valid, so a half-typed key never runs a query. */
function KeyInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const valid = draft === '' || /^0x[0-9a-fA-F]{64}$/.test(draft.trim())
  return (
    <>
      <input
        id={id}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        placeholder="0x… (64 hex)"
        aria-invalid={!valid}
        aria-describedby={valid ? undefined : `${id}-err`}
        onChange={(e) => {
          const v = e.target.value.trim()
          setDraft(v)
          if (v === '' || /^0x[0-9a-fA-F]{64}$/.test(v)) onChange(v)
        }}
        className={cn(inputCls, 'font-mono text-xs', value && 'border-primary/50 bg-primary/5', !valid && 'border-flagged')}
      />
      {!valid && <p id={`${id}-err`} className="mt-1 text-xs text-flagged">An entity key is 0x followed by 64 hex characters.</p>}
    </>
  )
}

export function FilterPanel({ filters, onApply, onReset, sources }: { filters: DirectoryFilters; onApply: Apply; onReset: () => void; sources: string[] }) {
  const n = filterCount(filters)
  const srcOptions: [string, string][] = [...new Set([...Object.keys(SOURCE_LABEL), ...sources])].filter((s) => s !== 'unknown').map((s) => [s, SOURCE_LABEL[s] ?? s])
  // On phones the controls fold away behind "Show filters" so the entities are not thousands of
  // pixels down; from lg up they are always open. Hidden controls stay mounted (CSS only).
  const [open, setOpen] = useState(false)
  return (
    <section aria-label="Filters" className="rounded-2xl border bg-card p-4 sm:p-5" data-filter-panel data-open={open ? 'true' : 'false'}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          Filters {n > 0 && <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary" data-filter-count>{n}</span>}
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="h-10 px-3 text-sm" onClick={onReset} disabled={n === 0}>
            <RotateCcw /> Reset
          </Button>
          <Button
            variant="outline"
            className="h-10 rounded-xl px-3 text-sm lg:hidden"
            aria-expanded={open}
            aria-controls="filter-body"
            onClick={() => setOpen((o) => !o)}
            data-filter-toggle
          >
            {open ? 'Hide' : 'Show'} <ChevronDown className={cn('transition-transform', open && 'rotate-180')} data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <div id="filter-body" className={cn(!open && 'max-lg:hidden')}>

      {filters.type === 'heartbeat' && (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The heartbeat has no filters: it is a single entity that lives 20 minutes and is renewed every 5 while the pipeline runs. If it is missing, the pipeline has stopped.
        </p>
      )}

      {filters.type === 'notice' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <Field id="f-src" label="Source" attr="src">
            <Select id="f-src" value={filters.src} onChange={(v) => onApply({ src: v })} all="All sources" options={srcOptions} />
          </Field>
          <Field id="f-notice-ym" label="Notice month" attr="notice_ym">
            <MonthInput id="f-notice-ym" value={filters.noticeYm} onChange={(v) => onApply({ noticeYm: v })} />
          </Field>
        </div>
      )}

      {filters.type === 'alert' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <Field id="f-batch" label="Batch number" attr="batch">
            <input
              id="f-batch"
              value={filters.batch}
              onChange={(e) => onApply({ batch: e.target.value.slice(0, 64) })}
              placeholder="e.g. SR-13"
              autoComplete="off"
              spellCheck={false}
              className={cn(inputCls, 'font-mono uppercase placeholder:normal-case', filters.batch && 'border-primary/50 bg-primary/5')}
            />
          </Field>
          <Field id="f-src" label="Source" attr="src">
            <Select id="f-src" value={filters.src} onChange={(v) => onApply({ src: v })} all="All sources" options={srcOptions} />
          </Field>
          <Field id="f-state" label="Manufacturing state" attr="state">
            <Select id="f-state" value={filters.state} onChange={(v) => onApply({ state: v })} all="All states" options={STATES} />
          </Field>
          <Field id="f-cat" label="Category" attr="cat">
            <Select id="f-cat" value={filters.cat} onChange={(v) => onApply({ cat: v })} all="All categories" options={CATEGORIES.map((c) => [c, CATEGORY_LABEL[c] ?? c])} />
          </Field>
          <Field id="f-fail" label="Failure" attr="fail">
            <Select id="f-fail" value={filters.fail} onChange={(v) => onApply({ fail: v })} all="Any failure" options={FAILURES.map((f) => [f, FAILURE_LABEL[f] ?? f])} />
          </Field>
          <Field id="f-form" label="Dosage form" attr="form">
            <Select id="f-form" value={filters.form} onChange={(v) => onApply({ form: v })} all="Any form" options={FORMS.map((f) => [f, cap(f)])} />
          </Field>
          <fieldset className="min-w-0">
            <legend className="mb-1 flex w-full items-baseline justify-between text-xs font-semibold text-muted-foreground">
              <span>Severity</span>
              <code className="font-mono text-[11px] font-normal text-muted-foreground">sev</code>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="sr-only" htmlFor="f-sev-min">Minimum severity</label>
              <Select
                id="f-sev-min"
                value={filters.sevMin ? String(filters.sevMin) : ''}
                onChange={(v) => onApply({ sevMin: Number(v) || 0, ...(filters.sevMax && Number(v) > filters.sevMax ? { sevMax: 0 } : {}) })}
                all="Min"
                options={[1, 2, 3, 4, 5].map((s) => [String(s), `≥ ${s}`])}
              />
              <label className="sr-only" htmlFor="f-sev-max">Maximum severity</label>
              <Select
                id="f-sev-max"
                value={filters.sevMax ? String(filters.sevMax) : ''}
                onChange={(v) => onApply({ sevMax: Number(v) || 0, ...(filters.sevMin && Number(v) && Number(v) < filters.sevMin ? { sevMin: 0 } : {}) })}
                all="Max"
                options={[1, 2, 3, 4, 5].map((s) => [String(s), `≤ ${s}`])}
              />
            </div>
          </fieldset>
          <Field id="f-peds" label="Child Shield" attr="peds">
            <Select
              id="f-peds"
              value={filters.peds}
              onChange={(v) => onApply({ peds: v as DirectoryFilters['peds'] })}
              all="Children and adults"
              options={[['1', 'Paediatric products only'], ['0', 'Not paediatric']]}
            />
          </Field>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border bg-background px-3 text-sm font-medium has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/30 sm:col-span-2 xl:col-span-1">
            <input id="f-in-date" type="checkbox" checked={filters.inDate} onChange={(e) => onApply({ inDate: e.target.checked })} className="size-4 accent-[var(--primary)]" />
            <span className="flex-1">Still in date</span>
            <code className="font-mono text-[11px] font-normal text-muted-foreground">exp_ym ≥ this month</code>
          </label>
          <fieldset className="min-w-0 sm:col-span-2 xl:col-span-1">
            <legend className="mb-1 flex w-full items-baseline justify-between text-xs font-semibold text-muted-foreground">
              <span>Alert month</span>
              <code className="font-mono text-[11px] font-normal text-muted-foreground">alert_ym</code>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="f-alert-from" className="sr-only">Alert month from</label>
                <MonthInput id="f-alert-from" value={filters.alertFrom} onChange={(v) => onApply({ alertFrom: v })} />
              </div>
              <div>
                <label htmlFor="f-alert-to" className="sr-only">Alert month to</label>
                <MonthInput id="f-alert-to" value={filters.alertTo} onChange={(v) => onApply({ alertTo: v })} />
              </div>
            </div>
          </fieldset>
          <div className="sm:col-span-2 xl:col-span-1">
            <Field id="f-notice" label="From notice (entity key)" attr="notice">
              <KeyInput id="f-notice" value={filters.notice} onChange={(v) => onApply({ notice: v })} />
            </Field>
          </div>
        </div>
      )}
      </div>
    </section>
  )
}
