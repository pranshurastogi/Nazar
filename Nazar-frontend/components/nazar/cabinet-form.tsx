'use client'

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { BookmarkCheck, BookmarkPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { addItem, findByBatch, NAME_MAX, NOTE_MAX, updateItem, useCabinet, type CabinetDraft, type CabinetItem } from '@/lib/cabinet'
import { validateBatch, type CheckResult } from '@/lib/source'
import { cn } from '@/lib/utils'

// Add / edit form for the cabinet, shared by the Cabinet tab and the "Save to cabinet"
// action on every result card.

const fieldCls =
  'h-12 w-full min-w-0 rounded-xl border bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 sm:text-sm'

type Errors = Partial<Record<'name' | 'batch' | 'expiry', string>>

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function CabinetFormDialog({
  open,
  onOpenChange,
  initial,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-filled values for a new item (from a check result). */
  initial?: Partial<CabinetDraft>
  /** The item being edited; omit to add a new one. */
  editing?: CabinetItem | null
  onSaved?: (item: CabinetItem, isNew: boolean) => void
}) {
  const uid = useId()
  const items = useCabinet()
  const [draft, setDraft] = useState<CabinetDraft>({ name: '', batch: '', expiry: null, note: '' })
  const [errors, setErrors] = useState<Errors>({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setDraft(
      editing
        ? { name: editing.name, batch: editing.batch, expiry: editing.expiry, note: editing.note }
        : { name: initial?.name ?? '', batch: initial?.batch ?? '', expiry: initial?.expiry ?? null, note: initial?.note ?? '' },
    )
  }, [open, editing, initial?.name, initial?.batch, initial?.expiry, initial?.note])

  const set = (patch: Partial<CabinetDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch)) delete next[k as keyof Errors]
      return next
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    const name = draft.name.trim()
    const v = validateBatch(draft.batch)
    if (!name) next.name = 'Give it a name you will recognise, like "Crocin" or "Dad’s BP tablets".'
    if (!draft.batch.trim()) next.batch = 'Enter the batch number printed after “B.No.”.'
    else if (!v.ok) next.batch = 'Batch numbers use letters, digits and - / . ( ) only, 2 to 24 characters.'
    else {
      const dup = findByBatch(items, v.batch, editing?.id)
      if (dup) next.batch = `Batch ${dup.batch} is already in your cabinet as “${dup.name}”.`
    }
    setErrors(next)
    if (Object.keys(next).length) {
      const first = (['name', 'batch'] as const).find((k) => next[k])
      if (first) document.getElementById(`${uid}-${first}`)?.focus()
      return
    }
    const clean = { name, batch: v.batch, expiry: draft.expiry || null, note: draft.note.trim() }
    if (editing) {
      updateItem(editing.id, clean)
      toast.success('Cabinet updated')
      onSaved?.({ ...editing, ...clean }, false)
    } else {
      const item = addItem(clean)
      toast.success(`${item.name} saved to your cabinet`)
      onSaved?.(item, true)
    }
    onOpenChange(false)
  }

  const ids = { name: `${uid}-name`, batch: `${uid}-batch`, expiry: `${uid}-expiry`, note: `${uid}-note` }
  const describe = (k: keyof Errors) => (errors[k] ? `${ids[k]}-error` : undefined)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-md">
        <form onSubmit={submit} noValidate data-cabinet-form>
          <div className="px-5 pt-5 pb-1">
            <p className="text-[11px] font-bold tracking-[0.16em] text-primary uppercase">My medicine cabinet</p>
            <DialogTitle className="mt-1.5 text-xl font-semibold tracking-tight">{editing ? 'Edit medicine' : 'Add a medicine'}</DialogTitle>
            <DialogDescription className="mt-1 text-pretty">Saved only on this device. Nazar re-checks the batch each time you open your cabinet.</DialogDescription>
          </div>
          <div className="grid gap-4 px-5 py-4">
            <Field id={ids.name} label="Medicine name" error={errors.name}>
              <input
                id={ids.name}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                maxLength={NAME_MAX}
                placeholder="e.g. Crocin 650"
                autoComplete="off"
                aria-invalid={!!errors.name}
                aria-describedby={describe('name')}
                className={fieldCls}
              />
            </Field>
            <Field id={ids.batch} label="Batch number" hint="After “B.No.” on the pack" error={errors.batch}>
              <input
                id={ids.batch}
                value={draft.batch}
                onChange={(e) => set({ batch: e.target.value.toUpperCase() })}
                maxLength={24}
                placeholder="e.g. SR-13"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={!!errors.batch}
                aria-describedby={describe('batch')}
                className={cn(fieldCls, 'font-mono tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case')}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
              <Field id={ids.expiry} label="Expiry month" hint="Optional">
                <input
                  id={ids.expiry}
                  type="month"
                  value={draft.expiry ?? ''}
                  onChange={(e) => set({ expiry: e.target.value || null })}
                  className={cn(fieldCls, 'scheme-light dark:scheme-dark')}
                />
              </Field>
              <Field id={ids.note} label="Note" hint="Optional">
                <input
                  id={ids.note}
                  value={draft.note}
                  onChange={(e) => set({ note: e.target.value })}
                  maxLength={NOTE_MAX}
                  placeholder="For Dad, kids’ syrup…"
                  autoComplete="off"
                  className={fieldCls}
                />
              </Field>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-5 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="h-12 sm:h-11" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-12 font-semibold sm:h-11">
              {editing ? 'Save changes' : 'Add to cabinet'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Save to cabinet" on a result card: pre-fills the batch and product name. */
export function SaveToCabinet({ result }: { result: CheckResult }) {
  const items = useCabinet()
  const [open, setOpen] = useState(false)
  if (result.state === 'unreadable' || !validateBatch(result.batch).ok) return null
  const saved = findByBatch(items, result.batch)
  if (saved) {
    return (
      <Link href="/cabinet" className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 px-3')} aria-label={`In your cabinet as ${saved.name}. Open cabinet`}>
        <BookmarkCheck className="text-primary" /> <span className="hidden sm:inline">In cabinet</span><span className="sm:hidden">Saved</span>
      </Link>
    )
  }
  const alert = 'alert' in result ? result.alert : undefined
  return (
    <>
      <Button variant="ghost" className="h-11 px-3" onClick={() => setOpen(true)} aria-label="Save to cabinet" data-save-cabinet>
        <BookmarkPlus /> <span className="hidden sm:inline">Save to cabinet</span><span className="sm:hidden">Save</span>
      </Button>
      <CabinetFormDialog open={open} onOpenChange={setOpen} initial={{ batch: result.batch, name: alert?.brand ?? '' }} />
    </>
  )
}
