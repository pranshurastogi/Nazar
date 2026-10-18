import { Fragment } from 'react'
import { BadgeCheck, Bot, Database, Plug } from 'lucide-react'

import { cn } from '@/lib/utils'
import { AiSection } from './shared'

// How a question travels: your assistant → Nazar's MCP server → the API and its ledger → the
// alert's Arkiv entity. A row of four on wide screens, a column on phones, with a packet running
// along each link. arkiv_proof skips Nazar's database and reads Arkiv directly; the bracket under
// the last three nodes says so.

const NODES = [
  { Icon: Bot, title: 'Your assistant', body: 'Claude, ChatGPT, Cursor, VS Code or any MCP client.', chip: 'tools/call' },
  { Icon: Plug, title: 'Nazar MCP', body: 'Stateless HTTP, read-only. Adds the honesty rules.', chip: 'POST /mcp · JSON-RPC' },
  { Icon: Database, title: 'Nazar API + ledger', body: 'Regulator alerts, the four states, the look-alike check.', chip: 'same code as the app' },
  { Icon: BadgeCheck, title: 'Arkiv entity', body: 'The public record, signed by one publisher wallet.', chip: 'verifiable by anyone' },
] as const

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
  return (
    <AiSection
      id="connect"
      kicker="How it connects"
      title="One question, four hops, and a proof at the end."
      intro="Your assistant never scrapes a website or guesses. It calls a Nazar tool, gets the same answer the app would give, and can show you the record on Arkiv."
    >
      <ol className="grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]" aria-label="How a question reaches Nazar" data-connect>
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
                <p className="text-sm leading-tight font-semibold">{n.title}</p>
              </div>
              <p className="mt-2.5 text-[13px] leading-5 text-muted-foreground">{n.body}</p>
              <p className="mt-3 inline-block max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{n.chip}</p>
            </li>
          </Fragment>
        ))}
      </ol>

      {/* arkiv_proof's shortcut: from the MCP server straight to Arkiv, past Nazar's own database. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="mt-4 rounded-2xl border border-dashed border-primary/40 bg-primary/[0.03] px-4 py-3 lg:col-span-5 lg:col-start-3 lg:mt-0 lg:rounded-t-none lg:border-t-0 lg:px-5 lg:pt-5 lg:pb-3.5" data-connect-bypass>
          <p className="text-[13px] leading-5">
            <code className="font-mono text-[12px] font-semibold">arkiv_proof</code>{' '}
            <span className="text-muted-foreground">skips Nazar&rsquo;s database and reads the entity straight from the Arkiv chain, so your assistant can show the alert is genuine without trusting Nazar.</span>
          </p>
        </div>
      </div>
    </AiSection>
  )
}
