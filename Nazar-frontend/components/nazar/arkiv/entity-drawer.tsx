'use client'

import { BadgeCheck, Copy, ExternalLink, Hourglass, ListFilter, Lock, ShieldAlert, Users, X } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { copy } from '@/components/nazar/result-card'
import { explorerAddress } from '@/lib/source'
import { attr, isOfficial, type DirectoryEntity } from '@/lib/source/directory'
import { cn } from '@/lib/utils'
import { blk, Chip, CopyButton, ExplorerLink, explorerEntity, shortDate, shortKey } from './shared'

// One entity, laid out the way Arkiv stores it: typed attributes (what a query can filter on)
// beside the JSON payload (display-only detail), with its flags, lifetime and creator check.

const TYPE_TITLE: Record<string, string> = { alert: 'Alert', notice: 'Notice', heartbeat: 'Heartbeat', retraction: 'Retraction' }

function valueText(a: { type: string; value: string | number }) {
  return a.type === 'key' || a.type === 'addr' ? String(a.value) : String(a.value)
}

export function EntityDrawer({
  entity,
  open,
  onOpenChange,
  onNoticeAlerts,
}: {
  entity: DirectoryEntity | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onNoticeAlerts: (key: string) => void
}) {
  if (!entity) return null
  const e = entity
  const official = isOfficial(e)
  const json = JSON.stringify(e.payload, null, 2) ?? 'null'
  const noticeKey = e.type === 'alert' ? attr(e, 'notice') : null
  const exp = shortDate(e.expiresAtEstimate)
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent className="h-dvh" style={{ ['--drawer-content-width' as string]: 'min(100vw, 48rem)' }} data-entity-drawer={e.key}>
        <DrawerHeader className="border-b px-4 pt-4 pb-3 text-left sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.16em] text-primary uppercase">Arkiv entity · {e.type}</p>
              <DrawerTitle className="mt-0.5 text-lg font-semibold tracking-tight">{TYPE_TITLE[e.type] ?? 'Entity'} {shortKey(e.key)}</DrawerTitle>
            </div>
            <Button variant="ghost" size="icon" className="size-10 shrink-0 rounded-full" onClick={() => onOpenChange(false)} aria-label="Close">
              <X className="size-5" />
            </Button>
          </div>
          <DrawerDescription className="sr-only">Typed attributes, payload, flags and creator of this Arkiv entity.</DrawerDescription>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-muted/60 px-2.5 py-2 font-mono text-[11px] break-all" data-entity-key>{e.key}</code>
            <CopyButton value={e.key} what="Entity key" />
            <ExplorerLink href={explorerEntity(e.key)} label="Open entity in the Arkiv explorer" />
          </div>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="flex flex-wrap gap-1.5" data-entity-flags>
            {official ? (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 text-xs font-semibold text-primary" data-creator-check="official">
                <BadgeCheck className="size-3.5" aria-hidden="true" /> Official Nazar publisher
              </span>
            ) : (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-caution-border bg-caution-soft px-2.5 text-xs font-semibold text-caution" data-creator-check="other">
                <ShieldAlert className="size-3.5" aria-hidden="true" /> Not from a listed publisher
              </span>
            )}
            {e.flags?.readonly && (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold" title="Nobody, Nazar included, can edit this entity">
                <Lock className="size-3.5" aria-hidden="true" /> Read-only
              </span>
            )}
            {e.flags?.permissionlessExtension && (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold" title="Any wallet can extend its lifetime while the batch may still be on shelves">
                <Users className="size-3.5" aria-hidden="true" /> Anyone can keep alive
              </span>
            )}
            {e.flags && !e.flags.readonly && !e.flags.permissionlessExtension && (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold text-muted-foreground">Owner-managed lifetime</span>
            )}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
            <div className="rounded-xl border p-2.5">
              <dt className="text-[11px] font-semibold text-muted-foreground">Created at block</dt>
              <dd className="mt-0.5 font-mono font-semibold">{blk(e.createdAtBlock)}</dd>
            </div>
            <div className="rounded-xl border p-2.5">
              <dt className="text-[11px] font-semibold text-muted-foreground">Expires at block</dt>
              <dd className="mt-0.5 font-mono font-semibold">{blk(e.expiresAtBlock)}</dd>
            </div>
            <div className="rounded-xl border p-2.5">
              <dt className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground"><Hourglass className="size-3" aria-hidden="true" /> Expiry estimate</dt>
              <dd className="mt-0.5 font-semibold">{exp ?? '—'}</dd>
            </div>
            <div className="min-w-0 rounded-xl border p-2.5">
              <dt className="text-[11px] font-semibold text-muted-foreground">Creator</dt>
              <dd className="mt-0.5 truncate font-mono font-semibold">
                {e.creator ? (
                  <a href={explorerAddress(e.creator)} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline" title={e.creator}>
                    {shortKey(e.creator)}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          {(e.type === 'notice' || noticeKey) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {e.type === 'notice' && (
                <Button className="h-11 px-4" onClick={() => onNoticeAlerts(e.key)} data-notice-alerts>
                  <ListFilter /> Show this notice&apos;s alerts
                </Button>
              )}
              {noticeKey && (
                <>
                  <Button variant="outline" className="h-11 px-4" onClick={() => onNoticeAlerts(String(noticeKey))}>
                    <ListFilter /> Other alerts from the same notice
                  </Button>
                  <a href={explorerEntity(String(noticeKey))} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 px-4')}>
                    Parent notice <ExternalLink data-icon="inline-end" />
                  </a>
                </>
              )}
            </div>
          )}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <section aria-labelledby="attrs-title" className="min-w-0" data-entity-attributes>
              <h3 id="attrs-title" className="text-sm font-semibold">Attributes <span className="font-normal text-muted-foreground">· queryable</span></h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Typed, indexed values. Filters run on these.</p>
              <div className="mt-2 overflow-hidden rounded-xl border">
                <table className="w-full table-fixed text-left text-[12px]">
                  <caption className="sr-only">Typed attributes</caption>
                  <thead className="bg-muted/60 text-[11px] text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-[34%] px-2.5 py-2 font-semibold">Name</th>
                      <th scope="col" className="w-[16%] px-2 py-2 font-semibold">Type</th>
                      <th scope="col" className="px-2.5 py-2 font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {e.attributes.map((a) => (
                      <tr key={a.name} className="align-top">
                        <th scope="row" className="truncate px-2.5 py-1.5 font-mono font-semibold" title={a.name}>{a.name}</th>
                        <td className="px-2 py-1.5">
                          <Chip tone={a.type === 'key' ? 'primary' : a.type === 'str' ? 'muted' : 'caution'} className="h-5 px-1.5 text-[10px]">{a.type}</Chip>
                        </td>
                        <td className="px-2.5 py-1.5 font-mono break-all">{valueText(a)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section aria-labelledby="payload-title" className="min-w-0" data-entity-payload>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 id="payload-title" className="text-sm font-semibold">Payload <span className="font-normal text-muted-foreground">· display only</span></h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">JSON stored with the entity. Not queryable.</p>
                </div>
                <Button variant="ghost" className="h-9 px-2.5 text-xs" onClick={() => copy(json, 'Payload')} aria-label="Copy payload JSON">
                  <Copy /> Copy
                </Button>
              </div>
              <pre tabIndex={0} aria-label="Payload JSON" className="mt-2 max-h-[60vh] overflow-auto rounded-xl border bg-muted/40 p-3 font-mono text-[11.5px] leading-5 whitespace-pre-wrap break-words">
                {json}
              </pre>
            </section>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
