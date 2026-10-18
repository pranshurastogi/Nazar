'use client'

import Link from 'next/link'
import { ArrowRight, Bot } from 'lucide-react'

import { copy } from '@/components/nazar/result-card'
import { MCP_URL } from '@/components/nazar/ai/data'
import { IconButton, Section } from './shared'

export { MCP_URL }

// The AI assistant section of /more is a short teaser now: the full guide (live chat demo, setup
// for each client, tools and rules) lives on /ai. The id="mcp" anchor stays, so old /more#mcp
// links still land here and point on.

export function Mcp() {
  return (
    <Section id="mcp" kicker="AI assistants" title="Use Nazar in your AI assistant">
      <div className="flex flex-col gap-4 rounded-3xl border bg-card p-5 sm:flex-row sm:gap-5 sm:p-6" data-mcp-teaser>
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Bot className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="max-w-[62ch] text-[15px] leading-7 text-pretty text-muted-foreground">
            Claude, ChatGPT, Cursor, VS Code and other MCP clients can check batch numbers through Nazar, with the same four answers, the regulator&rsquo;s notice and the Arkiv proof. Free, read-only,
            no account.
          </p>
          <div className="mt-3 flex max-w-xl items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-[12px] leading-5 font-medium break-all" data-mcp-endpoint>
              {MCP_URL}
            </code>
            <IconButton label="Copy MCP endpoint" onClick={() => copy(MCP_URL, 'MCP endpoint')} />
          </div>
          <Link
            href="/ai"
            className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-transform hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
            data-mcp-teaser-link
          >
            See it answer and set it up <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </Section>
  )
}
