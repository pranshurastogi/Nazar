import { loadAlerts, loadFeed, type AlertFeed, type FeedFilters, type FeedPage } from './index'
import { prefetch } from './swr'

// Cache keys and loaders shared by the tabs and the nav prefetch, so hovering "Feed" warms
// exactly the entry the Feed tab reads first. Demo answers are never cached.

// Versioned so a list cached before the medicines-only filter is not painted first.
export const HOME_KEYS = {
  severe: 'alerts:sev4:med',
  child: 'alerts:peds:med',
} as const

// Home lists medicines only: regulators list cosmetics and hand rubs in the same tables, and a
// shampoo has no place under "High-severity alerts" or Child Shield. Every source answers newest first.
export const loadSevere = () => loadAlerts({ minSeverity: 4, limit: 20, productClass: 'medicine' })
/** Children's medicines with an official alert (the Feed's Child Shield filter also lists cosmetics). */
export const loadChild = () => loadAlerts({ peds: true, limit: 20, productClass: 'medicine' })

export const feedKey = (q: FeedFilters) =>
  `feed:${JSON.stringify([q.minSeverity ?? 0, !!q.peds, q.state ?? '', q.source ?? ''])}`

export const SUMMARY_KEY = 'arkiv:summary'

/** Only live answers are cached as the tab's data; demo rows and the saved copy are re-asked next time. */
export const notDemo = (v: AlertFeed | FeedPage) => v.source === 'api' || v.source === 'arkiv'

/** Warms a tab's first data while its nav link is hovered or focused. */
export function prefetchFor(href: string) {
  if (href === '/feed') prefetch(feedKey({}), () => loadFeed({}), { keep: notDemo })
  else if (href === '/arkiv') prefetch(SUMMARY_KEY, () => import('./directory').then((m) => m.apiSummary()), { freshMs: 60_000 })
  else if (href === '/') {
    prefetch(HOME_KEYS.severe, loadSevere, { keep: notDemo })
    prefetch(HOME_KEYS.child, loadChild, { keep: notDemo })
  }
}
