'use client'

import { useState } from 'react'
import { Landmark } from 'lucide-react'

import { Separator } from '@/components/ui/separator'
import type { PackLabel } from '@/lib/scan/pack'
import type { Alert, CheckResult } from '@/lib/source'
import { cn } from '@/lib/utils'
import { ResultActions, ShareSave } from './result/actions'
import { ChildShield } from './result/child-shield'
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

export { copy, SourceTag } from './result/shared'

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
  const tone = TONE[result.state]
  const alert = 'alert' in result ? result.alert : undefined
  const alerts = 'alerts' in result ? result.alerts : []

  const openProof = (a: Alert) => {
    setProof(a)
    setProofOpen(true)
  }

  const official = alert && !alert.demo && (result.state === 'flagged' || result.state === 'retracted')

  return (
    <>
    <section
      aria-live="polite"
      data-state={result.state}
      className={cn('animate-in fade-in-0 slide-in-from-bottom-2 overflow-hidden rounded-2xl border duration-300', tone.band)}
    >
      {official && (
        <p className="flex items-center gap-1.5 border-b border-current/10 px-5 pt-3 pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-6" data-official-label>
          <Landmark className="size-3.5" aria-hidden="true" /> Official · from regulator notices, verified on Arkiv
        </p>
      )}
      <VerdictHeader result={result} alert={alert} />
      {alert && result.state === 'flagged' && <ChildShield alert={alert} />}
      <VerdictBody result={result} alert={alert} onCheck={onCheck} />
      <ShareSave result={result} saveable={saveable} />
      {alerts.length > 1 && <NoticeTimeline alerts={alerts} onOpen={openProof} />}
      {/* Phones get one line that opens the proof sheet; the full chain would repeat that sheet and double the card's length. */}
      {alert && (wide ? <OnchainProof alert={alert} /> : <ProofLine alert={alert} onOpen={() => openProof(alert)} />)}
      <Separator />
      <ResultActions result={result} alert={alert} onProof={openProof} />
      <ProofDrawer alert={proof} open={proofOpen} onOpenChange={setProofOpen} />
    </section>
    {/* AI text lives outside the verdict card, below it, and only loads when asked for. */}
    <AboutMedicine query={queryForResult(result, pack)} verdict={result.state} />
    </>
  )
}
