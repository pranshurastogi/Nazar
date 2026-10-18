'use client'

import { motion, useReducedMotion } from 'motion/react'

/**
 * The label window inside the viewfinder, as fractions of the visible area. Printed text is read only from
 * here (see `cropFor`), so the person knows where to put the B.No. line. Codes are read from the whole frame.
 */
export const LABEL_WINDOW = { x: 0.08, y: 0.34, w: 0.84, h: 0.32 }

/** Maps the on-screen label window onto the camera frame, allowing for object-cover cropping, with a margin. */
export function cropFor(video: HTMLVideoElement, pad = 0.08) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const ew = video.clientWidth || vw
  const eh = video.clientHeight || vh
  const scale = Math.max(ew / vw, eh / vh)
  const ox = (vw * scale - ew) / 2
  const oy = (vh * scale - eh) / 2
  const x0 = ((LABEL_WINDOW.x - pad) * ew + ox) / scale / vw
  const y0 = ((LABEL_WINDOW.y - pad) * eh + oy) / scale / vh
  const x1 = ((LABEL_WINDOW.x + LABEL_WINDOW.w + pad) * ew + ox) / scale / vw
  const y1 = ((LABEL_WINDOW.y + LABEL_WINDOW.h + pad) * eh + oy) / scale / vh
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return { x: clamp(x0), y: clamp(y0), w: clamp(x1) - clamp(x0), h: clamp(y1) - clamp(y0) }
}

/** Concentric rings (the Nazar motif) around a label window with corner marks and a slow scan line. */
export function ViewfinderOverlay({ active }: { active: boolean }) {
  const reduce = useReducedMotion()
  const { x, y, w, h } = LABEL_WINDOW
  const pct = (v: number) => `${v * 100}%`
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg className="absolute inset-0 size-full" preserveAspectRatio="none">
        <defs>
          <mask id="nazar-scan-window">
            <rect width="100%" height="100%" fill="white" />
            <rect x={pct(x)} y={pct(y)} width={pct(w)} height={pct(h)} rx="18" fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="black" fillOpacity="0.45" mask="url(#nazar-scan-window)" />
      </svg>
      <svg viewBox="0 0 200 200" className="absolute top-1/2 left-1/2 size-[150%] max-w-none -translate-x-1/2 -translate-y-1/2 text-white sm:size-[120%]">
        <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeOpacity=".10" strokeWidth=".6" />
        <circle cx="100" cy="100" r="74" fill="none" stroke="currentColor" strokeOpacity=".14" strokeWidth=".6" />
        <circle cx="100" cy="100" r="52" fill="none" stroke="currentColor" strokeOpacity=".20" strokeWidth=".6" />
      </svg>
      <div className="absolute" style={{ left: pct(x), top: pct(y), width: pct(w), height: pct(h) }}>
        {(['top-0 left-0 border-t-3 border-l-3 rounded-tl-[18px]', 'top-0 right-0 border-t-3 border-r-3 rounded-tr-[18px]', 'bottom-0 left-0 border-b-3 border-l-3 rounded-bl-[18px]', 'bottom-0 right-0 border-b-3 border-r-3 rounded-br-[18px]'] as const).map((c) => (
          <span key={c} className={`absolute size-7 border-white ${c}`} />
        ))}
        {active && !reduce && (
          <motion.span
            className="absolute inset-x-4 h-0.5 rounded-full bg-[var(--brand-tint)] shadow-[0_0_12px_2px_var(--brand-tint)]"
            initial={{ top: '12%', opacity: 0 }}
            animate={{ top: ['12%', '88%', '12%'], opacity: [0.2, 0.9, 0.2] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </div>
    </div>
  )
}
