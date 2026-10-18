'use client'

import { FileSearch, ScanText } from 'lucide-react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { type Alert } from '@/lib/source'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { OnchainProof } from './onchain-proof'
import { METHOD_LABEL, TIER_KEY } from './shared'

type Row = { label: string; value: React.ReactNode }

/** "How do we know?": what the regulator said, how it was read, and the full on-chain proof. */
export function ProofDrawer({ alert, open, onOpenChange }: { alert: Alert | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useT()
  if (!alert) return null
  const tierKey = TIER_KEY[alert.tier]
  const tierNote = tierKey ? t(tierKey) : undefined
  const rows: Row[] = [
    { label: t('proof.publishedBy'), value: alert.authority },
    {
      label: t('proof.notice'),
      value: (
        <>
          <span className="block">{alert.notice}</span>
          <span className="block text-xs font-normal text-muted-foreground">{alert.noticeDate}</span>
        </>
      ),
    },
    { label: t('proof.category'), value: `${alert.category.toUpperCase()} · ${t(`category.${alert.category}`)}` },
  ]
  if (alert.mfg || alert.expiry) rows.push({ label: t('proof.batchDates'), value: [alert.mfg && t('proof.mfg', { date: alert.mfg }), t('proof.exp', { date: alert.expiry })].filter(Boolean).join(' · ') })
  if (alert.method) {
    const conf = alert.confidence !== null ? t('proof.confidence', { n: Math.round(alert.confidence * 100) }) : ''
    const method = METHOD_LABEL[alert.method]
    rows.push({ label: t('proof.howRead'), value: `${method ? t(method) : alert.method}${conf}` })
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent className="mx-auto w-full sm:max-w-lg">
        <DrawerHeader className="px-5 pt-4 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">{t('proof.kicker')}</p>
          <DrawerTitle className="text-xl font-semibold tracking-tight">{t('result.howDoWeKnow')}</DrawerTitle>
          <DrawerDescription className="text-left text-pretty">
            {t('proof.repeats')}
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
              {t('proof.demoNote')}
            </p>
          )}
        </div>
        <DrawerFooter className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {alert.noticeUrl ? (
            <a href={alert.noticeUrl} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants(), 'h-12 text-sm')}>
              <FileSearch /> {t('proof.viewNotice')}
            </a>
          ) : (
            <Button className="h-12" variant="outline" onClick={() => toast(t('proof.noNoticeToast'))}>
              <FileSearch /> {t('proof.noNotice')}
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
