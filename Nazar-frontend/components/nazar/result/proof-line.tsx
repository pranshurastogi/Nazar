'use client'

import { useSyncExternalStore } from 'react'
import { ChevronRight, LoaderCircle, Unlink } from 'lucide-react'

import type { Alert } from '@/lib/source'
import { useT, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Below md the result card shows the on-chain proof as one line that opens the "How do we know?"
// sheet, which already carries every hash, the signer and the lifetime. From md up the card keeps
// the fuller chain-of-custody block.

const WIDE = '(min-width: 48rem)'

const subscribe = (cb: () => void) => {
  const m = window.matchMedia(WIDE)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

/** True from Tailwind's md breakpoint up. The server render (no window) gets the compact line. */
export function useWide() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => false)
}

type Status = 'published' | 'saved' | 'pending' | 'unpublished'

const statusOf = (a: Alert): Status =>
  a.entityKey ? 'published' : a.fromSnapshot && a.savedCopyFinal ? 'saved' : a.fromSnapshot ? 'pending' : 'unpublished'

const LABEL: Record<Status, MessageKey> = {
  published: 'proof.live',
  saved: 'proof.saved',
  pending: 'proof.pending',
  unpublished: 'proof.unpublished',
}

/** "Live on Arkiv · View proof": one tap target that opens the proof sheet. */
export function ProofLine({ alert, onOpen }: { alert: Alert; onOpen: () => void }) {
  const { t } = useT()
  const status = statusOf(alert)
  const live = status === 'published' || status === 'pending'
  return (
    <div className="border-t bg-card/70 px-5 sm:px-6" data-proof-line={status}>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className="-mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 text-left text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="sr-only">{t('proof.lineSr')}</span>
        <span
          className={cn(
            'inline-flex min-w-0 items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-bold',
            live ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {status === 'published' && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
          {status === 'pending' && <LoaderCircle className="size-3 shrink-0 motion-safe:animate-spin" aria-hidden="true" />}
          {(status === 'saved' || status === 'unpublished') && <Unlink className="size-3 shrink-0" aria-hidden="true" />}
          <span className="truncate">{t(LABEL[status])}</span>
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 font-semibold text-primary">
          {t('proof.view')} <ChevronRight className="size-4" aria-hidden="true" />
        </span>
      </button>
    </div>
  )
}
