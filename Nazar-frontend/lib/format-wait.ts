/**
 * A retry wait in plain words, for "Try again in …": "a few seconds", "under a minute",
 * "about 8 min", "about 2 h". Never raw seconds.
 */
export function formatWait(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s <= 10) return 'a few seconds'
  if (s < 60) return 'under a minute'
  const min = Math.max(1, Math.round(s / 60))
  if (min < 90) return `about ${min} min`
  return `about ${Math.round(min / 60)} h`
}
