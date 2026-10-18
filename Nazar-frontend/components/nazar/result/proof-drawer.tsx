'use client'

import { FileSearch, ScanText } from 'lucide-react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { CATEGORY_MEANING, TIER_NOTE, type Alert } from '@/lib/source'
import { cn } from '@/lib/utils'
import { OnchainProof } from './onchain-proof'
import { METHOD_LABEL } from './shared'

type Row = { label: string; value: React.ReactNode }

/** "How do we know?": what the regulator said, how it was read, and the full on-chain proof. */
export function ProofDrawer({ alert, open, onOpenChange }: { alert: Alert | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!alert) return null
  const tierNote = TIER_NOTE[alert.tier]
  const rows: Row[] = [
    { label: 'Published by', value: alert.authority },
    {
      label: 'Notice',
      value: (
        <>
          <span className="block">{alert.notice}</span>
          <span className="block text-xs font-normal text-muted-foreground">{alert.noticeDate}</span>
        </>
      ),
    },
    { label: 'Category', value: `${alert.category.toUpperCase()} · ${CATEGORY_MEANING[alert.category]}` },
  ]
  if (alert.mfg || alert.expiry) rows.push({ label: 'Batch dates', value: [alert.mfg && `Mfg ${alert.mfg}`, `Exp ${alert.expiry}`].filter(Boolean).join(' · ') })
  if (alert.method) {
    const conf = alert.confidence !== null ? ` · ${Math.round(alert.confidence * 100)}% confidence` : ''
    rows.push({ label: 'How it was read', value: `${METHOD_LABEL[alert.method] ?? alert.method}${conf}` })
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="mx-auto w-full sm:max-w-lg">
        <DrawerHeader className="px-5 pt-4 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Proof of record</p>
          <DrawerTitle className="text-xl font-semibold tracking-tight">How do we know?</DrawerTitle>
          <DrawerDescription className="text-left text-pretty">
            Nazar repeats what the regulator published. It does not test medicines itself.
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-5">
          {tierNote && (
            <p data-tier={alert.tier} className="mt-3 flex items-start gap-2 rounded-lg border border-caution-border bg-caution-soft px-3 py-2 text-xs font-medium text-caution">
              <ScanText className="mt-px size-4 shrink-0" /> {tierNote}
            </p>
          )}
          <dl className="pt-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b py-3 text-sm">
                <dt className="shrink-0 text-muted-foreground">{label}</dt>
                <dd className="min-w-0 text-right font-medium text-pretty">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="py-4">
            <OnchainProof alert={alert} variant="sheet" />
          </div>
          {alert.demo && (
            <p className="mb-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Demo record: shown because the Nazar API and Arkiv could not answer. It is not published on Arkiv, so there is no entity key or wallet to verify.
            </p>
          )}
        </div>
        <DrawerFooter className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {alert.noticeUrl ? (
            <a href={alert.noticeUrl} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants(), 'h-12 text-sm')}>
              <FileSearch /> View source notice
            </a>
          ) : (
            <Button className="h-12" variant="outline" onClick={() => toast('This record has no source document link.')}>
              <FileSearch /> No source document link
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
