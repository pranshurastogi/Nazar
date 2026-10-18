'use client'

import { useState } from 'react'
import { CircleCheck, FlaskConical, LifeBuoy, MapPin } from 'lucide-react'

import { cn } from '@/lib/utils'
import { CLIENTS, TEST_CURL, TEST_INSPECTOR, TROUBLESHOOTING } from './data'
import { AiSection, CodeBlock } from './shared'

// Set it up: one tab per client, each with where it goes, what to paste and how to see it worked.
// Then a one-line test from a terminal, and the few things that trip people up.

export function Setup() {
  const [tab, setTab] = useState(CLIENTS[0].id)
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = CLIENTS.length
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (to < 0) return
    e.preventDefault()
    setTab(CLIENTS[to].id)
    document.getElementById(`mcp-tab-${CLIENTS[to].id}`)?.focus()
  }

  return (
    <AiSection id="setup" kicker="Set it up" title="Add Nazar to your assistant in under a minute." intro="Pick your client. Every option points at the same public endpoint; there is nothing to install and no key to paste.">
      <div className="overflow-hidden rounded-3xl border bg-card">
        <div role="tablist" aria-label="Choose your assistant" className="flex flex-wrap gap-1 border-b bg-muted/30 p-1.5" data-mcp-tabs>
          {CLIENTS.map((c, i) => (
            <button
              key={c.id}
              id={`mcp-tab-${c.id}`}
              type="button"
              role="tab"
              aria-selected={tab === c.id}
              aria-controls={`mcp-panel-${c.id}`}
              tabIndex={tab === c.id ? 0 : -1}
              onClick={() => setTab(c.id)}
              onKeyDown={(e) => onKey(e, i)}
              data-mcp-tab={c.id}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                tab === c.id && 'bg-card text-foreground shadow-sm ring-1 ring-border hover:bg-card',
                c.id === 'mcp-json' && 'font-mono text-[13px]',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {CLIENTS.map((c) => (
          <div key={c.id} id={`mcp-panel-${c.id}`} role="tabpanel" aria-labelledby={`mcp-tab-${c.id}`} hidden={tab !== c.id} className="grid min-w-0 gap-4 p-4 sm:p-6" data-mcp-panel={c.id}>
            <p className="flex items-start gap-2 text-[14px] leading-6">
              <MapPin className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
              {c.where}
            </p>
            {c.snippets?.map((s) => <CodeBlock key={s.label} s={s} />)}
            {c.steps && (
              <div className="grid gap-3 sm:grid-cols-2">
                {c.steps.map((g) => (
                  <div key={g.app} className="rounded-2xl border bg-background/60 p-4">
                    <p className="text-sm font-semibold">{g.app}</p>
                    <ol className="mt-2.5 grid gap-2 text-[13px] leading-5 text-muted-foreground">
                      {g.steps.map((step, i) => (
                        <li key={step} className="flex gap-2.5">
                          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10.5px] font-semibold text-foreground" aria-hidden="true">
                            {i + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}
            <p className="flex items-start gap-2 text-[13px] leading-5 text-muted-foreground">
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {c.then}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-10">
        <div className="min-w-0" data-mcp-test>
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <FlaskConical className="size-4 text-muted-foreground" aria-hidden="true" /> Test it from a terminal
          </h3>
          <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
            Ask for SR-13 directly. The reply should start with <code className="font-mono text-[12px] text-foreground">FLAGGED: batch SR-13</code>.
          </p>
          <div className="mt-3 grid gap-3">
            <CodeBlock s={{ title: 'curl', code: TEST_CURL, label: 'curl test command' }} />
            <CodeBlock s={{ title: 'Or list the tools: MCP Inspector', code: TEST_INSPECTOR, label: 'MCP Inspector command' }} />
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <LifeBuoy className="size-4 text-muted-foreground" aria-hidden="true" /> If something looks off
          </h3>
          <dl className="mt-3 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2" data-mcp-troubleshooting>
            {TROUBLESHOOTING.map((x) => (
              <div key={x.q} className="bg-card px-4 py-3.5">
                <dt className="text-[13.5px] font-semibold">{x.q}</dt>
                <dd className="mt-1 text-[13px] leading-5 text-muted-foreground">{x.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </AiSection>
  )
}
