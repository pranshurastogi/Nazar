'use client'

import { useState } from 'react'
import { Bot, Copy, MessageSquareText, Plug, ShieldCheck, Terminal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { copy } from '@/components/nazar/result-card'
import { cn } from '@/lib/utils'
import { IconButton, Section } from './shared'

export const MCP_URL = 'https://nazar-api-production.up.railway.app/mcp'

const MCP_TOOLS = [
  { name: 'check_batch', body: "Check one batch number: flagged, retracted, no alert found, or can't tell." },
  { name: 'search_alerts', body: 'Search alerts by brand, product, manufacturer or failure reason.' },
  { name: 'recent_alerts', body: 'Latest alerts, filtered by severity, Child Shield, state or regulator.' },
  { name: 'get_case', body: 'Batch Passport: every notice that names the same batch.' },
  { name: 'list_sources', body: 'The regulators Nazar reads and when each was last checked.' },
  { name: 'arkiv_proof', body: 'Reads an alert straight from Arkiv, so the answer can be verified without trusting Nazar.' },
]

const MCP_EXAMPLE = 'Is batch SR-13 of Coldrif flagged?'

type McpSnippet = { title: string; file?: string; code: string; label: string; wrap?: boolean }
type McpClient = { id: string; label: string; snippets?: McpSnippet[]; steps?: { app: string; steps: string[] }[] }

const json = (o: unknown) => JSON.stringify(o, null, 2)

const MCP_CLIENTS: McpClient[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    snippets: [
      { title: 'Terminal', code: `claude mcp add --transport http nazar ${MCP_URL}`, label: 'Claude Code command', wrap: true },
      { title: 'Or a project file', file: '.mcp.json', code: json({ mcpServers: { nazar: { type: 'http', url: MCP_URL } } }), label: '.mcp.json config' },
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    snippets: [{ title: 'Cursor', file: '~/.cursor/mcp.json', code: json({ mcpServers: { nazar: { url: MCP_URL } } }), label: 'Cursor config' }],
  },
  {
    id: 'vscode',
    label: 'VS Code',
    snippets: [{ title: 'VS Code', file: '.vscode/mcp.json', code: json({ servers: { nazar: { type: 'http', url: MCP_URL } } }), label: 'VS Code config' }],
  },
  {
    id: 'apps',
    label: 'Claude & ChatGPT',
    steps: [
      { app: 'Claude Desktop and claude.ai', steps: ['Settings → Connectors', 'Add custom connector', 'Paste the endpoint URL'] },
      { app: 'ChatGPT', steps: ['Settings → Apps & Connectors → Advanced', 'Turn on Developer mode', 'Create connector', 'Paste the URL, with no authentication'] },
    ],
  },
]

function CodeBlock({ s }: { s: McpSnippet }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card" data-mcp-snippet>
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-1.5">
        <p className="min-w-0 text-xs font-semibold text-muted-foreground">
          {s.title}
          {s.file && <code className="ml-1.5 font-mono font-medium text-foreground">{s.file}</code>}
        </p>
        <Button variant="ghost" className="h-11 shrink-0 px-3 text-xs" onClick={() => copy(s.code, s.label)} aria-label={`Copy ${s.label}`} data-mcp-copy>
          <Copy /> Copy
        </Button>
      </div>
      <pre
        className={cn('overflow-x-auto p-4 font-mono text-[12px] leading-5', s.wrap && 'break-all whitespace-pre-wrap')}
        tabIndex={0}
        aria-label={s.file ? `${s.title} ${s.file}` : s.label}
      >
        <code>{s.code}</code>
      </pre>
    </div>
  )
}

export function Mcp() {
  const [tab, setTab] = useState(MCP_CLIENTS[0].id)
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = MCP_CLIENTS[(i + d + MCP_CLIENTS.length) % MCP_CLIENTS.length]
    setTab(next.id)
    document.getElementById(`mcp-tab-${next.id}`)?.focus()
  }

  return (
    <Section
      id="mcp"
      kicker="AI assistants"
      title="Use Nazar in your AI assistant"
      intro="Claude, ChatGPT, Cursor and other assistants that speak MCP (Model Context Protocol) can check batch numbers against official regulator alerts through Nazar, with the same four answers and proof links. Free, read-only, no account."
    >
      <div className="rounded-2xl border bg-card p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Plug className="size-3.5" aria-hidden="true" /> MCP endpoint · Streamable HTTP
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 font-mono text-[13px] font-medium break-all" data-mcp-endpoint>{MCP_URL}</code>
          <IconButton label="Copy MCP endpoint" onClick={() => copy(MCP_URL, 'MCP endpoint')} />
        </div>
      </div>

      <h4 className="mt-10 flex items-center gap-2 text-base font-semibold tracking-tight" id="mcp-setup">
        <Terminal className="size-4 text-muted-foreground" aria-hidden="true" /> Add it to your assistant
      </h4>
      <div role="tablist" aria-labelledby="mcp-setup" className="mt-3 flex flex-wrap gap-2">
        {MCP_CLIENTS.map((c, i) => (
          <button
            key={c.id}
            id={`mcp-tab-${c.id}`}
            role="tab"
            aria-selected={tab === c.id}
            aria-controls={`mcp-panel-${c.id}`}
            tabIndex={tab === c.id ? 0 : -1}
            onClick={() => setTab(c.id)}
            onKeyDown={(e) => onKey(e, i)}
            data-mcp-tab={c.id}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full border bg-card px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              tab === c.id && 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {MCP_CLIENTS.map((c) => (
        <div
          key={c.id}
          id={`mcp-panel-${c.id}`}
          role="tabpanel"
          aria-labelledby={`mcp-tab-${c.id}`}
          hidden={tab !== c.id}
          className="mt-3 grid min-w-0 gap-3"
          data-mcp-panel={c.id}
        >
          {c.snippets?.map((s) => <CodeBlock key={s.label} s={s} />)}
          {c.steps && (
            <div className="grid gap-3 sm:grid-cols-2">
              {c.steps.map((g) => (
                <div key={g.app} className="rounded-2xl border bg-card p-4">
                  <p className="text-sm font-semibold">{g.app}</p>
                  <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-[13px] leading-5 text-muted-foreground">
                    {g.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <h4 className="mt-10 flex items-center gap-2 text-base font-semibold tracking-tight">
        <Bot className="size-4 text-muted-foreground" aria-hidden="true" /> What the assistant can do
      </h4>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Nazar MCP tools">
        {MCP_TOOLS.map((t) => (
          <li key={t.name} className="rounded-2xl border bg-card px-3.5 py-3" data-mcp-tool={t.name}>
            <code className="font-mono text-[13px] font-semibold">{t.name}</code>
            <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{t.body}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center gap-3 rounded-2xl border bg-card p-3 pl-4">
        <MessageSquareText className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground">Try asking</p>
          <p className="mt-0.5 text-sm font-medium" data-mcp-example>&ldquo;{MCP_EXAMPLE}&rdquo;</p>
        </div>
        <IconButton label="Copy example question" onClick={() => copy(MCP_EXAMPLE, 'Question')} />
      </div>

      <p className="mt-6 flex max-w-[65ch] items-start gap-2.5 rounded-2xl border bg-muted/40 px-4 py-3 text-[13px] leading-5 text-muted-foreground" data-mcp-honesty>
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
          The assistant gets the same rules as the app: it must cite the regulator notice and the Arkiv entity, and &ldquo;No alert found&rdquo; is not a safety certificate.
          General medicine information is not part of the MCP server.
        </span>
      </p>
    </Section>
  )
}
