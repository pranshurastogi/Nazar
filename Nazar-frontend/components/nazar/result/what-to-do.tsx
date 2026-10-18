'use client'

import { useT, type MessageKey } from '@/lib/i18n'

const STEPS: MessageKey[] = ['result.step1', 'result.step2', 'result.step3', 'result.step4']

/** The first thing a flagged answer says after the headline: four short steps, the first one strongest. */
export function WhatToDo() {
  const { t } = useT()
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hi:text-xs">{t('result.whatToDo')}</p>
      <ol className="mt-2.5 grid gap-2 text-sm leading-5">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2.5">
            <span
              className={
                i === 0
                  ? 'grid size-6 shrink-0 place-items-center rounded-full bg-flagged font-mono text-[11px] font-bold text-white dark:text-background'
                  : 'grid size-6 shrink-0 place-items-center rounded-full bg-flagged-soft font-mono text-[11px] font-semibold text-flagged'
              }
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className={i === 0 ? 'font-semibold' : undefined}>{t(s)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
