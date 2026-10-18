'use client'

import { formatAsOfIn, useT } from '@/lib/i18n'
import { alertOf, cantTell, childShield, itemState, suggestionOf, type Counts, type SweepItem } from '@/lib/sweep'
import './sweep.css'

/**
 * The counter sheet: hidden on screen, the only thing printed from /sweep (see sweep.css).
 * Plain black on white, flagged first, every row with the regulator and notice date.
 */
export function PrintSheet({ items, counts, at, snapshotAt, origin }: { items: SweepItem[]; counts: Counts; at: Date; snapshotAt: Date | null; origin: string }) {
  const { t, locale } = useT()
  const ist = (d: Date) => formatAsOfIn(locale, d, true)
  return (
    <div className="sweep-print" data-sweep-print aria-hidden="true">
      <div className="sweep-print-head">
        <p className="sweep-print-brand">{t('sweep.print.brand')}</p>
        <p className="sweep-print-title">{t('sweep.print.title', { time: ist(at) })}</p>
        <p className="sweep-print-meta">
          {t('sweep.print.meta', { flagged: counts.flagged, retracted: counts.retracted, unreadable: counts.unreadable, no_alert: counts.no_alert, total: counts.total })}
          {snapshotAt ? t('sweep.print.asOf', { time: ist(snapshotAt) }) : ''}
        </p>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>{t('sweep.col.batch')}</th>
            <th>{t('sweep.print.yourList')}</th>
            <th>{t('sweep.col.result')}</th>
            <th>{t('sweep.print.product')}</th>
            <th>{t('sweep.col.regulator')}</th>
            <th>{t('sweep.print.noticeDate')}</th>
            <th>{t('sweep.print.sev')}</th>
            <th>{t('sweep.child')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => {
            const s = itemState(i)
            const a = alertOf(i)
            return (
              <tr key={i.id} data-print-state={s ?? ''}>
                <td>{n + 1}</td>
                <td className="mono">{i.batch || i.raw}</td>
                <td>{[i.product, i.qty && t('sweep.qty', { v: i.qty }), i.expiry && t('sweep.exp', { v: i.expiry })].filter(Boolean).join(' · ')}</td>
                <td className="state">
                  {s ? t(`state.${s}`) : t('sweep.notChecked')}
                  {cantTell(i) === 'lookalike' ? t('sweep.print.didYouMean', { batch: suggestionOf(i) ?? '' }) : ''}
                </td>
                <td>{a?.brand ?? ''}</td>
                <td>{a?.authority ?? ''}</td>
                <td>{a?.noticeDate ?? ''}</td>
                <td>{a ? `${a.severity}/5` : ''}</td>
                <td>{childShield(a) ? t('sweep.print.yes') : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="sweep-print-foot">
        {t('sweep.print.foot', { url: `${origin.replace(/^https?:\/\//, '')}/b/BATCH` })}
      </p>
    </div>
  )
}
