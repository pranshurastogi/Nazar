'use client'

import { Clock, Landmark, ScanText } from 'lucide-react'

import { type Alert, type CheckResult } from '@/lib/source'
import { formatAsOfIn, useT, type Locale } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ChildShield } from './child-shield'
import { SeverityPips, TIER_KEY, TONE } from './shared'

/** The headline. A look-alike is typed, not unreadable, so it asks instead; it is never a flag. */
function headline(result: CheckResult, t: ReturnType<typeof useT>['t'], locale: Locale) {
  if (result.state === 'unreadable' && result.suggestion) return t('headline.didYouMean', { batch: result.suggestion })
  if (result.state === 'no_alert') return t('headline.no_alert', { time: formatAsOfIn(locale, result.asOf) })
  return t(`headline.${result.state}`)
}

/**
 * The state band: icon, state chip, headline, then the product and the batch with the time it was
 * checked (IST). Colour, icon and words always agree. Child Shield sits inside the band, under the
 * product it is about.
 */
export function VerdictHeader({ result, alert, official }: { result: CheckResult; alert?: Alert; official?: boolean }) {
  const { t, locale } = useT()
  const tone = TONE[result.state]
  const tierKey = alert ? TIER_KEY[alert.tier] : undefined
  const tierNote = tierKey ? t(tierKey) : undefined
  // The no-alert headline already carries the time; a can't-tell answer is about the input, not a moment.
  const showTime = result.state === 'flagged' || result.state === 'retracted'
  return (
    <div className={cn('px-5 pt-5 pb-5 sm:px-6 sm:pt-6', tone.band)}>
      {official && (
        <p className="mb-4 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase" data-official-label>
          <Landmark className="size-3.5 shrink-0" aria-hidden="true" /> {t('result.official')}
        </p>
      )}
      <div className="flex gap-3.5 sm:gap-4">
        <div className={cn('grid size-11 shrink-0 place-items-center rounded-xl shadow-xs sm:size-12', tone.icon)} aria-hidden="true">
          <tone.Icon className="size-5 sm:size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold tracking-wider uppercase', tone.icon)} data-state-chip>
              {t(`state.${result.state}`)}
            </span>
            {alert && result.state === 'flagged' && <SeverityPips value={alert.severity} />}
          </div>
          <h3 className="mt-2 max-w-[38ch] text-xl leading-snug font-semibold tracking-tight text-balance sm:text-[1.375rem]" data-verdict-headline>
            {headline(result, t, locale)}
          </h3>
          {alert && (
            <p className="mt-1.5 text-sm leading-5">
              <span className="font-medium">{alert.brand}</span>
              <span className="text-muted-foreground"> · {alert.manufacturer}</span>
            </p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm leading-5 text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-current/10 bg-card/70 px-2 py-0.5 whitespace-nowrap" data-batch-pill>
              {t('result.batch')} <span className="font-mono font-semibold text-foreground">{result.batch || '—'}</span>
            </span>
            {showTime && (
              <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap" data-checked-at>
                <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">{t('result.checked')}</span>
                {formatAsOfIn(locale, result.asOf)}
              </span>
            )}
          </p>
          {tierNote && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-caution">
              <ScanText className="size-3.5 shrink-0" aria-hidden="true" /> {tierNote}
            </p>
          )}
        </div>
      </div>
      {alert && result.state === 'flagged' && <ChildShield alert={alert} />}
    </div>
  )
}
