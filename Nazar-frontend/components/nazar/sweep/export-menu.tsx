'use client'

import { Menu } from '@base-ui/react/menu'
import { ChevronDown, ClipboardCopy, Download, Printer } from 'lucide-react'
import { toast } from 'sonner'

import { copy } from '@/components/nazar/result/shared'
import { buttonVariants } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { siteOrigin } from '@/lib/share'
import { csvFilename, downloadText, flaggedText, toCsv, type SweepItem } from '@/lib/sweep'
import { cn } from '@/lib/utils'

const itemCls =
  'flex min-h-11 cursor-default items-start gap-3 rounded-lg px-3 py-2.5 text-sm outline-none select-none data-[highlighted]:bg-muted data-[disabled]:opacity-50'

/** Download CSV, copy the flagged list, print a counter sheet. All made in the browser; nothing is uploaded. */
export function ExportMenu({ items, flagged, disabled }: { items: SweepItem[]; flagged: number; disabled?: boolean }) {
  const { t, tp } = useT()
  const origin = siteOrigin()
  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(buttonVariants({ variant: 'outline' }), 'h-11 gap-1.5 rounded-xl px-3.5 text-sm font-semibold')}
        disabled={disabled}
        data-sweep-export
      >
        <Download className="size-4" aria-hidden="true" /> {t('sweep.export')} <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-50">
          <Menu.Popup
            className="w-[min(19rem,calc(100vw-2rem))] origin-[var(--transform-origin)] rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none transition-[opacity,transform] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none"
            data-sweep-export-menu
          >
            <Menu.Item className={itemCls} onClick={() => downloadText(toCsv(items, origin), csvFilename())} data-export="csv">
              <Download className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                <span className="block font-medium">{t('sweep.csv')}</span>
                <span className="block text-xs text-muted-foreground">{t('sweep.csvHint')}</span>
              </span>
            </Menu.Item>
            <Menu.Item
              className={itemCls}
              disabled={!flagged}
              onClick={() => {
                const text = flaggedText(items, origin)
                if (text) void copy(text, t('sweep.flaggedListWhat'))
                else toast(t('sweep.noFlaggedToast'))
              }}
              data-export="copy"
            >
              <ClipboardCopy className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                <span className="block font-medium">{t('sweep.copyFlagged')}</span>
                <span className="block text-xs text-muted-foreground">{flagged ? tp('sweep.copyHint', flagged) : t('sweep.nothingFlagged')}</span>
              </span>
            </Menu.Item>
            <Menu.Item className={itemCls} onClick={() => setTimeout(() => window.print(), 50)} data-export="print">
              <Printer className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                <span className="block font-medium">{t('sweep.print')}</span>
                <span className="block text-xs text-muted-foreground">{t('sweep.printHint')}</span>
              </span>
            </Menu.Item>
            <p className="px-3 pt-1.5 pb-1 text-[11px] leading-4 text-muted-foreground">{t('sweep.madeInBrowser')}</p>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
