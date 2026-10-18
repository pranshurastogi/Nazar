'use client'

import { useRef, useState } from 'react'
import { ArrowRight, FileSpreadsheet, LoaderCircle, Lock, Sparkles, Upload, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { previewLine, SWEEP_MAX, SWEEP_MAX_FILE_BYTES, type ParsedList } from '@/lib/sweep'
import { cn } from '@/lib/utils'
import { plural } from './shared'

type Props = {
  text: string
  onText: (t: string) => void
  fileName: string | null
  onFile: (name: string | null, text: string) => void
  parsed: ParsedList
  busy: boolean
  onCheck: () => void
  onSample: () => void
}

/** The list: a big paste box, a CSV/TSV upload (or drop), a sample, a live count and the check button. */
export function InputPanel({ text, onText, fileName, onFile, parsed, busy, onCheck, onSample }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [emptyHint, setEmptyHint] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const read = async (file: File | undefined) => {
    if (!file) return
    setFileError(null)
    if (file.size > SWEEP_MAX_FILE_BYTES) return setFileError(`${file.name} is larger than 2 MB. Save just the batch column, or split the sheet.`)
    if (!/\.(csv|tsv|txt)$/i.test(file.name) && !/^text\//.test(file.type)) return setFileError('Upload a .csv or .tsv file. From Excel: File › Save as › CSV.')
    // Read on the device; the file never leaves it.
    onFile(file.name, await file.text())
  }

  const count = parsed.rows.length + parsed.unreadable.length
  const submit = () => {
    if (!count) {
      setEmptyHint(true)
      taRef.current?.focus()
      return
    }
    onCheck()
  }

  return (
    <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1fr)_17.5rem]" data-sweep-screen>
      <div
        className={cn('rounded-2xl border bg-card p-4 shadow-sm transition-colors sm:p-5', drag && 'border-primary bg-primary/5')}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          setDrag(false)
          void read(e.dataTransfer.files[0])
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <label htmlFor="sweep-input" className="text-sm font-semibold">
            Batch numbers
          </label>
          <span className="text-xs text-muted-foreground">Up to {SWEEP_MAX} · from Excel, Sheets or a CSV</span>
        </div>
        <textarea
          ref={taRef}
          id="sweep-input"
          value={text}
          onChange={(e) => {
            onText(e.target.value)
            if (emptyHint) setEmptyHint(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
          placeholder={'Paste batch numbers, one per line or separated by commas\n\nSR-13\nTG25-2281A, AB1234'}
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
          aria-describedby="sweep-preview sweep-empty"
          aria-invalid={emptyHint || undefined}
          className="mt-3 block h-52 w-full resize-y rounded-xl border bg-background px-4 py-3 font-mono text-[15px] leading-6 tracking-wide outline-none placeholder:font-sans placeholder:text-[15px] placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 sm:h-60"
          data-sweep-input
        />

        <div className="mt-3 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          <p id="sweep-preview" className={cn('font-medium tabular-nums', count ? 'text-foreground' : 'text-muted-foreground')} aria-live="polite" data-sweep-preview>
            {count ? previewLine(parsed) : 'Nothing to check yet'}
          </p>
          {parsed.overLimit > 0 && (
            <p className="text-sm font-medium text-caution" data-sweep-over>
              Only the first {SWEEP_MAX} are checked; {plural(parsed.overLimit, 'more batch', 'more batches')} left out.
            </p>
          )}
        </div>
        {fileName && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-sweep-file-info>
            <FileSpreadsheet className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="font-medium text-foreground">{fileName}</span>
            <span aria-hidden="true">·</span>
            {parsed.columns ? (
              <span data-sweep-columns>
                Batch column: <span className="font-medium text-foreground">“{parsed.columns.batch}”</span>
                {[parsed.columns.product, parsed.columns.qty, parsed.columns.expiry].some(Boolean) && (
                  <> · also kept: {[parsed.columns.product, parsed.columns.qty, parsed.columns.expiry].filter(Boolean).join(', ')}</>
                )}
              </span>
            ) : (
              <span>No header row found; every value is read as a batch</span>
            )}
            <button
              type="button"
              onClick={() => onFile(null, '')}
              className="-my-2 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 font-medium text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label={`Remove ${fileName}`}
            >
              <X className="size-3.5" aria-hidden="true" /> Remove
            </button>
          </div>
        )}
        <p id="sweep-empty" role="status" className={cn('text-sm font-medium text-caution', (emptyHint || fileError) && 'mt-2')} data-sweep-hint>
          {fileError ?? (emptyHint ? 'Paste at least one batch number, or upload a CSV.' : '')}
        </p>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                void read(e.target.files?.[0])
                e.target.value = ''
              }}
              data-sweep-file
            />
            <Button variant="outline" className="h-12 rounded-xl px-4 text-sm font-semibold" onClick={() => fileRef.current?.click()}>
              <Upload /> Upload CSV
            </Button>
            <Button variant="outline" className="h-12 rounded-xl px-4 text-sm font-semibold" onClick={onSample} data-sweep-sample>
              <Sparkles /> Try a sample
            </Button>
          </div>
          <Button className="h-12 rounded-xl px-5 text-base font-semibold sm:ml-auto sm:min-w-52" onClick={submit} aria-busy={busy} data-sweep-check>
            {busy ? (
              <>
                Checking <LoaderCircle data-icon="inline-end" className="animate-spin motion-reduce:animate-none" />
              </>
            ) : (
              <>
                {parsed.rows.length ? `Check ${plural(parsed.rows.length, 'batch', 'batches')}` : 'Check batches'} <ArrowRight data-icon="inline-end" />
              </>
            )}
          </Button>
        </div>
      </div>

      <aside className="rounded-2xl border bg-card/60 p-4 sm:p-5" aria-labelledby="sweep-privacy-title" data-sweep-privacy>
        <p id="sweep-privacy-title" className="flex items-center gap-2.5 text-sm font-semibold">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Lock className="size-4" aria-hidden="true" />
          </span>
          Processed on this device
        </p>
        <ul className="mt-3 grid gap-2.5 text-[13px] leading-5 text-muted-foreground">
          <li>Your list, file, product names and quantities never leave this browser.</li>
          <li>Batches are matched against Nazar&rsquo;s copy of every published alert, saved on the device.</li>
          <li>Only the flagged and look-alike batch numbers go to Nazar&rsquo;s API, one at a time, the same as a normal check.</li>
          <li>Downloads are made in your browser. Nothing is uploaded.</li>
        </ul>
      </aside>
    </div>
  )
}
