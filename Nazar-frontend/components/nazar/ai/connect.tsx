'use client'

import { Fragment } from 'react'
import { BadgeCheck, Bot, Database, Plug } from 'lucide-react'

import { useT, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { AiSection } from './shared'

// How a question travels: your assistant → Nazar's MCP server → the API and its ledger → the
// alert's Arkiv entity. A row of four on wide screens, a column on phones, with a packet running
// along each link. arkiv_proof skips Nazar's database and reads Arkiv directly; the bracket under
// the last three nodes says so.

// Chips that are protocol (tools/call, POST /mcp) stay as written; the plain-words ones are translated.
const NODES: { Icon: typeof Bot; title: MessageKey; body: MessageKey; chip: string | { key: MessageKey } }[] = [
  { Icon: Bot, title: 'ai.node.assistant', body: 'ai.node.assistantBody', chip: 'tools/call' },
  { Icon: Plug, title: 'ai.node.mcp', body: 'ai.node.mcpBody', chip: 'POST /mcp · JSON-RPC' },
  { Icon: Database, title: 'ai.node.api', body: 'ai.node.apiBody', chip: { key: 'ai.node.apiChip' } },
  { Icon: BadgeCheck, title: 'ai.node.arkiv', body: 'ai.node.arkivBody', chip: { key: 'ai.node.arkivChip' } },
]

function Link({ axis, delay }: { axis: 'x' | 'y'; delay: number }) {
  return (
    <div
      className={cn('ai-link flex items-center justify-center', axis === 'x' ? 'hidden h-full w-10 lg:flex' : 'mx-auto h-8 w-6 lg:hidden')}
      data-axis={axis}
      aria-hidden="true"
    >
      <span className={cn('border-dashed border-primary/45', axis === 'x' ? 'w-full border-t-2' : 'h-full border-l-2')} />
      <span className="ai-link-dot" style={{ animationDelay: `${delay}s` }} />
    </div>
  )
}

export function Connect() {
  const { t } = useT()
  return (
    <AiSection id="connect" kicker={t('ai.connect.kicker')} title={t('ai.connect.title')} intro={t('ai.connect.intro')}>
      <ol className="grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]" aria-label={t('ai.connect.aria')} data-connect>
        {NODES.map((n, i) => (
          <Fragment key={n.title}>
            {i > 0 && (
              <li className="contents" aria-hidden="true">
                <Link axis="x" delay={(i - 1) * 0.8} />
                <Link axis="y" delay={(i - 1) * 0.8} />
              </li>
            )}
            <li className={cn('relative min-w-0 rounded-2xl border bg-card p-4', i === NODES.length - 1 && 'border-primary/35 bg-primary/[0.04]')} data-connect-node>
              <div className="flex items-center gap-2.5">
                <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', i === NODES.length - 1 ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
                  <n.Icon className="size-4" aria-hidden="true" />
                </span>
                <p className="text-sm leading-tight font-semibold">{t(n.title)}</p>
              </div>
              <p className="mt-2.5 text-[13px] leading-5 text-muted-foreground">{t(n.body)}</p>
              <p className="mt-3 inline-block max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{typeof n.chip === 'string' ? n.chip : t(n.chip.key)}</p>
            </li>
          </Fragment>
        ))}
      </ol>

      {/* arkiv_proof's shortcut: from the MCP server straight to Arkiv, past Nazar's own database. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="mt-4 rounded-2xl border border-dashed border-primary/40 bg-primary/[0.03] px-4 py-3 lg:col-span-5 lg:col-start-3 lg:mt-0 lg:rounded-t-none lg:border-t-0 lg:px-5 lg:pt-5 lg:pb-3.5" data-connect-bypass>
          <p className="text-[13px] leading-5">
            <code className="font-mono text-[12px] font-semibold">arkiv_proof</code>{' '}
            <span className="text-muted-foreground">{t('ai.bypass')}</span>
          </p>
        </div>
      </div>
    </AiSection>
  )
}
