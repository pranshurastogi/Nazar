'use client'

import { useEffect, useState } from 'react'
import { BadgeCheck, Boxes, ExternalLink, FileText, Fingerprint, Infinity as KeepAlive, Link2, Lock, ShieldAlert, Unlink, LoaderCircle } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { estimateExpiry, EXPLORER_URL, explorerAddress, noticeKeyFor, PUBLISHER, type Alert } from '@/lib/source'
import { cn } from '@/lib/utils'
import { CopyButton, IconLink, shorten } from './shared'

// The chain of custody behind one alert: the regulator's document, its SHA-256, the
// Arkiv notice entity that records it, and this alert entity, plus who signed it and in
// which transaction. Every hash can be copied and opened in the Arkiv explorer.

const ENTITY_URL = (key: string) => `${EXPLORER_URL}/entity/${key}`

/** Alerts are created read-only with permissionless extension (arkiv/schema.md); used when the answer did not carry flags. */
const SCHEMA_FLAGS = { readonly: true, permissionlessExtension: true }

type NodeSpec = {
  key: string
  icon: typeof FileText
  label: string
  value: React.ReactNode
  actions?: React.ReactNode
  missing?: boolean
}

function ChainNode({ node, last, row, sheet }: { node: NodeSpec; last: boolean; row: boolean; sheet: boolean }) {
  return (
    <li
      data-chain-node={node.key}
      className={cn('relative flex min-w-0 gap-3', row ? 'pb-4 last:pb-0 sm:flex-col sm:gap-2 sm:pb-0' : 'pb-4 last:pb-0')}
    >
      {!last && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-9 bottom-0 left-[17px] w-px bg-primary/25',
            row && 'sm:top-[17px] sm:right-[-0.75rem] sm:bottom-auto sm:left-10 sm:h-px sm:w-auto',
          )}
        />
      )}
      <span
        className={cn(
          'relative grid size-9 shrink-0 place-items-center rounded-full border-2 bg-card',
          node.missing ? 'border-dashed border-border text-muted-foreground' : 'border-primary/40 text-primary',
        )}
      >
        <node.icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-muted-foreground', sheet ? 'text-sm' : 'text-[11px] font-semibold tracking-wide uppercase')}>{node.label}</p>
        <div className="mt-0.5 min-w-0 text-[13px] font-medium">{node.value}</div>
        {node.actions && <div className="-ml-2 flex items-center">{node.actions}</div>}
      </div>
    </li>
  )
}

function Mono({ value }: { value: string }) {
  return (
    <span className="font-mono text-xs" title={value}>
      {shorten(value)}
    </span>
  )
}

function ExpiryLine({ block }: { block: string }) {
  const [date, setDate] = useState<Date | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    estimateExpiry(block, ctrl.signal).then((d) => !ctrl.signal.aborted && setDate(d))
    return () => ctrl.abort()
  }, [block])
  return (
    <span data-entity-expiry>
      Stays on Arkiv until {date ? `about ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'block'}{' '}
      <span className="font-mono">#{Number(block).toLocaleString('en-IN')}</span>
    </span>
  )
}

/**
 * The notice entity key: carried by alerts read from Arkiv, looked up by the notice's SHA-256
 * for alerts answered by the Nazar API (its alert DTO names the notice by SHA only).
 */
function useNoticeKey(alert: Alert) {
  const [found, setFound] = useState<{ sha: string; key: string | null } | null>(null)
  const sha = !alert.noticeKey && alert.entityKey ? alert.sourceSha : null
  useEffect(() => {
    if (!sha) return
    let live = true
    noticeKeyFor(sha).then((key) => live && setFound({ sha, key }), () => live && setFound({ sha, key: null }))
    return () => {
      live = false
    }
  }, [sha])
  if (alert.noticeKey) return { key: alert.noticeKey, looking: false }
  if (!sha) return { key: null, looking: false }
  return found?.sha === sha ? { key: found.key, looking: false } : { key: null, looking: true }
}

/**
 * `variant="card"` is the compact module inside a result card; `variant="sheet"` is the
 * full version in the "How do we know?" sheet, with the transaction as its own row.
 */
export function OnchainProof({ alert, variant = 'card' }: { alert: Alert; variant?: 'card' | 'sheet' }) {
  const sheet = variant === 'sheet'
  const published = !!alert.entityKey
  const official = !!alert.creator && alert.creator.toLowerCase() === PUBLISHER.toLowerCase()
  const flags = alert.flags ?? (published ? SCHEMA_FLAGS : null)
  const entityHref = alert.explorer.entity ?? (alert.entityKey ? ENTITY_URL(alert.entityKey) : null)
  const notice = useNoticeKey(alert)

  const nodes: NodeSpec[] = [
    {
      key: 'document',
      icon: FileText,
      label: 'Regulator document',
      value: (
        <>
          <span className="block truncate" title={alert.notice}>{alert.notice}</span>
          <span className="block text-xs font-normal text-muted-foreground">{alert.authority}</span>
        </>
      ),
      actions: alert.noticeUrl ? <IconLink href={alert.noticeUrl} label="Open the regulator document" /> : undefined,
    },
    {
      key: 'sha',
      icon: Fingerprint,
      label: sheet ? 'Source SHA-256' : 'SHA-256 fingerprint',
      value: alert.sourceSha ? <Mono value={alert.sourceSha} /> : <span className="text-muted-foreground">Not recorded</span>,
      actions: alert.sourceSha ? <CopyButton value={alert.sourceSha} what="source SHA-256" /> : undefined,
      missing: !alert.sourceSha,
    },
    {
      key: 'notice',
      icon: Boxes,
      label: 'Arkiv notice entity',
      value: notice.key ? (
        <span data-notice-key={notice.key}><Mono value={notice.key} /></span>
      ) : (
        <span className="text-muted-foreground">{!published ? 'Not on Arkiv' : notice.looking ? 'Looking up…' : 'Named in the alert entity'}</span>
      ),
      actions: notice.key ? (
        <>
          <CopyButton value={notice.key} what="notice entity key" />
          <IconLink href={ENTITY_URL(notice.key)} label="Open notice entity in the Arkiv explorer" />
        </>
      ) : undefined,
      missing: !notice.key,
    },
    {
      key: 'alert',
      icon: Link2,
      label: sheet ? 'Arkiv entity' : 'This alert entity',
      value: alert.entityKey ? (
        <Mono value={alert.entityKey} />
      ) : (
        <span className="text-muted-foreground">{alert.demo ? 'Not published (demo record)' : 'Not yet published'}</span>
      ),
      actions: alert.entityKey ? (
        <>
          <CopyButton value={alert.entityKey} what="entity key" />
          {entityHref && <IconLink href={entityHref} label="Open entity key in the Arkiv explorer" />}
        </>
      ) : undefined,
      missing: !alert.entityKey,
    },
  ]

  return (
    <div data-onchain-proof={published ? 'published' : 'unpublished'} className={cn(!sheet && 'border-t bg-card/70 px-5 py-4 sm:px-6')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">On-chain proof</p>
        {published ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" /> Live on Arkiv
          </span>
        ) : alert.fromSnapshot ? (
          <span data-proof-pending className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
            <LoaderCircle className="size-3 motion-safe:animate-spin" aria-hidden="true" /> Confirming on Arkiv…
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
            <Unlink className="size-3" aria-hidden="true" /> Not yet on Arkiv
          </span>
        )}
      </div>

      {(sheet || published) && (
        <ol className={cn('mt-3', !sheet && 'sm:grid sm:grid-cols-4 sm:gap-3')} aria-label="Chain of custody">
          {nodes.map((n, i) => (
            <ChainNode key={n.key} node={n} last={i === nodes.length - 1} row={!sheet} sheet={sheet} />
          ))}
        </ol>
      )}

      {published ? (
        <div className="mt-4 grid gap-3">
          {alert.creator && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <span className="text-muted-foreground">{sheet ? 'Creator wallet' : 'Signed by'}</span>
              <span className="font-mono text-xs" title={alert.creator}>{shorten(alert.creator)}</span>
              {official ? (
                <span data-publisher-check="official" className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                  <BadgeCheck className="size-3.5" aria-hidden="true" /> Official Nazar publisher
                </span>
              ) : (
                <span data-publisher-check="unlisted" className="inline-flex items-center gap-1 rounded-full bg-caution-soft px-2 py-0.5 text-[11px] font-bold text-caution">
                  <ShieldAlert className="size-3.5" aria-hidden="true" /> Not from a listed publisher
                </span>
              )}
              <span className="-my-1 ml-auto flex items-center">
                <CopyButton value={alert.creator} what="creator wallet" />
                <IconLink href={alert.explorer.creator ?? explorerAddress(alert.creator)} label="Open creator wallet in the Arkiv explorer" />
              </span>
            </div>
          )}
          {sheet && alert.txHash && (
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-muted-foreground">Transaction</span>
              <span className="ml-auto font-mono text-xs" title={alert.txHash}>{shorten(alert.txHash)}</span>
              <CopyButton value={alert.txHash} what="transaction hash" className="-my-1" />
              {alert.explorer.tx && <IconLink href={alert.explorer.tx} label="Open transaction hash in the Arkiv explorer" className="-my-1" />}
            </div>
          )}
          {(flags || alert.expiresAtBlock || alert.publishedAt) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {flags?.readonly && (
                <span className="inline-flex h-6 items-center gap-1 rounded-full border px-2 font-semibold text-foreground/80" data-flag="readonly">
                  <Lock className="size-3" aria-hidden="true" /> Read-only
                </span>
              )}
              {flags?.permissionlessExtension && (
                <span className="inline-flex h-6 items-center gap-1 rounded-full border px-2 font-semibold text-foreground/80" data-flag="extend" title="Any wallet can extend this alert's lifetime while the batch may still be on shelves">
                  <KeepAlive className="size-3" aria-hidden="true" /> Anyone can keep alive
                </span>
              )}
              {alert.publishedAt && !Number.isNaN(Date.parse(alert.publishedAt)) && (
                <span>Published {new Date(alert.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              )}
              {alert.expiresAtBlock && <ExpiryLine block={alert.expiresAtBlock} />}
            </div>
          )}
          {alert.explorer.tx ? (
            <a href={alert.explorer.tx} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 w-full px-3 text-primary sm:w-auto sm:justify-self-start')} data-tx-link>
              View transaction on Arkiv explorer <ExternalLink data-icon="inline-end" />
            </a>
          ) : (
            entityHref && (
              <a href={entityHref} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 w-full px-3 text-primary sm:w-auto sm:justify-self-start')} data-entity-link>
                View this alert on Arkiv explorer <ExternalLink data-icon="inline-end" />
              </a>
            )
          )}
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
          {alert.demo
            ? 'Built-in demo record, shown because the Nazar API and Arkiv could not answer. There is nothing on Arkiv to verify for it.'
            : alert.fromSnapshot
              ? 'Answered instantly from the copy of the alert list saved on this device. The entity key, signer and transaction load from Arkiv with the live check; if you are offline, the regulator document above is the source.'
              : 'Nazar has read this alert but has not published it on Arkiv yet. The regulator document above is the source.'}
        </p>
      )}
    </div>
  )
}
