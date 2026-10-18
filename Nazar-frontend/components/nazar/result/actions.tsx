'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, Link2, MessageCircle, Share2 } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { SaveToCabinet } from '@/components/nazar/cabinet-form'
import type { Alert, CheckResult } from '@/lib/source'
import { shareMessage, shareSummary, shareUrl, whatsappHref } from '@/lib/share'
import { cn } from '@/lib/utils'
import { copy, SourceTag, TONE } from './shared'

/**
 * Save and share, placed right after "What to do" so they are not buried under the proof.
 * A share carries the public /b/BATCH link: only the batch and regulator data, never the cabinet or history.
 */
export function ShareSave({ result, saveable }: { result: CheckResult; saveable: boolean }) {
  const [canShare, setCanShare] = useState(false)
  useEffect(() => setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function'), [])
  // A can't-tell answer is not worth forwarding, and cannot be saved either.
  if (result.state === 'unreadable') return null

  const url = shareUrl(result.batch)
  const copyLink = () => copy(url, 'Link')
  const share = async () => {
    try {
      // The link goes in `url`, not in the text, so share targets do not show it twice.
      await navigator.share({ title: `Batch ${result.batch} · ${TONE[result.state].label} · Nazar`, text: shareSummary(result), url })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      await copyLink()
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 bg-card/70 px-5 pb-4 sm:px-6" data-share-actions>
      {saveable && <SaveToCabinet result={result} />}
      {canShare ? (
        <Button variant="ghost" className="h-11 px-3" onClick={share} data-share>
          <Share2 /> Share
        </Button>
      ) : (
        <Button variant="ghost" className="h-11 px-3" onClick={copyLink} data-copy-link>
          <Link2 /> Copy link
        </Button>
      )}
      <a
        href={whatsappHref(shareMessage(result, url))}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 px-3')}
        aria-label="Share on WhatsApp"
        data-whatsapp
      >
        <MessageCircle /> WhatsApp
      </a>
    </div>
  )
}

/** Footer of a result card: who answered, and the proof sheet. */
export function ResultActions({
  result,
  alert,
  onProof,
}: {
  result: CheckResult
  alert?: Alert
  onProof: (a: Alert) => void
}) {
  const tone = TONE[result.state]

  return (
    <div className="flex flex-wrap items-center gap-2 bg-card/70 px-5 py-3 sm:px-6">
      <div className="mr-auto min-w-0">
        {alert && <p className="text-xs text-muted-foreground">{alert.authority}, {alert.noticeDate}</p>}
        <SourceTag source={result.source} />
      </div>
      {alert && (
        <Button variant="outline" className={cn('h-11 px-3', tone.text)} onClick={() => onProof(alert)}>
          How do we know? <ChevronRight data-icon="inline-end" />
        </Button>
      )}
    </div>
  )
}
