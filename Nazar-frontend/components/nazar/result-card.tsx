'use client'

import { useState } from 'react'
import { Baby, ChevronRight, CircleHelp, FileSearch, History, Search, Share2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import { CATEGORY_MEANING, type Alert, type CheckResult } from '@/lib/mock-source'
import { cn } from '@/lib/utils'

const TONE = {
  flagged: { band: 'border-flagged-border bg-flagged-soft', icon: 'bg-flagged text-white', text: 'text-flagged', Icon: TriangleAlert, label: 'Flagged' },
  retracted: { band: 'border-caution-border bg-caution-soft', icon: 'bg-caution text-white dark:text-background', text: 'text-caution', Icon: History, label: 'Retracted' },
  no_alert: { band: 'border-quiet-border bg-quiet-soft', icon: 'bg-quiet text-white dark:text-background', text: 'text-quiet', Icon: Search, label: 'No alert found' },
  unreadable: { band: 'border-caution-border bg-caution-soft', icon: 'bg-caution text-white dark:text-background', text: 'text-caution', Icon: CircleHelp, label: "Can't tell" },
} as const

const formatAsOf = (d: Date) =>
  d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function SeverityPips({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`Severity ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('h-2 w-3.5 rounded-full', i <= value ? 'bg-flagged' : 'bg-flagged/15')} />
      ))}
    </span>
  )
}

function ProofDrawer({ alert, open, onOpenChange }: { alert: Alert; open: boolean; onOpenChange: (open: boolean) => void }) {
  const rows: [string, string, boolean?][] = [
    ['Published by', alert.authority],
    ['Notice', `${alert.notice} · ${alert.noticeDate}`],
    ['Category', `${alert.category.toUpperCase()} · ${CATEGORY_MEANING[alert.category]}`],
    ['Arkiv entity', alert.entityKey, true],
    ['Creator wallet', alert.creator, true],
    ['Source SHA-256', alert.sourceSha, true],
  ]
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
        <dl className="overflow-y-auto px-5 pt-3">
          {rows.map(([k, v, mono]) => (
            <div key={k} className="flex justify-between gap-6 border-b py-3.5 text-sm last:border-0">
              <dt className="shrink-0 text-muted-foreground">{k}</dt>
              <dd className={cn('text-right font-medium', mono && 'font-mono text-xs')}>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mx-5 mt-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Demo record: key, wallet and hash are placeholders until the Arkiv pipeline is live.
        </p>
        <DrawerFooter className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <Button className="h-12" onClick={() => toast('Source documents open once the pipeline is connected.')}>
            <FileSearch /> View source notice
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export function ResultCard({ result, onCheck }: { result: CheckResult; onCheck: (batch: string) => void }) {
  const [proofOpen, setProofOpen] = useState(false)
  const tone = TONE[result.state]
  const alert = 'alert' in result ? result.alert : undefined

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
            <span className="text-muted-foreground">{alert.retraction.authority}, {alert.retraction.date}. The original alert stays on record.</span>
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

      <Separator />
      <div className="flex flex-wrap items-center gap-2 bg-card/70 px-5 py-3 sm:px-6">
        <p className="mr-auto text-xs text-muted-foreground">
          {alert ? `${alert.authority}, ${alert.noticeDate}` : 'Checked against demo alerts'}
        </p>
        <Button variant="ghost" className="h-11 px-3" onClick={share}>
          <Share2 /> Share
        </Button>
        {alert && (
          <Button variant="outline" className={cn('h-11 px-3', tone.text)} onClick={() => setProofOpen(true)}>
            How do we know? <ChevronRight data-icon="inline-end" />
          </Button>
        )}
      </div>

      {alert && <ProofDrawer alert={alert} open={proofOpen} onOpenChange={setProofOpen} />}
    </section>
  )
}
