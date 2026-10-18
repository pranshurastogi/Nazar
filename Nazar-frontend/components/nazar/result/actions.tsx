'use client'

import { ChevronRight, Share2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { SaveToCabinet } from '@/components/nazar/cabinet-form'
import type { Alert, CheckResult } from '@/lib/source'
import { cn } from '@/lib/utils'
import { formatAsOf, SourceTag, TONE } from './shared'

/** Footer of a result card: who answered, save, share and the proof sheet. */
export function ResultActions({
  result,
  alert,
  saveable,
  onProof,
}: {
  result: CheckResult
  alert?: Alert
  saveable: boolean
  onProof: (a: Alert) => void
}) {
  const tone = TONE[result.state]

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
    <div className="flex flex-wrap items-center gap-2 bg-card/70 px-5 py-3 sm:px-6">
      <div className="mr-auto min-w-0">
        {alert && <p className="text-xs text-muted-foreground">{alert.authority}, {alert.noticeDate}</p>}
        <SourceTag source={result.source} />
      </div>
      {saveable && <SaveToCabinet result={result} />}
      <Button variant="ghost" className="h-11 px-3" onClick={share}>
        <Share2 /> Share
      </Button>
      {alert && (
        <Button variant="outline" className={cn('h-11 px-3', tone.text)} onClick={() => onProof(alert)}>
          How do we know? <ChevronRight data-icon="inline-end" />
        </Button>
      )}
    </div>
  )
}
