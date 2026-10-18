'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BookmarkCheck, BookmarkPlus, ChevronRight, Link2, MessageCircle, Share2 } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { CabinetFormDialog } from '@/components/nazar/cabinet-form'
import { findByBatch, useCabinet } from '@/lib/cabinet'
import { validateBatch, type Alert, type CheckResult } from '@/lib/source'
import { shareMessage, shareSummary, shareUrl, whatsappHref } from '@/lib/share'
import { cn } from '@/lib/utils'
import { copy, SourceTag, TONE } from './shared'

/** Ghost action with its label from sm up; below sm only the icon shows and the aria-label names it. */
const ICON_ACTION = 'h-11 w-11 px-0 sm:w-auto sm:px-3'

/**
 * "Save to cabinet" / "In cabinet". One label at every width, so the same state never reads
 * "In cabinet" on a laptop and "Saved" on a phone.
 */
function SaveAction({ result }: { result: CheckResult }) {
  const items = useCabinet()
  const [open, setOpen] = useState(false)
  if (result.state === 'unreadable' || !validateBatch(result.batch).ok) return null
  const saved = findByBatch(items, result.batch)
  if (saved) {
    return (
      <Link href="/cabinet" className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 px-3')} aria-label={`In your cabinet as ${saved.name}. Open cabinet`} data-in-cabinet>
        <BookmarkCheck className="text-primary" /> In cabinet
      </Link>
    )
  }
  const alert = 'alert' in result ? result.alert : undefined
  return (
    <>
      <Button variant="ghost" className="h-11 px-3" onClick={() => setOpen(true)} data-save-cabinet>
        <BookmarkPlus /> Save to cabinet
      </Button>
      <CabinetFormDialog open={open} onOpenChange={setOpen} initial={{ batch: result.batch, name: alert?.brand ?? '' }} />
    </>
  )
}

/**
 * Save and share, placed right after "What to do" so they are not buried under the proof.
 * A share carries the public /b/BATCH link: only the batch and regulator data, never the cabinet or history.
 * Below sm, Share and WhatsApp are icon buttons so the row stays on one line at 360 px.
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
    <div className="flex flex-wrap items-center gap-1 bg-card/70 px-5 pb-4 sm:gap-2 sm:px-6" data-share-actions>
      {saveable && <SaveAction result={result} />}
      {canShare ? (
        <Button variant="ghost" className={ICON_ACTION} onClick={share} aria-label="Share" title="Share" data-share>
          <Share2 /> <span className="hidden sm:inline">Share</span>
        </Button>
      ) : (
        <Button variant="ghost" className={ICON_ACTION} onClick={copyLink} aria-label="Copy link" title="Copy link" data-copy-link>
          <Link2 /> <span className="hidden sm:inline">Copy link</span>
        </Button>
      )}
      <a
        href={whatsappHref(shareMessage(result, url))}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(buttonVariants({ variant: 'ghost' }), ICON_ACTION)}
        aria-label="Share on WhatsApp"
        title="Share on WhatsApp"
        data-whatsapp
      >
        <MessageCircle /> <span className="hidden sm:inline">WhatsApp</span>
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
