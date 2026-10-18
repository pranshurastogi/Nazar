'use client'

import { Baby } from 'lucide-react'

import { isMedicine } from '@/lib/source/map'
import type { Alert } from '@/lib/source/types'
import { useT } from '@/lib/i18n'

/** Shown on flagged children's medicines. A kids' shampoo or hand rub is not "taken", so it gets no banner. */
export function ChildShield({ alert }: { alert: Alert }) {
  const { t } = useT()
  if (!alert.peds || !isMedicine(alert)) return null
  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-flagged-border bg-card p-3.5 shadow-xs" data-child-shield>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-flagged-soft text-flagged" aria-hidden="true">
        <Baby className="size-4.5" />
      </span>
      <p className="self-center text-sm leading-5">
        <span className="font-semibold">{t('result.childShieldLead')}</span> {t('result.childShieldBody')}
      </p>
    </div>
  )
}
