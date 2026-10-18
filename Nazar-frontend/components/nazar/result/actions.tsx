'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BookmarkCheck, BookmarkPlus, ChevronRight, Link2, MessageCircle, Share2 } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { CabinetFormDialog } from '@/components/nazar/cabinet-form'
import { findByBatch, useCabinet } from '@/lib/cabinet'
import { validateBatch, type Alert, type CheckResult } from '@/lib/source'
import { shareMessage, shareSummary, shareUrl, whatsappHref } from '@/lib/share'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { copy, SourceTag, TONE } from './shared'

/** One segment of the action bar: a 44px ghost button that shares the bar's border and rounding. */
const SEGMENT = 'h-11 rounded-none px-3.5 first:rounded-l-[11px] last:rounded-r-[11px] hover:bg-muted/70 focus-visible:z-10'
/** A segment with its label from sm up; below sm only the icon shows and the aria-label names it. */
const ICON_ACTION = cn(SEGMENT, 'w-11 px-0 sm:w-auto sm:px-3.5')

/**
 * "Save to cabinet" / "In cabinet". One label at every width, so the same state never reads
 * "In cabinet" on a laptop and "Saved" on a phone.
 */
function SaveAction({ result }: { result: CheckResult }) {
  const { t } = useT()
  const items = useCabinet()
  const [open, setOpen] = useState(false)
  if (result.state === 'unreadable' || !validateBatch(result.batch).ok) return null
  const saved = findByBatch(items, result.batch)
  if (saved) {
    return (
      <Link href="/cabinet" className={cn(buttonVariants({ variant: 'ghost' }), SEGMENT)} aria-label={t('result.inCabinetAria', { name: saved.name })} data-in-cabinet>
        <BookmarkCheck className="text-primary" /> {t('result.inCabinet')}
      </Link>
    )
  }
  const alert = 'alert' in result ? result.alert : undefined
  return (
    <>
      <Button variant="ghost" className={SEGMENT} onClick={() => setOpen(true)} data-save-cabinet>
        <BookmarkPlus /> {t('result.save')}
      </Button>
      <CabinetFormDialog open={open} onOpenChange={setOpen} initial={{ batch: result.batch, name: alert?.brand ?? '' }} />
    </>
  )
}

/**
 * Save and share, placed right after "What to do" so they are not buried under the proof.
 * A share carries the public /b/BATCH link: only the batch and regulator data, never the cabinet or history.
 * One segmented bar, so the three read as a single toolbar; below sm, Share and WhatsApp are icon
 * buttons so the bar stays on one line at 360 px.
 */
export function ShareSave({ result, saveable }: { result: CheckResult; saveable: boolean }) {
  const { t } = useT()
  const [canShare, setCanShare] = useState(false)
  useEffect(() => setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function'), [])
  // A can't-tell answer is not worth forwarding, and cannot be saved either.
  if (result.state === 'unreadable') return null

  const url = shareUrl(result.batch)
  const copyLink = () => copy(url, t('copy.link'))
  const share = async () => {
    try {
      // The link goes in `url`, not in the text, so share targets do not show it twice.
      await navigator.share({ title: `${t('result.batch')} ${result.batch} · ${t(`state.${result.state}`)} · Nazar`, text: shareSummary(result), url })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      await copyLink()
    }
  }

  return (
    <div
      role="group"
      aria-label={t('result.saveAndShare')}
      className="mx-5 mb-5 flex w-fit max-w-[calc(100%-2.5rem)] items-stretch divide-x rounded-xl border bg-card shadow-xs sm:mx-6 sm:max-w-[calc(100%-3rem)]"
      data-share-actions
    >
      {saveable && <SaveAction result={result} />}
      {canShare ? (
        <Button variant="ghost" className={ICON_ACTION} onClick={share} aria-label={t('result.share')} title={t('result.share')} data-share>
          <Share2 /> <span className="hidden sm:inline">{t('result.share')}</span>
        </Button>
      ) : (
        <Button variant="ghost" className={ICON_ACTION} onClick={copyLink} aria-label={t('result.copyLink')} title={t('result.copyLink')} data-copy-link>
          <Link2 /> <span className="hidden sm:inline">{t('result.copyLink')}</span>
        </Button>
      )}
      <a
        href={whatsappHref(shareMessage(result, url))}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(buttonVariants({ variant: 'ghost' }), ICON_ACTION)}
        aria-label={t('result.whatsappAria')}
        title={t('result.whatsappAria')}
        data-whatsapp
      >
        <MessageCircle /> <span className="hidden sm:inline">{t('result.whatsapp')}</span>
      </a>
    </div>
  )
}

/** Footer of a result card, kept quiet: who answered (and the notice it rests on), and the proof sheet. */
export function ResultActions({
  result,
  alert,
  onProof,
}: {
  result: CheckResult
  alert?: Alert
  onProof: (a: Alert) => void
}) {
  const { t, locale } = useT()
  const tone = TONE[result.state]

  return (
    // Phones: source and "How do we know?" share the first line, the notice sits under them.
    // From sm: source over notice on the left, the button centred on the right.
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t bg-muted/35 px-5 py-1.5 sm:px-6" data-result-footer>
      <SourceTag source={result.source} className="items-start py-1 leading-4 [&>span:first-child]:mt-[5px]" />
      {alert ? (
        <Button variant="ghost" className={cn('-mr-2.5 h-11 px-2.5 font-semibold sm:row-span-2', tone.text)} onClick={() => onProof(alert)}>
          {t('result.howDoWeKnow')} <ChevronRight data-icon="inline-end" />
        </Button>
      ) : (
        <span className="h-11" aria-hidden="true" />
      )}
      {alert && (
        <p className="col-span-2 -mt-1.5 pb-1.5 text-xs text-muted-foreground sm:col-span-1 sm:row-start-2 sm:mt-0 sm:pb-1">
          {alert.authority}, {alert.noticeDate}
        </p>
      )}
      {/* Hindi mode: the notice's own words (product, reason, title) are the regulator's, kept in English. */}
      {alert && locale !== 'en' && (
        <p className="col-span-2 -mt-1 pb-2 text-xs leading-5 text-muted-foreground" data-published-as-is>
          {t('note.publishedAsIs')}
        </p>
      )}
    </div>
  )
}
