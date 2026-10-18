'use client'

import { Menu } from '@base-ui/react/menu'
import { ChevronDown, ClipboardCopy, Download, Printer } from 'lucide-react'
import { toast } from 'sonner'

import { copy } from '@/components/nazar/result/shared'
import { buttonVariants } from '@/components/ui/button'
import { siteOrigin } from '@/lib/share'
import { csvFilename, downloadText, flaggedText, toCsv, type SweepItem } from '@/lib/sweep'
import { cn } from '@/lib/utils'

const itemCls =
  'flex min-h-11 cursor-default items-start gap-3 rounded-lg px-3 py-2.5 text-sm outline-none select-none data-[highlighted]:bg-muted data-[disabled]:opacity-50'

/** Download CSV, copy the flagged list, print a counter sheet. All made in the browser; nothing is uploaded. */
export function ExportMenu({ items, flagged, disabled }: { items: SweepItem[]; flagged: number; disabled?: boolean }) {
  const origin = siteOrigin()
  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(buttonVariants({ variant: 'outline' }), 'h-11 gap-1.5 rounded-xl px-3.5 text-sm font-semibold')}
        disabled={disabled}
        data-sweep-export
      >
        <Download className="size-4" aria-hidden="true" /> Export <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
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
                <span className="block font-medium">Download CSV</span>
                <span className="block text-xs text-muted-foreground">Every row, with regulator, notice and proof links</span>
              </span>
            </Menu.Item>
            <Menu.Item
              className={itemCls}
              disabled={!flagged}
              onClick={() => {
                const text = flaggedText(items, origin)
                if (text) void copy(text, 'Flagged list')
                else toast('No flagged batches to copy')
              }}
              data-export="copy"
            >
              <ClipboardCopy className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                <span className="block font-medium">Copy flagged list</span>
                <span className="block text-xs text-muted-foreground">{flagged ? `${flagged} batch${flagged === 1 ? '' : 'es'} as text, with links` : 'Nothing flagged in this sweep'}</span>
              </span>
            </Menu.Item>
            <Menu.Item className={itemCls} onClick={() => setTimeout(() => window.print(), 50)} data-export="print">
              <Printer className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                <span className="block font-medium">Print counter sheet</span>
                <span className="block text-xs text-muted-foreground">Flagged first, in plain black and white</span>
              </span>
            </Menu.Item>
            <p className="px-3 pt-1.5 pb-1 text-[11px] leading-4 text-muted-foreground">Made in your browser. Nothing is uploaded.</p>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
