'use client'

import { memo } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Baby, ExternalLink, LoaderCircle, Search } from 'lucide-react'

import { SeverityPips } from '@/components/nazar/result/shared'
import { sharePath } from '@/lib/share'
import { stateName } from '@/lib/source/labels'
import { useT } from '@/lib/i18n'
import { alertOf, cantTell, childShield, itemState, suggestionOf, type SweepItem } from '@/lib/sweep'
import { cn } from '@/lib/utils'
import { StateChip, STATE_TONE } from './shared'

// The sweep's rows: a table from md up, cards below it. Flagged first; a look-alike is never a flag.

const linkCls =
  'inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'

function Links({ item, compact }: { item: SweepItem; compact?: boolean }) {
  const { t } = useT()
  const a = alertOf(item)
  return (
    <span className={cn('flex items-center', compact ? 'flex-nowrap justify-end [&>a]:px-1' : 'flex-wrap gap-x-3')}>
      {a?.noticeUrl && (
        <a href={a.noticeUrl} target="_blank" rel="noreferrer noopener" className={linkCls} aria-label={t('sweep.noticeAria', { batch: item.batch })} title={a.notice} data-link="notice">
          {t('sweep.notice')} {!compact && <ExternalLink className="size-3" aria-hidden="true" />}
        </a>
      )}
      {a?.entityKey && a.explorer.entity && (
        <a href={a.explorer.entity} target="_blank" rel="noreferrer noopener" className={linkCls} aria-label={t('sweep.arkivAria', { batch: item.batch })} data-link="arkiv">
          Arkiv {!compact && <ExternalLink className="size-3" aria-hidden="true" />}
        </a>
      )}
      {item.batch && (
        <Link href={sharePath(item.batch)} className={cn(linkCls, 'text-foreground')} aria-label={t('sweep.viewAria', { batch: item.batch })} data-link="view">
          {t('sweep.view')} <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </span>
  )
}

/** What the list said about this row (file context), muted under the batch. */
function Context({ item }: { item: SweepItem }) {
  const { t } = useT()
  const bits = [item.product, item.qty && t('sweep.qty', { v: item.qty }), item.expiry && t('sweep.exp', { v: item.expiry })].filter(Boolean)
  if (!bits.length && item.lines < 2) return null
  return (
    <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
      {bits.join(' · ')}
      {item.lines > 1 && <span className="whitespace-nowrap">{bits.length ? ' · ' : ''}{t('sweep.lines', { n: item.lines })}</span>}
    </span>
  )
}

function BatchCell({ item, nowrap }: { item: SweepItem; nowrap?: boolean }) {
  const { t } = useT()
  return item.batch ? (
    <span className={cn('font-mono text-[14px] font-semibold tracking-wide', nowrap ? 'whitespace-nowrap' : 'break-all')}>{item.batch}</span>
  ) : (
    <span className="font-mono text-[13px] break-all text-muted-foreground" title={t('sweep.lineTitle', { n: item.line })}>
      {item.raw || t('sweep.empty')} <span className="font-sans text-[11px] whitespace-nowrap">{t('sweep.lineAt', { n: item.line })}</span>
    </span>
  )
}

/** Product from the alert; for other states, what the answer means in a few words. */
function What({ item }: { item: SweepItem }) {
  const { t, tr } = useT()
  const a = alertOf(item)
  const s = itemState(item)
  if (a) {
    return (
      <span className="block min-w-0">
        <span className="block font-medium">{a.brand}</span>
        <span className="block truncate text-xs text-muted-foreground" title={a.failure}>
          {a.failure}
        </span>
      </span>
    )
  }
  if (s === 'unreadable') {
    const k = cantTell(item)
    return (
      <span className="block text-[13px] leading-5 text-caution" data-cant-tell={k}>
        {k === 'lookalike'
          ? tr('sweep.didYouMean', {
              batch: (
                <Link href={sharePath(suggestionOf(item)!)} className="font-mono font-semibold underline underline-offset-2">
                  {suggestionOf(item)}
                </Link>
              ),
            })
          : t(k === 'unchecked' ? 'sweep.unchecked' : 'sweep.unreadableRow')}
      </span>
    )
  }
  if (s === 'no_alert') return <span className="text-[13px] text-muted-foreground">{t('sweep.noAlertRow')}</span>
  return <span className="text-[13px] text-muted-foreground">…</span>
}

function Regulator({ item }: { item: SweepItem }) {
  const { t } = useT()
  const a = alertOf(item)
  if (!a) return <span className="text-muted-foreground">—</span>
  const state = stateName(a.state)
  return (
    <span className="block min-w-0">
      <span className="block text-[13px] leading-5 font-medium">{a.authority}</span>
      <span className="block text-xs text-muted-foreground" title={state ? t('feed.madeInState', { state }) : undefined}>
        {a.noticeDate}
      </span>
    </span>
  )
}

function Shield({ item }: { item: SweepItem }) {
  const { t } = useT()
  return childShield(alertOf(item)) ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-flagged-border px-1.5 py-0.5 text-[11px] font-bold text-flagged" title={t('sweep.childTitle')} data-child-shield>
      <Baby className="size-3.5" aria-hidden="true" /> {t('sweep.child')}
    </span>
  ) : null
}

function Confirming() {
  const { t } = useT()
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-confirming>
      <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t('sweep.confirmingRow')}
    </span>
  )
}

const TableRow = memo(function TableRow({ item }: { item: SweepItem }) {
  const s = itemState(item)
  const a = alertOf(item)
  return (
    <tr
      className={cn('align-top', s === 'flagged' && 'bg-flagged-soft/45')}
      data-sweep-row
      data-state={s ?? 'pending'}
      data-batch={item.batch || item.raw}
      data-confirmed={item.confirmed ? 'true' : 'false'}
      data-source={item.result?.source ?? ''}
    >
      <td className="relative py-3 pr-3 pl-4">
        <span className={cn('absolute inset-y-0 left-0 w-[3px]', s ? STATE_TONE[s].dot : 'bg-border', s === 'no_alert' && 'opacity-50')} aria-hidden="true" />
        <BatchCell item={item} nowrap />
        <Context item={item} />
      </td>
      <td className="py-3 pr-3">
        <span className="flex flex-col items-start gap-1">
          <StateChip item={item} />
          {item.confirming && item.result && <Confirming />}
        </span>
      </td>
      <td className="max-w-[12rem] py-3 pr-3 text-[13px]">
        <What item={item} />
      </td>
      <td className="min-w-[9rem] py-3 pr-3">
        <Regulator item={item} />
      </td>
      <td className="py-3 pr-3">
        {a ? (
          <span className="flex flex-col items-start gap-1.5">
            <SeverityPips value={a.severity} />
            <Shield item={item} />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-1.5 pr-2 text-right">
        <Links item={item} compact />
      </td>
    </tr>
  )
})

const Card = memo(function Card({ item }: { item: SweepItem }) {
  const s = itemState(item)
  const a = alertOf(item)
  return (
    <li
      className={cn('relative overflow-hidden rounded-2xl border bg-card p-4 pl-5', s === 'flagged' && 'border-flagged-border')}
      data-sweep-row
      data-state={s ?? 'pending'}
      data-batch={item.batch || item.raw}
      data-confirmed={item.confirmed ? 'true' : 'false'}
      data-source={item.result?.source ?? ''}
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', s ? STATE_TONE[s].dot : 'bg-border', s === 'no_alert' && 'opacity-50')} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <BatchCell item={item} />
          <Context item={item} />
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <StateChip item={item} />
          {item.confirming && item.result && <Confirming />}
        </span>
      </div>
      <div className="mt-2.5 text-[13px]">
        <What item={item} />
      </div>
      {a && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{a.authority}</span> · {a.noticeDate}
          </span>
          <SeverityPips value={a.severity} />
          <Shield item={item} />
        </div>
      )}
      <div className="-mx-1.5 -mb-2 mt-1">
        <Links item={item} />
      </div>
    </li>
  )
})

export function ResultsList({ items, wide, query }: { items: SweepItem[]; wide: boolean; query: string }) {
  const { t } = useT()
  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground" data-sweep-empty>
        <Search className="size-5" aria-hidden="true" />
        {query ? t('sweep.noRowsMatch', { q: query }) : t('sweep.noRows')}
      </div>
    )
  }
  if (!wide) {
    return (
      <ul className="grid gap-2.5" aria-label={t('sweep.resultsAria')} data-sweep-cards>
        {items.map((i) => (
          <Card key={i.id} item={i} />
        ))}
      </ul>
    )
  }
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card" data-sweep-table>
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <caption className="sr-only">{t('sweep.caption')}</caption>
        <thead className="border-b bg-muted/40 text-left text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          <tr>
            <th scope="col" className="py-2.5 pr-3 pl-4 font-bold">{t('sweep.col.batch')}</th>
            <th scope="col" className="py-2.5 pr-3 font-bold">{t('sweep.col.result')}</th>
            <th scope="col" className="py-2.5 pr-3 font-bold">{t('sweep.col.product')}</th>
            <th scope="col" className="py-2.5 pr-3 font-bold">{t('sweep.col.regulator')}</th>
            <th scope="col" className="py-2.5 pr-3 font-bold">{t('sweep.col.severity')}</th>
            <th scope="col" className="py-2.5 pr-4 text-right font-bold">
              <span className="sr-only">{t('sweep.col.links')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((i) => (
            <TableRow key={i.id} item={i} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
