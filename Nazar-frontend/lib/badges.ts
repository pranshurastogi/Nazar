import { useEffect, useState, useSyncExternalStore } from 'react'

import { currentSnapshot, onSnapshot, type SnapshotIndex } from '@/lib/source/snapshot'
import { SEEN_EVENT, SEEN_KEY, unseenCount } from '@/lib/seen'

// Counts for the nav badges, read on the device only: no network call of their own.
// - Alerts: alerts in the saved copy (loaded by the shell anyway) not seen on this device.
// - Cabinet: saved medicines whose last check found an alert. The cabinet's own storage format
//   (lib/cabinet.ts: an array under 'nazar:cabinet', each item's `last.state`) is read directly,
//   so the shell never loads the cabinet's code.

const CABINET_KEY = 'nazar:cabinet'
const CABINET_EVENT = 'nazar:cabinet-change'

function readFlagged(): number {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CABINET_KEY) || '[]')
    if (!Array.isArray(parsed)) return 0
    return parsed.filter((i) => (i as { last?: { state?: unknown } } | null)?.last?.state === 'flagged').length
  } catch {
    return 0
  }
}

function subscribeCabinet(onChange: () => void) {
  const onStorage = (e: StorageEvent) => (e.key === null || e.key === CABINET_KEY) && onChange()
  window.addEventListener(CABINET_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CABINET_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** Saved medicines currently flagged by their last check; 0 during server render. */
export function useCabinetFlagged() {
  return useSyncExternalStore(subscribeCabinet, readFlagged, () => 0)
}

/** Alerts in the saved copy this device has not seen yet; 0 until the copy loads. */
export function useUnseenAlerts() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let snap: SnapshotIndex | null = currentSnapshot()
    const refresh = () => setCount(snap ? unseenCount(snap) : 0)
    refresh()
    const off = onSnapshot((s) => {
      snap = s
      refresh()
    })
    const onStorage = (e: StorageEvent) => (e.key === null || e.key === SEEN_KEY) && refresh()
    window.addEventListener(SEEN_EVENT, refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      off()
      window.removeEventListener(SEEN_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return count
}
