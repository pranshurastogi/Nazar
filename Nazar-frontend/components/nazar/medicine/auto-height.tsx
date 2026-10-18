'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'

/**
 * Animates its height to fit its children whenever they change size (prompt → skeleton → story cards),
 * so the module opens smoothly instead of jumping. Under reduced motion it keeps its natural height. Overflow is
 * clipped only while it moves, so focus rings and the sideways story list are never cut off at rest.
 */
export function AutoHeight({ children, reduce, className }: { children: React.ReactNode; reduce: boolean; className?: string }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  const [moving, setMoving] = useState(false)
  const last = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    if (reduce) {
      last.current = null
      setHeight('auto')
      setMoving(false)
      return
    }
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight
      if (h === last.current) return
      // The first measure only pins the height; later ones animate, clipped until they land.
      if (last.current !== null) setMoving(true)
      last.current = h
      setHeight(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [reduce])

  // Reduced motion: natural height, no animation at all, so new content is simply there.
  if (reduce) {
    return (
      <div className={className} data-auto-height="rest">
        <div ref={inner}>{children}</div>
      </div>
    )
  }

  return (
    <motion.div
      className={className}
      initial={false}
      animate={{ height }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      onAnimationComplete={() => setMoving(false)}
      style={{ overflow: moving ? 'hidden' : 'visible' }}
      data-auto-height={moving ? 'moving' : 'rest'}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  )
}
