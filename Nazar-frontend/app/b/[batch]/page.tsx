import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, CircleHelp, ExternalLink, History, Landmark, Lock, Search, TriangleAlert } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Logo } from '@/components/nazar/logo'
import { ChildShield } from '@/components/nazar/result/child-shield'
import { SeverityWhy } from '@/components/nazar/result/severity-why'
import { WhatToDo } from '@/components/nazar/result/what-to-do'
import { explorerEntity } from '@/lib/source/config'
import { batchFromParam, shareCheck, type ShareCheck } from '@/lib/source/server-check'
import type { Alert, ResultState } from '@/lib/source/types'
import { checkPath, sharePath } from '@/lib/share'
import { formatAsOfIn, translate, type Locale, type MessageKey } from '@/lib/i18n/core'
import { LocaleScope } from '@/lib/i18n/provider'
import { requestLocale } from '@/lib/i18n/server'
import { cn } from '@/lib/utils'

// Public share page for one batch: the current answer from regulator data, with links to the
// notice and the Arkiv entity. It never shows anything from the sender's device. When the API
// cannot be reached it offers to check in the app instead of showing an error.

// Rendered per request so a failed API call is never cached as the page; the API answer itself is
// cached for SHARE_REVALIDATE_S (300 s) by the fetch in lib/source/server-check.ts.
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ batch: string }> }

const STATE: Record<ResultState, { label: string; Icon: typeof Search; band: string; chip: string; headline: string }> = {
  flagged: { label: 'Flagged', Icon: TriangleAlert, band: 'border-flagged-border bg-flagged-soft', chip: 'bg-flagged text-white', headline: 'This batch failed a government quality test' },
  retracted: { label: 'Retracted', Icon: History, band: 'border-caution-border bg-caution-soft', chip: 'bg-caution text-white dark:text-background', headline: 'An alert on this batch was withdrawn' },
  no_alert: { label: 'No alert found', Icon: Search, band: 'border-quiet-border bg-quiet-soft', chip: 'bg-quiet text-white dark:text-background', headline: 'No official alert for this batch' },
  unreadable: { label: "Can't tell", Icon: CircleHelp, band: 'border-caution-border bg-caution-soft', chip: 'bg-caution text-white dark:text-background', headline: "We can't tell from this batch number" },
}

// The page answers in the visitor's saved language (cookie mirrored from the app), else English.
// Social cards and metadata stay English: crawlers carry no cookie. Regulator data stays as published.
const asOfText = (d: Date, locale: Locale = 'en') => formatAsOfIn(locale, d, true)

/** The chip and headline for a state, in the page's language; the no-alert headline carries its time. */
function stateText(locale: Locale, state: ResultState, asOf: Date) {
  const t = (k: MessageKey, v?: Record<string, string>) => translate(locale, k, v)
  const headline =
    state === 'flagged' || state === 'retracted'
      ? t(`headline.${state}`)
      : state === 'no_alert'
        ? t('share.headline.no_alertAsOf', { time: asOfText(asOf, locale) })
        : t('share.headline.unreadable')
  return { label: t(`state.${state}`), headline }
}

function describe(c: ShareCheck): { title: string; description: string } {
  if (c.kind === 'unavailable') {
    return {
      title: `Batch ${c.batch} · Nazar`,
      description: `Open Nazar to check batch ${c.batch} against CDSCO, state drug regulator and WHO alerts, with proof on Arkiv.`,
    }
  }
  const r = c.result
  const label = STATE[r.state].label
  const title = `Batch ${r.batch} · ${label} · Nazar`
  if (r.state === 'flagged') {
    const a = r.alert
    return { title, description: `${a.brand} batch ${a.batch} was flagged by ${a.authority} (${a.noticeDate}): ${a.failure}. See the notice and its proof on Arkiv.` }
  }
  if (r.state === 'retracted') {
    const a = r.alert
    return { title, description: `An alert by ${a.authority} on ${a.brand} batch ${a.batch} was withdrawn. The original alert stays on record.` }
  }
  if (r.state === 'no_alert') {
    return { title, description: `No regulator alert found for batch ${r.batch} as of ${asOfText(r.asOf)}. This is not a safety certificate.` }
  }
  return { title, description: `Nazar can't tell from batch number ${r.batch}. Re-read the batch printed on the pack and check it again.` }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const batch = batchFromParam((await params).batch)
  const { title, description } = describe(await shareCheck(batch))
  const path = sharePath(batch)
  return {
    title,
    description,
    alternates: { canonical: path },
    // The image comes from ./opengraph-image.tsx; Twitter reuses it rather than the site card.
    openGraph: { type: 'website', siteName: 'Nazar', locale: 'en_IN', url: path, title, description },
    twitter: { card: 'summary_large_image', title, description, images: [`${path}/opengraph-image`] },
  }
}

function ExtLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 justify-between gap-2 px-3.5', className)}>
      {children} <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
    </a>
  )
}

function NoticeLinks({ alert, locale }: { alert: Alert; locale: Locale }) {
  const entity = alert.explorer.entity ?? (alert.entityKey ? explorerEntity(alert.entityKey) : null)
  if (!alert.noticeUrl && !entity) return null
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {alert.noticeUrl && (
        <ExtLink href={alert.noticeUrl}>
          <span className="truncate">{translate(locale, 'share.viewNotice')}</span>
        </ExtLink>
      )}
      {entity && (
        <ExtLink href={entity}>
          <span className="truncate" data-share-arkiv>{translate(locale, 'share.verify')}</span>
        </ExtLink>
      )}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  )
}

function AlertFacts({ alert, locale }: { alert: Alert; locale: Locale }) {
  const t = (k: MessageKey) => translate(locale, k)
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <Fact label={t('share.product')}>{alert.brand}</Fact>
      <Fact label={t('share.manufacturer')}>{alert.manufacturer}</Fact>
      <Fact label={t('share.authority')}>{alert.authority}</Fact>
      <Fact label={t('share.noticeDate')}>{alert.noticeDate}</Fact>
      <div className="sm:col-span-2">
        <Fact label={t('share.notice')}>{alert.notice}</Fact>
      </div>
      {alert.entityKey && (
        <div className="sm:col-span-2">
          <Fact label={t('share.entity')}>
            <span className="font-mono text-xs break-all">{alert.entityKey}</span>
          </Fact>
        </div>
      )}
    </dl>
  )
}

export default async function SharePage({ params }: Props) {
  const batch = batchFromParam((await params).batch)
  const [check, locale] = await Promise.all([shareCheck(batch), requestLocale()])
  const t = (k: MessageKey, v?: Record<string, string>) => translate(locale, k, v)
  const r = check.kind === 'result' ? check.result : null
  const style = r ? STATE[r.state] : null
  const text = r ? stateText(locale, r.state, r.asOf) : null
  const alert = r && 'alert' in r ? r.alert : undefined
  const others = r && 'alerts' in r ? r.alerts.filter((a) => a !== alert).slice(0, 3) : []
  const shown = r?.batch || check.batch

  return (
    <LocaleScope locale={locale}>
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 pt-5 sm:px-6">
        <Link href="/" aria-label={t('nav.home')}>
          <Logo />
        </Link>
        <Link href="/" className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 px-3 text-primary')}>
          {t('share.checkABatch')}
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-8 pb-14 sm:px-6" data-share-page data-share-state={r?.state ?? 'unavailable'}>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary hi:text-xs">{t('share.kicker')}</p>
        <h1 className="mt-2 font-mono text-4xl font-semibold tracking-wider break-all sm:text-5xl" data-share-batch>{shown}</h1>

        {r && style && text ? (
          <section className={cn('mt-6 overflow-hidden rounded-2xl border', style.band)} aria-labelledby="share-headline">
            {alert && !alert.demo && (r.state === 'flagged' || r.state === 'retracted') && (
              <p className="flex items-center gap-1.5 border-b border-current/10 px-5 pt-3 pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-6">
                <Landmark className="size-3.5" aria-hidden="true" /> {t('result.official')}
              </p>
            )}
            <div className="flex gap-4 p-5 sm:p-6">
              <div className={cn('grid size-12 shrink-0 place-items-center rounded-xl', style.chip)}>
                <style.Icon className="size-6" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold uppercase tracking-wider', style.chip)} data-share-chip>
                  {text.label}
                </span>
                <h2 id="share-headline" className="mt-2.5 text-xl font-semibold leading-snug tracking-tight text-balance">
                  {text.headline}
                </h2>
                {alert && <p className="mt-1 text-sm text-muted-foreground">{alert.brand} · {alert.manufacturer}</p>}
              </div>
            </div>
            {alert && r.state === 'flagged' && <ChildShield alert={alert} />}

            <div className="grid gap-5 bg-card/70 px-5 py-5 sm:px-6">
              {r.state === 'flagged' && alert && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <WhatToDo />
                  <SeverityWhy alert={alert} />
                </div>
              )}
              {r.state === 'retracted' && alert?.retraction && (
                <p className="text-sm">
                  <span className="font-semibold">{alert.retraction.reason}.</span>{' '}
                  <span className="text-muted-foreground">{t('result.originalStays')}</span>
                </p>
              )}
              {r.state === 'no_alert' && (
                <p className="text-sm">
                  <span className="font-semibold">{t('result.notCertificate')}</span>{' '}
                  <span className="text-muted-foreground">{t('result.notCertificateMeans')}</span>
                </p>
              )}
              {r.state === 'unreadable' && (
                <p className="text-sm text-muted-foreground">
                  {r.source === 'local' ? t('share.unreadableLocal') : t('share.unreadableLookalike')} {t('share.reread')}
                </p>
              )}
              {alert && <AlertFacts alert={alert} locale={locale} />}
              {alert && <NoticeLinks alert={alert} locale={locale} />}
              {alert && locale !== 'en' && <p className="text-xs leading-5 text-muted-foreground" data-published-as-is>{t('note.publishedAsIs')}</p>}
              {others.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('share.alsoOnRecord')}</p>
                  <ul className="mt-2 grid gap-2 text-sm">
                    {others.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="min-w-0">
                          {a.authority} · {a.noticeDate}
                          {a.retraction ? t('share.withdrawn') : ''}
                        </span>
                        <span className="flex gap-3 text-primary">
                          {a.noticeUrl && <a href={a.noticeUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{t('share.noticeLink')}</a>}
                          {a.explorer.entity && <a href={a.explorer.entity} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{t('share.arkivLink')}</a>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {r.source !== 'local' && r.state !== 'no_alert' && <p className="text-xs text-muted-foreground">{t('share.asOf', { time: asOfText(r.asOf, locale) })}</p>}
            </div>
          </section>
        ) : (
          <section className="mt-6 rounded-2xl border bg-card p-5 sm:p-6" aria-labelledby="share-headline">
            <h2 id="share-headline" className="text-xl font-semibold tracking-tight">{t('share.unavailableTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('share.unavailableBody')}</p>
          </section>
        )}

        <div className="mt-6 flex flex-col gap-3 rounded-2xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <p className="font-semibold">{t('share.atHome')}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('share.atHomeHint')}</p>
          </div>
          <Link href={checkPath(shown)} className={cn(buttonVariants(), 'h-12 rounded-xl px-5 text-base font-semibold')} data-share-cta>
            {t('share.cta')} <ArrowRight data-icon="inline-end" />
          </Link>
        </div>

        <p className="mt-8 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t('share.privacy')}
        </p>
      </main>
    </div>
    </LocaleScope>
  )
}
