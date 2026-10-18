'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import type { PackLabel } from '@/lib/scan/pack'
import type { Alert, CheckResult } from '@/lib/source'
import { cn } from '@/lib/utils'
import { ResultActions, ShareSave } from './result/actions'
import { NoticeTimeline } from './result/notice-timeline'
import { OnchainProof } from './result/onchain-proof'
import { ProofDrawer } from './result/proof-drawer'
import { ProofLine, useWide } from './result/proof-line'
import { TONE } from './result/shared'
import { VerdictBody } from './result/verdict-body'
import { VerdictHeader } from './result/verdict-header'
import { AboutMedicine } from './medicine/about-medicine'
import { queryForResult } from './medicine/query'

// One answer to a check, composed from the modules in ./result. Used by Check, Feed and
// Cabinet; the proof sheet re-uses the same on-chain proof module in its full form.
//
// Order, top to bottom: the state band (icon, chip, headline, product, batch, time), the key
// message (what to do first, or what the answer does not mean), one action bar, the notice
// timeline and on-chain proof, then a quiet footer with the source and "How do we know?".

export { copy, SourceTag } from './result/shared'

const EASE = [0.22, 1, 0.36, 1] as const

export function ResultCard({
  result,
  onCheck,
  saveable = true,
  pack,
}: {
  result: CheckResult
  onCheck: (batch: string) => void
  /** Offer "Save to cabinet"; off inside the cabinet itself. */
  saveable?: boolean
  /** Label read by the scanner, when the check started from a scan; names the medicine for "About this medicine". */
  pack?: PackLabel | null
}) {
  const [proof, setProof] = useState<Alert | null>(null)
  const [proofOpen, setProofOpen] = useState(false)
  const wide = useWide()
  const reduce = useReducedMotion() ?? false
  const tone = TONE[result.state]
  const alert = 'alert' in result ? result.alert : undefined
  const alerts = 'alerts' in result ? result.alerts : []

  const openProof = (a: Alert) => {
    setProof(a)
    setProofOpen(true)
  }

  const official = !!alert && !alert.demo && (result.state === 'flagged' || result.state === 'retracted')
  // A new answer rises in gently; the same answer confirmed live keeps its element, so it never re-animates.
  const rise = (delay = 0) =>
    reduce ? { initial: false as const } : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.24, ease: EASE, delay } }

  return (
    <>
      <motion.section
        {...rise()}
        aria-live="polite"
        data-state={result.state}
        className={cn('overflow-hidden rounded-2xl border bg-card shadow-sm', tone.card)}
      >
        <VerdictHeader result={result} alert={alert} official={official} />
        <VerdictBody result={result} alert={alert} onCheck={onCheck} />
        <ShareSave result={result} saveable={saveable} />
        {alerts.length > 1 && <NoticeTimeline alerts={alerts} onOpen={openProof} />}
        {/* Phones get one line that opens the proof sheet; the full chain would repeat that sheet and double the card's length. */}
        {alert && (wide ? <OnchainProof alert={alert} /> : <ProofLine alert={alert} onOpen={() => openProof(alert)} />)}
        <ResultActions result={result} alert={alert} onProof={openProof} />
        <ProofDrawer alert={proof} open={proofOpen} onOpenChange={setProofOpen} />
      </motion.section>
      {/* AI text lives outside the verdict card, below it, and only loads when asked for. */}
      <motion.div {...rise(0.06)}>
        <AboutMedicine query={queryForResult(result, pack)} verdict={result.state} />
      </motion.div>
    </>
  )
}
