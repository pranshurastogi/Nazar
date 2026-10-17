'use client'

import { useState } from 'react'
import {
  Baby,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  FileSearch,
  History,
  ScanText,
  Search,
  Share2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import { CATEGORY_MEANING, SOURCE_LABEL, TIER_NOTE, type Alert, type Answerer, type CheckResult } from '@/lib/source'
import { cn } from '@/lib/utils'

const TONE = {
  flagged: { band: 'border-flagged-border bg-flagged-soft', icon: 'bg-flagged text-white', text: 'text-flagged', Icon: TriangleAlert, label: 'Flagged' },
  retracted: { band: 'border-caution-border bg-caution-soft', icon: 'bg-caution text-white dark:text-background', text: 'text-caution', Icon: History, label: 'Retracted' },
  no_alert: { band: 'border-quiet-border bg-quiet-soft', icon: 'bg-quiet text-white dark:text-background', text: 'text-quiet', Icon: Search, label: 'No alert found' },
  unreadable: { band: 'border-caution-border bg-caution-soft', icon: 'bg-caution text-white dark:text-background', text: 'text-caution', Icon: CircleHelp, label: "Can't tell" },
} as const

const METHOD_LABEL: Record<string, string> = {
  api: 'Regulator data feed',
  text: 'PDF text layer',
  ocr: 'OCR of a scanned page',
  llm: 'AI-assisted read, checked against the source',
  html: 'Regulator web page',
  curated: 'Entered by a curator',
}

const formatAsOf = (d: Date) =>
  d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

const shorten = (v: string) => (v.length > 16 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v)

async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${what} copied`)
  } catch {
    toast(`Couldn't copy. Long-press to select it instead.`)
  }
}

function SeverityPips({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`Severity ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('h-2 w-3.5 rounded-full', i <= value ? 'bg-flagged' : 'bg-flagged/15')} />
      ))}
    </span>
  )
}

/** Subtle label naming the source that answered. Never coloured green. */
export function SourceTag({ source, className }: { source: Answerer; className?: string }) {
  const live = source === 'api' || source === 'arkiv'
  return (
    <span data-source={source} className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <span className={cn('size-1.5 rounded-full', live ? 'bg-primary' : 'bg-muted-foreground/50')} aria-hidden="true" />
      {SOURCE_LABEL[source]}
    </span>
  )
}

function IconLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" aria-label={label} title={label} className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-9 text-muted-foreground')}>
      <ExternalLink className="size-4" />
    </a>
  )
}

function HashValue({ value, what, href }: { value: string; what: string; href?: string | null }) {
  return (
    <span className="flex items-center justify-end gap-0.5">
      <span className="font-mono text-xs" title={value}>{shorten(value)}</span>
      <button onClick={() => copy(value, what)} aria-label={`Copy ${what}`} title={`Copy ${what}`} className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-9 text-muted-foreground')}>
        <Copy className="size-4" />
      </button>
      {href && <IconLink href={href} label={`Open ${what} in the Arkiv explorer`} />}
    </span>
  )
}

type Row = { label: string; value: React.ReactNode; hint?: string }

function ProofDrawer({ alert, open, onOpenChange }: { alert: Alert | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!alert) return null
  const tierNote = TIER_NOTE[alert.tier]
  const rows: Row[] = [
    { label: 'Published by', value: alert.authority },
    {
      label: 'Notice',
      value: (
        <>
          <span className="block">{alert.notice}</span>
          <span className="block text-xs font-normal text-muted-foreground">{alert.noticeDate}</span>
        </>
      ),
    },
    { label: 'Category', value: `${alert.category.toUpperCase()} · ${CATEGORY_MEANING[alert.category]}` },
  ]
  if (alert.mfg || alert.expiry) rows.push({ label: 'Batch dates', value: [alert.mfg && `Mfg ${alert.mfg}`, `Exp ${alert.expiry}`].filter(Boolean).join(' · ') })
  if (alert.method) {
    const conf = alert.confidence !== null ? ` · ${Math.round(alert.confidence * 100)}% confidence` : ''
    rows.push({ label: 'How it was read', value: `${METHOD_LABEL[alert.method] ?? alert.method}${conf}` })
  }
  rows.push({
    label: 'Arkiv entity',
    value: alert.entityKey ? (
      <HashValue value={alert.entityKey} what="entity key" href={alert.explorer.entity} />
    ) : (
      <span className="text-muted-foreground">{alert.demo ? 'Not published (demo record)' : 'Not yet published'}</span>
    ),
  })
  if (alert.creator) rows.push({ label: 'Creator wallet', value: <HashValue value={alert.creator} what="creator wallet" href={alert.explorer.creator} /> })
  if (alert.txHash) rows.push({ label: 'Transaction', value: <HashValue value={alert.txHash} what="transaction hash" href={alert.explorer.tx} /> })
  rows.push({
    label: 'Source SHA-256',
    value: alert.sourceSha ? <HashValue value={alert.sourceSha} what="source SHA-256" /> : <span className="text-muted-foreground">Not recorded</span>,
  })

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="mx-auto w-full sm:max-w-lg">
        <DrawerHeader className="px-5 pt-4 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Proof of record</p>
          <DrawerTitle className="text-xl font-semibold tracking-tight">How do we know?</DrawerTitle>
          <DrawerDescription className="text-left text-pretty">
            Nazar repeats what the regulator published. It does not test medicines itself.
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-5">
          {tierNote && (
            <p data-tier={alert.tier} className="mt-3 flex items-start gap-2 rounded-lg border border-caution-border bg-caution-soft px-3 py-2 text-xs font-medium text-caution">
              <ScanText className="mt-px size-4 shrink-0" /> {tierNote}
            </p>
          )}
          <dl className="pt-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b py-3 text-sm last:border-0">
                <dt className="shrink-0 text-muted-foreground">{label}</dt>
                <dd className="min-w-0 text-right font-medium text-pretty">{value}</dd>
              </div>
            ))}
          </dl>
          {alert.demo && (
            <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Demo record: shown because the Nazar API and Arkiv could not answer. It is not published on Arkiv, so there is no entity key or wallet to verify.
            </p>
          )}
        </div>
        <DrawerFooter className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {alert.noticeUrl ? (
            <a href={alert.noticeUrl} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants(), 'h-12 text-sm')}>
              <FileSearch /> View source notice
            </a>
          ) : (
            <Button className="h-12" variant="outline" onClick={() => toast('This record has no source document link.')}>
              <FileSearch /> No source document link
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

/** One batch can be named in several notices (state list, then CDSCO, then WHO). Newest first. */
function NoticeTimeline({ alerts, onOpen }: { alerts: Alert[]; onOpen: (a: Alert) => void }) {
  const ordered = [...alerts].sort((a, b) => b.noticeOrder - a.noticeOrder)
  return (
    <div className="border-t bg-card/70 px-5 py-4 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{alerts.length} notices name this batch</p>
      <ol className="mt-2" aria-label="Notice timeline">
        {ordered.map((a, i) => (
          <li key={a.id} className="relative pl-6">
            {i < ordered.length - 1 && <span className="absolute top-5 bottom-0 left-[5px] w-px bg-border" aria-hidden="true" />}
            <span
              className={cn('absolute top-[15px] left-0 size-[11px] rounded-full border-2 bg-card', a.retraction ? 'border-caution' : 'border-flagged')}
              aria-hidden="true"
            />
            <button onClick={() => onOpen(a)} className="flex min-h-12 w-full items-center gap-3 py-2 text-left">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{a.authority}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {a.noticeDate} · {a.notice}
                  {a.retraction ? ' · Withdrawn' : ''}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function ResultCard({ result, onCheck }: { result: CheckResult; onCheck: (batch: string) => void }) {
  const [proof, setProof] = useState<Alert | null>(null)
  const [proofOpen, setProofOpen] = useState(false)
  const tone = TONE[result.state]
  const alert = 'alert' in result ? result.alert : undefined
  const alerts = 'alerts' in result ? result.alerts : []
  const tierNote = alert ? TIER_NOTE[alert.tier] : undefined

  const openProof = (a: Alert) => {
    setProof(a)
    setProofOpen(true)
  }

  const share = async () => {
    const text = alert
      ? `${alert.brand} batch ${alert.batch}: ${tone.label} by ${alert.authority} (${alert.noticeDate}). Checked on Nazar.`
      : `Batch ${result.batch}: ${tone.label} on Nazar as of ${formatAsOf(result.asOf)}.`
    try {
      if (navigator.share) await navigator.share({ title: 'Nazar check', text })
      else {
        await navigator.clipboard.writeText(text)
        toast.success('Copied to clipboard')
      }
    } catch {}
  }

  return (
    <section
      aria-live="polite"
      data-state={result.state}
      className={cn('animate-in fade-in-0 slide-in-from-bottom-2 overflow-hidden rounded-2xl border duration-300', tone.band)}
    >
      <div className="flex gap-4 p-5 sm:p-6">
        <div className={cn('grid size-12 shrink-0 place-items-center rounded-xl', tone.icon)}>
          <tone.Icon className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn('h-6 px-2.5 text-[11px] font-bold uppercase tracking-wider', tone.icon)}>{tone.label}</Badge>
            {alert && result.state === 'flagged' && <SeverityPips value={alert.severity} />}
          </div>
          <h3 className="mt-2.5 text-xl font-semibold leading-snug tracking-tight text-balance">
            {result.state === 'flagged' && 'This batch failed a government quality test'}
            {result.state === 'retracted' && 'An alert on this batch was withdrawn'}
            {result.state === 'no_alert' && `No official alert for this batch as of ${formatAsOf(result.asOf)}`}
            {result.state === 'unreadable' && "We couldn't read the batch number clearly"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {alert ? `${alert.brand} · ${alert.manufacturer} · ` : ''}Batch <span className="font-mono font-semibold text-foreground">{result.batch || '—'}</span>
          </p>
          {tierNote && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-caution">
              <ScanText className="size-3.5" /> {tierNote}
            </p>
          )}
        </div>
      </div>

      {alert?.peds && result.state === 'flagged' && (
        <div className="mx-5 mb-4 flex items-start gap-3 rounded-xl border border-flagged-border bg-card p-3.5 sm:mx-6">
          <Baby className="mt-0.5 size-5 shrink-0 text-flagged" />
          <p className="text-sm">
            <span className="font-semibold">Child Shield.</span> This is a children&apos;s formulation. If a child has taken it, contact a doctor now.
          </p>
        </div>
      )}

      <div className="bg-card/70 px-5 py-4 sm:px-6">
        {result.state === 'flagged' && alert && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What to do</p>
              <ol className="mt-2 grid gap-1.5 text-sm">
                {['Stop using it.', 'Keep the pack.', 'Return it to your chemist.', 'If already taken, talk to a doctor.'].map((s, i) => (
                  <li key={s} className="flex gap-2"><span className="font-mono text-xs leading-5 text-muted-foreground">{i + 1}</span>{s}</li>
                ))}
              </ol>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Why severity {alert.severity}</p>
              <p className="mt-2 text-sm font-medium">{alert.failure}</p>
              <ul className="mt-1.5 grid gap-1 text-xs text-muted-foreground">
                {alert.severityRules.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
          </div>
        )}
        {result.state === 'retracted' && alert?.retraction && (
          <p className="text-sm">
            <span className="font-semibold">{alert.retraction.reason}.</span>{' '}
            <span className="text-muted-foreground">
              {alert.retraction.authority}
              {alert.retraction.date ? `, ${alert.retraction.date}` : ''}. The original alert stays on record.
            </span>
          </p>
        )}
        {result.state === 'no_alert' && (
          <p className="text-sm">
            <span className="font-semibold">This is not a safety certificate.</span>{' '}
            <span className="text-muted-foreground">It only means no regulator has published an alert for this batch yet.</span>
          </p>
        )}
        {result.state === 'unreadable' && (
          <div className="text-sm">
            {result.suggestion ? (
              <p>
                Did you mean{' '}
                <button className="font-mono font-semibold text-primary underline underline-offset-2" onClick={() => onCheck(result.suggestion!)}>
                  {result.suggestion}
                </button>
                ? Check the manufacturer on the pack before trusting a look-alike.
              </p>
            ) : (
              <p className="text-muted-foreground">Batch numbers use letters, digits and - / . only. Re-read the line after “B.No.” or ask your chemist.</p>
            )}
          </div>
        )}
      </div>

      {alerts.length > 1 && <NoticeTimeline alerts={alerts} onOpen={openProof} />}

      <Separator />
      <div className="flex flex-wrap items-center gap-2 bg-card/70 px-5 py-3 sm:px-6">
        <div className="mr-auto min-w-0">
          {alert && <p className="text-xs text-muted-foreground">{alert.authority}, {alert.noticeDate}</p>}
          <SourceTag source={result.source} />
        </div>
        <Button variant="ghost" className="h-11 px-3" onClick={share}>
          <Share2 /> Share
        </Button>
        {alert && (
          <Button variant="outline" className={cn('h-11 px-3', tone.text)} onClick={() => openProof(alert)}>
            How do we know? <ChevronRight data-icon="inline-end" />
          </Button>
        )}
      </div>

      <ProofDrawer alert={proof} open={proofOpen} onOpenChange={setProofOpen} />
    </section>
  )
}
