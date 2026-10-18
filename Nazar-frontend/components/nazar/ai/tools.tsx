import { FileText, MessageSquareQuote } from 'lucide-react'

import { cn } from '@/lib/utils'
import { callLine, FETCHED_ON, PROMPT, RESOURCES, TOOL_SAMPLES, TOOLS } from './data'
import { AiSection } from './shared'

// The six tools as reference cards: the question each one answers, its inputs, and the start of
// a real response from the live server. Then the two resources and the prompt.

export function Tools() {
  return (
    <AiSection
      id="tools"
      kicker="Tools"
      title="Six tools, each answering one question."
      intro={`All six only read. The example under each card is the start of a real response from the live server, recorded ${FETCHED_ON}.`}
    >
      <ul className="grid gap-4 md:grid-cols-2" aria-label="Nazar MCP tools">
        {TOOLS.map((t) => (
          <li key={t.name} className="flex min-w-0 flex-col rounded-2xl border bg-card" data-mcp-tool={t.name}>
            <div className="p-4 pb-3 sm:p-5 sm:pb-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="font-mono text-[14px] font-semibold">{t.name}</h3>
                <p className="text-xs text-muted-foreground">{t.title}</p>
              </div>
              <p className="mt-2.5 text-[15px] leading-6 font-medium tracking-tight" data-tool-answers>
                &ldquo;{t.answers}&rdquo;
              </p>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{t.body}</p>
              <div className="mt-3">
                <p className="sr-only">Inputs</p>
                {t.inputs.length ? (
                  <ul className="flex flex-wrap gap-1.5" aria-label={`${t.name} inputs`}>
                    {t.inputs.map((i) => (
                      <li key={i.name} className="inline-flex max-w-full items-baseline gap-1.5 rounded-lg border bg-background/60 px-2 py-1 text-[11.5px]" title={i.note}>
                        <code className={cn('font-mono font-semibold', i.required && 'text-primary')}>
                          {i.name}
                          {i.required ? '' : '?'}
                        </code>
                        <span className="truncate text-muted-foreground">{i.type}</span>
                        <span className="sr-only">
                          , {i.required ? 'required' : 'optional'}: {i.note}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11.5px] text-muted-foreground">No inputs.</p>
                )}
              </div>
            </div>
            <div className="mt-auto min-w-0 border-t bg-muted/30 px-4 py-3 sm:px-5">
              <p className="truncate font-mono text-[11.5px] text-muted-foreground">
                <span aria-hidden="true">› </span>
                {callLine(t.name)}
              </p>
              <pre className="mt-1.5 line-clamp-4 font-mono text-[11.5px] leading-[1.55] break-words whitespace-pre-wrap text-foreground/85" data-tool-sample>
                {TOOL_SAMPLES[t.name].text.join('\n')}
              </pre>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {RESOURCES.map((r) => (
          <div key={r.uri} className="rounded-2xl border bg-card p-4" data-mcp-resource={r.uri}>
            <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <FileText className="size-3.5" aria-hidden="true" /> Resource
            </p>
            <p className="mt-2 font-mono text-[13px] font-semibold">{r.uri}</p>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">{r.title}.</span> {r.body}
            </p>
          </div>
        ))}
        <div className="rounded-2xl border border-primary/30 bg-primary/[0.04] p-4" data-mcp-prompt>
          <p className="flex items-center gap-2 text-xs font-semibold text-primary">
            <MessageSquareQuote className="size-3.5" aria-hidden="true" /> Prompt
          </p>
          <p className="mt-2 font-mono text-[13px] font-semibold">{PROMPT.name}</p>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">{PROMPT.title}.</span> {PROMPT.body} Takes <code className="font-mono text-[12px]">{PROMPT.arg}</code>.
          </p>
        </div>
      </div>
    </AiSection>
  )
}
