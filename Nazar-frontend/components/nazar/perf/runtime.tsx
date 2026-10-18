'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

import { currentSnapshot, loadSnapshot, onSnapshot, scheduleSnapshot } from '@/lib/source'

// Background plumbing for speed and offline use, mounted once by the app shell: loads the
// alert snapshot when the page is idle, registers the service worker in production, and
// shows a small floating notice while the device is offline (fixed, so nothing shifts).

function useOnline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  return online
}

export function PerfRuntime() {
  const online = useOnline()
  const [snapAt, setSnapAt] = useState<Date | null>(null)

  useEffect(() => {
    const s = currentSnapshot()
    if (s) setSnapAt(s.generatedAt)
    const off = onSnapshot((x) => setSnapAt(x.generatedAt))
    scheduleSnapshot()
    // Coming back online, or back to the tab after a while: refresh (a 304 when nothing changed).
    const refresh = () => navigator.onLine && void loadSnapshot()
    window.addEventListener('online', refresh)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator && process.env.NEXT_PUBLIC_NAZAR_SW !== '0') {
      const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => console.info('Service worker not registered', err))
      if (document.readyState === 'complete') register()
      else window.addEventListener('load', register, { once: true })
    }
    return () => {
      off()
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (online) return null
  const when = snapAt?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return (
    <div
      role="status"
      data-offline-indicator
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-50 flex justify-center px-4"
    >
      <span className="inline-flex items-center gap-2 rounded-full border bg-card/95 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur">
        <WifiOff className="size-3.5 text-caution" aria-hidden="true" />
        Offline · showing saved data{when ? ` · checks use the ${when} snapshot` : ''}
      </span>
    </div>
  )
}
