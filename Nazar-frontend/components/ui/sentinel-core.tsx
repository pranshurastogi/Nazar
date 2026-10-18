'use client'

import { useEffect, useId, useRef, type RefObject } from 'react'

import { cn } from '@/lib/utils'
import './sentinel-core.css'

/**
 * Sentinel eye: a watchful, cybernetic eye that follows the pointer and tells you, by colour
 * and motion, what is happening. Idle it looks around; checking it scans; a result tints it
 * (red flagged, amber can't tell / retracted, slate no alert — never green).
 *
 * Decorative by default (aria-hidden). Pass `label` when the eye is the only cue on screen.
 */

export type SentinelState = 'idle' | 'checking' | 'scanning' | 'flagged' | 'retracted' | 'no_alert' | 'unreadable'

export interface SentinelEyeProps {
  state?: SentinelState
  /** When this element has focus the eye looks at it (e.g. the batch input). */
  lookAt?: RefObject<HTMLElement | null>
  /** Follow the pointer anywhere on the page. */
  follow?: boolean
  label?: string
  className?: string
}

/** Iris travel, in viewBox units: wide horizontally, short vertically, like a real eye. */
const MAX_X = 22
const MAX_Y = 11
const IDLE_AFTER_MS = 2600
const WANDER_EVERY_MS = 2300

export function SentinelEye({ state = 'idle', lookAt, follow = true, label, className }: SentinelEyeProps) {
  const id = useId().replace(/:/g, '')
  const rootRef = useRef<HTMLSpanElement>(null)
  const irisRef = useRef<SVGGElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const root = rootRef.current
    const iris = irisRef.current
    if (!root || !iris) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0
    let lastPointer = 0
    let pending: { x: number; y: number } | null = null

    const set = (x: number, y: number, wander = false) => {
      root.dataset.wander = wander ? '1' : '0'
      iris.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`
    }
    /** Aims at a point on the page (client coordinates). */
    const aim = (cx: number, cy: number) => {
      const r = root.getBoundingClientRect()
      const dx = cx - (r.left + r.width / 2)
      const dy = cy - (r.top + r.height / 2)
      const dist = Math.hypot(dx, dy) || 1
      // Full travel once the target is about a screen-third away; gentle nearer in.
      const k = Math.min(dist / 320, 1)
      set((dx / dist) * MAX_X * k, (dy / dist) * MAX_Y * k)
    }
    const focused = () => !!lookAt?.current && document.activeElement === lookAt.current
    const busy = () => stateRef.current === 'checking' || stateRef.current === 'scanning'

    const update = () => {
      raf = 0
      if (reduce.matches) return set(0, 0)
      if (busy()) return set(0, 0)
      if (focused()) {
        const r = lookAt!.current!.getBoundingClientRect()
        return aim(r.left + Math.min(r.width * 0.35, 160), r.top + r.height / 2)
      }
      if (pending) aim(pending.x, pending.y)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }

    const onPointer = (e: PointerEvent) => {
      if (!follow) return
      lastPointer = performance.now()
      pending = { x: e.clientX, y: e.clientY }
      schedule()
    }
    const onFocus = () => schedule()

    // Idle: glance around now and then, the way an eye does when nothing is happening.
    const wander = window.setInterval(() => {
      if (reduce.matches || busy() || focused() || document.hidden) return
      if (performance.now() - lastPointer < IDLE_AFTER_MS) return
      const a = Math.random() * Math.PI * 2
      const m = 0.35 + Math.random() * 0.6
      set(Math.cos(a) * MAX_X * m, Math.sin(a) * MAX_Y * m, true)
    }, WANDER_EVERY_MS)

    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('pointerdown', onPointer, { passive: true })
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onFocus)
    schedule()
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(wander)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onFocus)
    }
  }, [follow, lookAt])

  // A new state re-centres the eye (checking, a result landing) before it resumes following.
  useEffect(() => {
    const iris = irisRef.current
    if (iris && state !== 'idle') iris.style.transform = 'translate(0px, 0px)'
  }, [state])

  const g = (n: string) => `sentinel-${n}-${id}`
  const almond = 'M30 60 C 62 16, 138 16, 170 60 C 138 104, 62 104, 30 60 Z'

  return (
    <span
      ref={rootRef}
      className={cn('sentinel', className)}
      data-state={state}
      data-sentinel
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <clipPath id={g('clip')}>
            <path d={almond} />
          </clipPath>
          <radialGradient id={g('sclera')} cx="50%" cy="45%" r="62%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#eef2f9" />
            <stop offset="100%" stopColor="#c9d3e4" />
          </radialGradient>
          <radialGradient id={g('iris')} cx="42%" cy="38%" r="70%">
            <stop className="s-stop-1" offset="0%" />
            <stop className="s-stop-2" offset="78%" />
            <stop offset="100%" stopColor="#0a1530" />
          </radialGradient>
          <linearGradient id={g('scan')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#bfe0ff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={g('lid')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a1530" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0a1530" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Circuit traces: the "sentinel" in it. They carry a flowing dash while checking. */}
        <g strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path className="s-trace" d="M30 60 H19 L11 49 H4" />
          <path className="s-trace" d="M170 60 H181 L189 71 H196" />
          <path className="s-trace s-flow" d="M30 60 H19 L11 49 H4" />
          <path className="s-trace s-flow" d="M170 60 H181 L189 71 H196" />
          <path className="s-trace" d="M60 30 L54 20 H44" opacity=".55" />
          <path className="s-trace" d="M140 90 L146 100 H156" opacity=".55" />
        </g>
        <circle className="s-node" cx="4" cy="49" r="2.6" />
        <circle className="s-node" cx="196" cy="71" r="2.6" />
        <circle className="s-node" cx="44" cy="20" r="2" opacity=".55" />
        <circle className="s-node" cx="156" cy="100" r="2" opacity=".55" />

        <g className="s-squint">
          <g className="s-blink">
            <g clipPath={`url(#${g('clip')})`}>
              <path d={almond} fill={`url(#${g('sclera')})`} />
              <g ref={irisRef} className="s-iris">
                <circle cx="100" cy="60" r="31" fill={`url(#${g('iris')})`} />
                <circle cx="100" cy="60" r="31" stroke="#0a1530" strokeOpacity=".55" strokeWidth="2" />
                <circle className="s-ring" cx="100" cy="60" r="23" stroke="#ffffff" strokeOpacity=".28" strokeWidth="1.2" strokeDasharray="3 5" />
                <circle className="s-pupil" cx="100" cy="60" r="12" fill="#070b18" />
                <circle cx="110" cy="49" r="4.2" fill="#ffffff" fillOpacity=".92" />
                <circle cx="91" cy="69" r="1.8" fill="#ffffff" fillOpacity=".5" />
              </g>
              <rect className="s-scan" x="30" y="56" width="140" height="8" fill={`url(#${g('scan')})`} />
              {/* Upper-lid shade, so the eye reads as set into a face rather than floating. */}
              <path d="M30 60 C 62 16, 138 16, 170 60 C 138 34, 62 34, 30 60 Z" fill={`url(#${g('lid')})`} />
            </g>
            <path className="s-outline" d={almond} strokeWidth="2.6" strokeLinejoin="round" />
          </g>
        </g>
        <path d="M42 46 C 70 8, 130 8, 158 46" className="s-outline" strokeWidth="1.4" strokeLinecap="round" opacity=".35" />
      </svg>
    </span>
  )
}

export default SentinelEye
