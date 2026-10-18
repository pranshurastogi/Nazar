'use client'

import { alertOf, cantTell, childShield, istText, itemState, STATE_TEXT, suggestionOf, type Counts, type SweepItem } from '@/lib/sweep'
import './sweep.css'

/**
 * The counter sheet: hidden on screen, the only thing printed from /sweep (see sweep.css).
 * Plain black on white, flagged first, every row with the regulator and notice date.
 */
export function PrintSheet({ items, counts, at, snapshotAt, origin }: { items: SweepItem[]; counts: Counts; at: Date; snapshotAt: Date | null; origin: string }) {
  return (
    <div className="sweep-print" data-sweep-print aria-hidden="true">
      <div className="sweep-print-head">
        <p className="sweep-print-brand">Nazar · Shelf sweep</p>
        <p className="sweep-print-title">Counter sheet · {istText(at)}</p>
        <p className="sweep-print-meta">
          {counts.flagged} flagged · {counts.retracted} retracted · {counts.unreadable} can&rsquo;t tell · {counts.no_alert} no alert found · {counts.total} rows
          {snapshotAt ? ` · alert data as of ${istText(snapshotAt)}` : ''}
        </p>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Batch</th>
            <th>Your list</th>
            <th>Result</th>
            <th>Product (from the alert)</th>
            <th>Regulator</th>
            <th>Notice date</th>
            <th>Sev.</th>
            <th>Child</th>
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
                <td>{[i.product, i.qty && `Qty ${i.qty}`, i.expiry && `Exp ${i.expiry}`].filter(Boolean).join(' · ')}</td>
                <td className="state">
                  {s ? STATE_TEXT[s] : 'Not checked'}
                  {cantTell(i) === 'lookalike' ? ` · did you mean ${suggestionOf(i)}?` : ''}
                </td>
                <td>{a?.brand ?? ''}</td>
                <td>{a?.authority ?? ''}</td>
                <td>{a?.noticeDate ?? ''}</td>
                <td>{a ? `${a.severity}/5` : ''}</td>
                <td>{childShield(a) ? 'Yes' : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="sweep-print-foot">
        Flagged means a regulator alert (CDSCO, a state drug regulator or WHO) names this batch. &ldquo;No alert found&rdquo; is not a safety certificate. Look-alikes are never flags: check the pack
        again. Proof for any batch: {origin.replace(/^https?:\/\//, '')}/b/BATCH
      </p>
    </div>
  )
}
