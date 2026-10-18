'use client'

import { useState } from 'react'

import { Separator } from '@/components/ui/separator'
import type { Alert, CheckResult } from '@/lib/source'
import { cn } from '@/lib/utils'
import { ResultActions } from './result/actions'
import { ChildShield } from './result/child-shield'
import { NoticeTimeline } from './result/notice-timeline'
import { OnchainProof } from './result/onchain-proof'
import { ProofDrawer } from './result/proof-drawer'
import { TONE } from './result/shared'
import { VerdictBody } from './result/verdict-body'
import { VerdictHeader } from './result/verdict-header'

// One answer to a check, composed from the modules in ./result. Used by Check, Feed and
// Cabinet; the proof sheet re-uses the same on-chain proof module in its full form.

export { copy, SourceTag } from './result/shared'

export function ResultCard({
  result,
  onCheck,
  saveable = true,
}: {
  result: CheckResult
  onCheck: (batch: string) => void
  /** Offer "Save to cabinet"; off inside the cabinet itself. */
  saveable?: boolean
}) {
  const [proof, setProof] = useState<Alert | null>(null)
  const [proofOpen, setProofOpen] = useState(false)
  const tone = TONE[result.state]
  const alert = 'alert' in result ? result.alert : undefined
  const alerts = 'alerts' in result ? result.alerts : []

  const openProof = (a: Alert) => {
    setProof(a)
    setProofOpen(true)
  }

  return (
    <section
      aria-live="polite"
      data-state={result.state}
      className={cn('animate-in fade-in-0 slide-in-from-bottom-2 overflow-hidden rounded-2xl border duration-300', tone.band)}
    >
      <VerdictHeader result={result} alert={alert} />
      {alert?.peds && result.state === 'flagged' && <ChildShield />}
      <VerdictBody result={result} alert={alert} onCheck={onCheck} />
      {alerts.length > 1 && <NoticeTimeline alerts={alerts} onOpen={openProof} />}
      {alert && <OnchainProof alert={alert} />}
      <Separator />
      <ResultActions result={result} alert={alert} saveable={saveable} onProof={openProof} />
      <ProofDrawer alert={proof} open={proofOpen} onOpenChange={setProofOpen} />
    </section>
  )
}
