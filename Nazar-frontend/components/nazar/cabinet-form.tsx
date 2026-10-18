'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ImagePlus, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { AddChooser } from '@/components/nazar/cabinet/add-chooser'
import { AiDetails, AiGuessPanel, readAutoFill, writeAutoFill, type AiState } from '@/components/nazar/cabinet/ai-guess'
import { FieldSource, SuggestionRow } from '@/components/nazar/cabinet/field-source'
import { PhotoReading } from '@/components/nazar/cabinet/photo-reading'
import {
  aiGeneric,
  applyGuess,
  DETAIL_FIELDS,
  fromPhoto,
  wantsDetails,
  type FieldKey,
  type PhotoPrefill,
  type Sources,
  type Suggestion,
  type Values,
} from '@/components/nazar/cabinet/prefill'
import {
  addItem,
  cleanComposition,
  findByBatch,
  formatExpiry,
  MAKER_MAX,
  NAME_MAX,
  NOTE_MAX,
  updateItem,
  useCabinet,
  type CabinetDraft,
  type CabinetItem,
} from '@/lib/cabinet'
import { readPackPhoto, type PhotoStage } from '@/lib/scan/photo'
import { validateBatch } from '@/lib/source'
import { apiIdentifyMedicine } from '@/lib/source/api'
import { API_URL } from '@/lib/source/config'
import { tNow, useT, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Add / edit form for the cabinet, shared by the Cabinet tab and the "Save to cabinet" action on
// every result card. A new medicine from the Cabinet starts with three ways in (photo, upload,
// type); a photo is read on the device and pre-fills the form, and nothing is saved until the
// person confirms. Edits and saves from a result card open the form directly.

const fieldCls =
  'h-12 w-full min-w-0 rounded-xl border bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 sm:text-sm'

type Errors = Partial<Record<'name' | 'batch' | 'expiry', string>>
type Step = 'choose' | 'reading' | 'form'
type Draft = { name: string; batch: string; expiry: string | null; note: string; composition: string; maker: string }

const EMPTY: Draft = { name: '', batch: '', expiry: null, note: '', composition: '', maker: '' }
const LABEL: Record<FieldKey, MessageKey> = { name: 'cabinet.form.name', batch: 'cabinet.form.batch', expiry: 'cabinet.form.expiry', composition: 'cabinet.composition', maker: 'cabinet.madeBy' }

/** Once the server says AI guessing is off, stay quiet about it for the rest of the visit (a key, shown in the page's language). */
let aiOff: MessageKey | null = API_URL ? null : 'cabinet.form.aiOffVersion'

function Field({ id, label, hint, error, below, children }: { id: string; label: string; hint?: string; error?: string; below?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5" data-field={id.split('-').pop()}>
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
      {below}
    </div>
  )
}

const toDraft = (v: Partial<Values>): Draft => ({ ...EMPTY, name: v.name ?? '', batch: v.batch ?? '', expiry: v.expiry || null, composition: v.composition ?? '', maker: v.maker ?? '' })
const toValues = (d: Draft): Values => ({ name: d.name, batch: d.batch, expiry: d.expiry ?? '', composition: d.composition, maker: d.maker })
const normName = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const idleAi = (): AiState => (aiOff ? { kind: 'disabled', message: tNow(aiOff) } : { kind: 'idle' })

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
  const { t, tr, locale } = useT()
  const uid = useId()
  const items = useCabinet()
  const [step, setStep] = useState<Step>('form')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [extra, setExtra] = useState(false)
  // Photo flow
  const [stage, setStage] = useState<PhotoStage>('opening')
  const [thumb, setThumb] = useState<string | null>(null)
  const [photo, setPhoto] = useState<PhotoPrefill | null>(null)
  const [photoFailed, setPhotoFailed] = useState(false)
  const [sources, setSources] = useState<Sources>({})
  const [edited, setEdited] = useState<ReadonlySet<FieldKey>>(() => new Set())
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [ai, setAi] = useState<AiState>({ kind: 'idle' })
  /** "Get salts and details": a name was read but no ingredients. */
  const [details, setDetails] = useState<AiState>({ kind: 'idle' })
  /** The generic line under the brand ("Paracetamol Tablets IP 650 mg"), from the label or the AI. */
  const [generic, setGeneric] = useState<string | null>(null)
  const [autoFill, setAutoFill] = useState(false)
  const gen = useRef(0)
  /** The latest form state, so an AI answer that lands after the person typed merges into what they typed. */
  const latest = useRef<{ draft: Draft; sources: Sources; edited: ReadonlySet<FieldKey>; generic: string | null }>({ draft: EMPTY, sources: {}, edited: new Set(), generic: null })
  latest.current = { draft, sources, edited, generic }
  const headingRef = useRef<HTMLHeadingElement>(null)
  const thumbRef = useRef<string | null>(null)

  const setThumbUrl = (url: string | null) => {
    if (thumbRef.current) URL.revokeObjectURL(thumbRef.current)
    thumbRef.current = url
    setThumb(url)
  }

  const resetPhoto = () => {
    gen.current++
    setPhoto(null)
    setPhotoFailed(false)
    setSources({})
    setEdited(new Set())
    setSuggestions([])
    setAi(idleAi())
    setDetails(idleAi())
    setGeneric(null)
    setThumbUrl(null)
  }

  useEffect(() => {
    if (!open) {
      gen.current++
      return
    }
    setErrors({})
    resetPhoto()
    setAutoFill(readAutoFill())
    if (editing) {
      setDraft({ name: editing.name, batch: editing.batch, expiry: editing.expiry, note: editing.note, composition: (editing.composition ?? []).join(', '), maker: editing.maker ?? '' })
      setExtra(!!(editing.composition?.length || editing.maker))
      setStep('form')
    } else if (initial) {
      setDraft({ ...EMPTY, name: initial.name ?? '', batch: initial.batch ?? '', expiry: initial.expiry ?? null, note: initial.note ?? '' })
      setExtra(false)
      setStep('form')
    } else {
      setDraft(EMPTY)
      setExtra(false)
      setStep('choose')
    }
    // Reset only when the dialog opens or its target changes (resetPhoto is stable in effect).
  }, [open, editing, initial?.name, initial?.batch, initial?.expiry, initial?.note, !!initial])

  useEffect(() => () => setThumbUrl(null), [])

  // A rate limit lifts by itself: re-enable the button when the wait is over.
  useEffect(() => {
    if (ai.kind !== 'limited' || !ai.minutes) return
    const t = setTimeout(() => setAi((a) => (a.kind === 'limited' ? { kind: 'idle' } : a)), ai.minutes * 60_000)
    return () => clearTimeout(t)
  }, [ai])

  /** Moves focus to the step's heading, so a screen reader hears where it is and the keyboard starts there. */
  const focusHeading = () => requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: false }))

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch)) delete next[k as keyof Errors]
      return next
    })
    const keys = Object.keys(patch).filter((k): k is FieldKey => k in LABEL)
    if (keys.length) {
      // A value the person typed is theirs: it no longer shows where a read came from.
      setSources((s) => {
        const next = { ...s }
        for (const k of keys) delete next[k]
        return next
      })
      setEdited((e) => new Set([...e, ...keys]))
      setSuggestions((s) => s.filter((x) => !keys.includes(x.field)))
    }
  }

  const onPhoto = async (file: File) => {
    resetPhoto()
    const mine = gen.current
    setThumbUrl(URL.createObjectURL(file))
    setStage('opening')
    setStep('reading')
    focusHeading()
    try {
      const read = await readPackPhoto(file, (s) => mine === gen.current && setStage(s))
      if (mine !== gen.current) return
      const pre = fromPhoto(read)
      const next = { ...toDraft(pre.values), note: latest.current.draft.note }
      setPhoto(pre)
      setSources(pre.sources)
      setDraft(next)
      setGeneric(pre.generic ?? null)
      setExtra(!!(pre.values.composition || pre.values.maker))
      latest.current = { draft: next, sources: pre.sources, edited: new Set(), generic: pre.generic ?? null }
      // Opt-in: with the switch on, a weak read asks the AI by itself. Only the label text is sent.
      if (readAutoFill() && pre.weak && !pre.empty && !aiOff && pre.text.trim().length >= 3) void runAi('guess', pre, true)
    } catch {
      if (mine !== gen.current) return
      setPhotoFailed(true)
    }
    setErrors({})
    setStep('form')
    focusHeading()
  }

  const cancelReading = () => {
    resetPhoto()
    setStep('choose')
    focusHeading()
  }

  /**
   * Asks the AI about the label text (never the photo). 'guess' fills any missing field; 'details' ("Get salts
   * and details") fills only the empty composition and maker, using the name already known as the hint.
   */
  const runAi = async (mode: 'guess' | 'details', pre: PhotoPrefill, auto = false) => {
    const mine = gen.current
    const setState = mode === 'guess' ? setAi : setDetails
    setState({ kind: 'loading', auto })
    const name = latest.current.draft.name.trim()
    const hints = mode === 'details' && name ? { ...pre.hints, product: [name, latest.current.generic].filter(Boolean).join(' ') } : pre.hints
    const r = await apiIdentifyMedicine(pre.text, hints)
    if (mine !== gen.current) return
    if (!r.ok) {
      if (r.kind === 'disabled') {
        aiOff = 'cabinet.form.aiOffNow'
        setAi({ kind: 'disabled', message: tNow(aiOff) })
        setDetails({ kind: 'disabled', message: tNow(aiOff) })
      } else if (r.kind === 'limited') setState({ kind: 'limited', message: r.message, minutes: r.retryAfterSec ? Math.max(1, Math.ceil(r.retryAfterSec / 60)) : null })
      else setState({ kind: 'error', message: r.message })
      return
    }
    const now = latest.current
    const merged = applyGuess(toValues(now.draft), now.sources, now.edited, r.data, mode === 'details' ? DETAIL_FIELDS : undefined)
    setDraft((d) => ({ ...d, name: merged.values.name, batch: merged.values.batch.toUpperCase(), expiry: merged.values.expiry || null, composition: merged.values.composition, maker: merged.values.maker }))
    setSources(merged.sources)
    setSuggestions((list) => (mode === 'details' ? [...list.filter((x) => !DETAIL_FIELDS.includes(x.field)), ...merged.suggestions] : merged.suggestions))
    // The AI's generic line goes under the name when the name is its brand and the label gave none.
    const g = aiGeneric(r.data)
    if (!now.generic && g && normName(merged.values.name) === normName(r.data.guess.brand)) setGeneric(g)
    if (merged.filled.some((k) => k === 'composition' || k === 'maker') || merged.suggestions.some((s) => s.field === 'composition' || s.field === 'maker')) setExtra(true)
    setState({ kind: 'done', filled: merged.filled.length, suggested: merged.suggestions.length, confidence: r.data.confidence, model: r.data.model })
  }

  const guess = () => photo && runAi('guess', photo)
  const getDetails = () => photo && runAi('details', photo)
  const onAutoFill = (on: boolean) => {
    writeAutoFill(on)
    setAutoFill(on)
  }

  const useSuggestion = (s: Suggestion) => {
    setDraft((d) => ({ ...d, [s.field]: s.field === 'expiry' ? s.value || null : s.field === 'batch' ? s.value.toUpperCase() : s.value }))
    setSources((src) => ({ ...src, [s.field]: { kind: 'ai', confidence: ai.kind === 'done' ? ai.confidence : 'low', ...(s.quote ? { quote: s.quote } : {}) } }))
    setSuggestions((list) => list.filter((x) => x !== s))
  }

  const chooseBatch = (batch: string, from: 'code' | 'printed') => {
    setDraft((d) => ({ ...d, batch }))
    setErrors((e) => ({ ...e, batch: undefined }))
    const codeSource = photo?.sources.batch?.kind === 'code' ? photo.sources.batch : ({ kind: 'code', from: 'qr' } as const)
    // The printed batch disagreed with an error-corrected code, so it is shown as one to check.
    setSources((s) => ({ ...s, batch: from === 'code' ? codeSource : { kind: 'label', confidence: 0.5 } }))
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    const name = draft.name.trim()
    const v = validateBatch(draft.batch)
    if (!name) next.name = t('cabinet.form.errName')
    if (!draft.batch.trim()) next.batch = t('cabinet.form.errBatchEmpty')
    else if (!v.ok) next.batch = t('cabinet.form.errBatchInvalid')
    else {
      const dup = findByBatch(items, v.batch, editing?.id)
      if (dup) next.batch = t('cabinet.form.errDup', { batch: dup.batch, name: dup.name })
    }
    setErrors(next)
    if (Object.keys(next).length) {
      const first = (['name', 'batch'] as const).find((k) => next[k])
      if (first) document.getElementById(`${uid}-${first}`)?.focus()
      return
    }
    const clean: CabinetDraft = {
      name,
      batch: v.batch,
      expiry: draft.expiry || null,
      note: draft.note.trim(),
      composition: cleanComposition(draft.composition),
      maker: draft.maker.replace(/\s+/g, ' ').trim().slice(0, MAKER_MAX),
    }
    if (editing) {
      updateItem(editing.id, clean)
      toast.success(t('cabinet.form.updated'))
      const { composition, maker, ...rest } = clean
      onSaved?.({ ...editing, ...rest, ...(composition?.length ? { composition } : {}), ...(maker ? { maker } : {}) }, false)
    } else {
      const item = addItem(clean)
      toast.success(t('cabinet.form.saved', { name: item.name }))
      onSaved?.(item, true)
    }
    onOpenChange(false)
  }

  const ids = { name: `${uid}-name`, batch: `${uid}-batch`, expiry: `${uid}-expiry`, note: `${uid}-note`, composition: `${uid}-composition`, maker: `${uid}-maker` }
  const describe = (k: keyof Errors) => (errors[k] ? `${ids[k]}-error` : undefined)
  const fromPhotoForm = step === 'form' && (!!photo || photoFailed)

  /** The provenance chip and any AI suggestion for a field. */
  const below = (k: FieldKey) => {
    const src = sources[k]
    const sug = suggestions.find((s) => s.field === k)
    const genericLine = k === 'name' && generic && normName(generic) !== normName(draft.name) ? generic : null
    if (!src && !sug && !genericLine) return undefined
    return (
      <>
        {genericLine && (
          <p className="text-sm leading-5 text-muted-foreground" data-name-generic>
            <span className="text-xs font-semibold tracking-wide uppercase">{t('cabinet.form.generic')}</span> <span className="text-foreground">{genericLine}</span>
          </p>
        )}
        {src && (
          <div className="flex flex-wrap gap-1.5">
            <FieldSource source={src} field={t(LABEL[k])} />
          </div>
        )}
        {sug && (
          <SuggestionRow
            s={sug}
            display={k === 'expiry' ? (formatExpiry(sug.value, locale) ?? sug.value) : sug.value}
            onUse={() => useSuggestion(sug)}
            onDismiss={() => setSuggestions((list) => list.filter((x) => x !== sug))}
          />
        )}
      </>
    )
  }

  const weakReason =
    !photo?.values.name && !photo?.values.batch
      ? t('cabinet.form.weakBoth')
      : !photo?.values.name
        ? t('cabinet.form.weakName')
        : !photo?.values.batch
          ? t('cabinet.form.weakBatch')
          : t('cabinet.form.weakHard')
  const showAi = !!photo && photo.weak && !photo.empty
  // A name but no salts: offer the small "Get salts and details" (the full guess covers it on a weak read).
  const showDetails =
    !!photo && details.kind !== 'disabled' && (details.kind !== 'idle' || (!showAi && wantsDetails(toValues(draft), photo.text)))
  const head =
    step === 'choose'
      ? { eyebrow: t('cabinet.form.eyebrow'), title: t('cabinet.add'), desc: t('cabinet.form.desc') }
      : step === 'reading'
        ? { eyebrow: t('cabinet.form.readingEyebrow'), title: t('cabinet.form.readingTitle'), desc: t('cabinet.form.readingDesc') }
        : fromPhotoForm
          ? { eyebrow: t('cabinet.form.photoEyebrow'), title: t('cabinet.form.photoTitle'), desc: t('cabinet.form.photoDesc') }
          : { eyebrow: t('cabinet.form.eyebrow'), title: editing ? t('cabinet.form.editTitle') : t('cabinet.add'), desc: t('cabinet.form.desc') }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-x-hidden overflow-y-auto rounded-2xl p-0 sm:max-w-md" data-cabinet-dialog data-step={step}>
        <div className="px-5 pt-5 pb-1 pr-12">
          <p className="text-[11px] font-bold tracking-[0.16em] text-primary uppercase">{head.eyebrow}</p>
          <DialogTitle ref={headingRef} tabIndex={-1} className="mt-1.5 rounded-md text-xl font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
            {head.title}
          </DialogTitle>
          <DialogDescription className="mt-1 text-pretty">{head.desc}</DialogDescription>
        </div>

        {step === 'choose' && (
          <AddChooser
            onPhoto={onPhoto}
            onType={() => {
              setStep('form')
              requestAnimationFrame(() => document.getElementById(ids.name)?.focus())
            }}
          />
        )}

        {step === 'reading' && <PhotoReading stage={stage} thumb={thumb} onCancel={cancelReading} />}

        {step === 'form' && (
          <form onSubmit={submit} noValidate data-cabinet-form data-from-photo={fromPhotoForm ? '' : undefined}>
            <div className="grid gap-4 px-5 py-4">
              {fromPhotoForm && (
                <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-2" data-photo-strip>
                  {thumb ? (
                    // A local blob: URL, so a plain <img>: the photo is never uploaded.
                    <img src={thumb} alt={t('cabinet.form.photoAlt')} className="size-14 shrink-0 rounded-lg border object-cover" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs leading-5 text-muted-foreground">
                      {photoFailed
                        ? t('cabinet.form.photoFailed')
                        : photo?.empty
                          ? t('cabinet.form.photoEmpty')
                          : t('cabinet.form.photoLocal')}
                    </p>
                    <button
                      type="button"
                      className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                      onClick={() => (resetPhoto(), setStep('choose'), focusHeading())}
                      data-photo-retake
                    >
                      <ImagePlus className="size-4" aria-hidden="true" /> {t('cabinet.form.retake')}
                    </button>
                  </div>
                </div>
              )}
              {fromPhotoForm && (photoFailed || photo?.empty) && (
                <p className="rounded-xl border border-caution-border bg-caution-soft px-3.5 py-3 text-sm leading-6 text-caution" role="status" data-photo-unread>
                  {t('cabinet.form.unread')}
                </p>
              )}

              {photo?.mismatch && (
                <div className="rounded-xl border border-caution-border bg-caution-soft px-3.5 py-3" role="alert" data-photo-mismatch>
                  <p className="flex items-start gap-2 text-sm leading-6 font-semibold text-caution">
                    <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
                    {t('cabinet.form.mismatchTitle')}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {tr('cabinet.form.mismatchBody', {
                      code: <span className="font-mono font-semibold text-foreground">{photo.mismatch.code}</span>,
                      printed: <span className="font-mono font-semibold text-foreground">{photo.mismatch.printed}</span>,
                    })}
                  </p>
                  <div className="mt-2 grid gap-2 min-[400px]:grid-cols-2">
                    <Button type="button" variant="outline" className="h-11 rounded-lg bg-card" aria-pressed={draft.batch === photo.mismatch.code} onClick={() => chooseBatch(photo.mismatch!.code, 'code')}>
                      {tr('cabinet.form.codeBtn', { v: <span className="font-mono">{photo.mismatch.code}</span> })}
                    </Button>
                    <Button type="button" variant="outline" className="h-11 rounded-lg bg-card" aria-pressed={draft.batch === photo.mismatch.printed} onClick={() => chooseBatch(photo.mismatch!.printed, 'printed')}>
                      {tr('cabinet.form.printedBtn', { v: <span className="font-mono">{photo.mismatch.printed}</span> })}
                    </Button>
                  </div>
                </div>
              )}

              {showAi && (
                <AiGuessPanel
                  state={ai}
                  text={photo.text}
                  reason={weakReason}
                  onGuess={guess}
                  prominent={!photo.values.name}
                  autoFill={autoFill}
                  onAutoFill={onAutoFill}
                />
              )}

              <Field id={ids.name} label={t('cabinet.form.name')} error={errors.name} below={below('name')}>
                <input
                  id={ids.name}
                  value={draft.name}
                  onChange={(e) => set({ name: e.target.value })}
                  maxLength={NAME_MAX}
                  placeholder={t('cabinet.form.namePh')}
                  autoComplete="off"
                  aria-invalid={!!errors.name}
                  aria-describedby={describe('name')}
                  className={fieldCls}
                />
              </Field>
              {showDetails && <AiDetails state={details} onRun={getDetails} name={draft.name.trim()} />}
              <Field id={ids.batch} label={t('cabinet.form.batch')} hint={t('cabinet.form.batchHint')} error={errors.batch} below={below('batch')}>
                <input
                  id={ids.batch}
                  value={draft.batch}
                  onChange={(e) => set({ batch: e.target.value.toUpperCase() })}
                  maxLength={24}
                  placeholder={t('cabinet.form.batchPh')}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={!!errors.batch}
                  aria-describedby={describe('batch')}
                  className={cn(fieldCls, 'font-mono tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case')}
                />
              </Field>
              <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
                <Field id={ids.expiry} label={t('cabinet.form.expiry')} hint={t('cabinet.form.optional')} below={below('expiry')}>
                  <input
                    id={ids.expiry}
                    type="month"
                    value={draft.expiry ?? ''}
                    onChange={(e) => set({ expiry: e.target.value || null })}
                    className={cn(fieldCls, 'scheme-light dark:scheme-dark')}
                  />
                </Field>
                <Field id={ids.note} label={t('cabinet.form.note')} hint={t('cabinet.form.optional')}>
                  <input
                    id={ids.note}
                    value={draft.note}
                    onChange={(e) => set({ note: e.target.value })}
                    maxLength={NOTE_MAX}
                    placeholder={t('cabinet.form.notePh')}
                    autoComplete="off"
                    className={fieldCls}
                  />
                </Field>
              </div>

              {extra ? (
                <div className="grid gap-4" data-cabinet-extra>
                  <Field id={ids.composition} label={t('cabinet.composition')} hint={t('cabinet.form.optional')} below={below('composition')}>
                    <input
                      id={ids.composition}
                      value={draft.composition}
                      onChange={(e) => set({ composition: e.target.value })}
                      maxLength={400}
                      placeholder={t('cabinet.form.compositionPh')}
                      autoComplete="off"
                      className={fieldCls}
                    />
                  </Field>
                  <Field id={ids.maker} label={t('cabinet.madeBy')} hint={t('cabinet.form.optional')} below={below('maker')}>
                    <input
                      id={ids.maker}
                      value={draft.maker}
                      onChange={(e) => set({ maker: e.target.value })}
                      maxLength={MAKER_MAX}
                      placeholder={t('cabinet.form.makerPh')}
                      autoComplete="off"
                      className={fieldCls}
                    />
                  </Field>
                </div>
              ) : (
                <button
                  type="button"
                  className="-mt-1 inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-lg px-1 text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                  aria-expanded={false}
                  onClick={() => {
                    setExtra(true)
                    requestAnimationFrame(() => document.getElementById(ids.composition)?.focus())
                  }}
                  data-cabinet-extra-toggle
                >
                  <ChevronDown className="size-4" aria-hidden="true" /> {t('cabinet.form.addExtra')}
                </button>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-5 py-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="h-12 sm:h-11" onClick={() => onOpenChange(false)}>
                {t('cabinet.form.cancel')}
              </Button>
              <Button type="submit" className="h-12 font-semibold sm:h-11">
                {editing ? t('cabinet.form.saveChanges') : t('cabinet.form.addToCabinet')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
