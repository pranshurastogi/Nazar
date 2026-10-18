'use client'

import { ArrowDown, Copy, Lock, Plug, Quote, UserRoundX } from 'lucide-react'

import { copy } from '@/components/nazar/result-card'
import { serif } from '@/lib/fonts'
import { useT, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { MCP_URL } from './data'

// The top of /ai: one headline, one plain promise, the endpoint ready to copy, and the way in.

const CLIENT_NAMES = ['Claude', 'ChatGPT', 'Cursor', 'VS Code', 'Claude Code']

const FACTS: { Icon: typeof Lock; title: MessageKey; body: MessageKey }[] = [
  { Icon: Lock, title: 'ai.fact.readonly', body: 'ai.fact.readonlyBody' },
  { Icon: UserRoundX, title: 'ai.fact.account', body: 'ai.fact.accountBody' },
  { Icon: Quote, title: 'ai.fact.cites', body: 'ai.fact.citesBody' },
]

export function AiHero() {
  const { t } = useT()
  return (
    <section
      className="relative overflow-hidden rounded-3xl border bg-card"
      style={{ backgroundImage: 'radial-gradient(110% 80% at 85% 0%, color-mix(in srgb, var(--primary) 10%, transparent), transparent 62%)' }}
      aria-labelledby="ai-hero-title"
      data-ai-hero
    >
      <div className="px-5 pt-7 pb-8 sm:px-8 sm:pt-10 sm:pb-10 lg:px-10">
        <p className="flex items-center gap-3 text-xs tracking-[0.12em] text-muted-foreground uppercase">
          <span className="h-px w-7 bg-current opacity-70" aria-hidden="true" /> {t('ai.kicker')}
        </p>
        <h1 id="ai-hero-title" className="mt-4 max-w-[19ch] text-[clamp(2.25rem,7vw,3.6rem)] leading-[0.98] font-medium tracking-[-0.045em] text-balance">
          {t('ai.heroLead')}<span className={cn(serif.className, 'font-normal tracking-[-0.02em] text-primary')}>{t('ai.heroAccent')}</span>
        </h1>

        <div className="mt-6 grid gap-8 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-10">
          <div className="min-w-0">
            <p className="max-w-[54ch] text-base leading-7 text-pretty text-muted-foreground" data-ai-lede>
              {t('ai.lede')}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a href="#setup" className="inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-transform hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none" data-ai-setup-cta>
                {t('ai.setupCta')} <ArrowDown className="size-4" aria-hidden="true" />
              </a>
              <a href="#tools" className="inline-flex min-h-11 items-center gap-1.5 border-b border-foreground/30 text-sm font-medium hover:border-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                {t('ai.seeTools')}
              </a>
            </div>
          </div>

          <div className="min-w-0">
            <div className="rounded-2xl border bg-background/70 p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Plug className="size-3.5" aria-hidden="true" /> {t('ai.endpoint')}
                </p>
                <button
                  type="button"
                  onClick={() => copy(MCP_URL, t('ai.endpointWhat'))}
                  aria-label={t('copy.aria', { what: t('ai.endpointWhat') })}
                  title={t('copy.aria', { what: t('ai.endpointWhat') })}
                  className="-my-1.5 -mr-1.5 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <Copy className="size-3.5" aria-hidden="true" /> {t('ai.copy')}
                </button>
              </div>
              <code className="mt-2 block font-mono text-[12.5px] leading-5 font-medium break-all lg:break-normal" data-mcp-endpoint>
                {MCP_URL}
              </code>
            </div>
            <p id="ai-works-with" className="mt-4 text-xs text-muted-foreground">
              {t('ai.worksWith')}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-labelledby="ai-works-with">
              {[...CLIENT_NAMES, t('ai.anyClient')].map((n) => (
                <li key={n} className="rounded-full border bg-card px-2.5 py-1 text-xs font-medium">
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <ul className="grid border-t bg-card/70 sm:grid-cols-3" aria-label={t('ai.atAGlance')}>
        {FACTS.map(({ Icon, title, body }) => (
          <li key={title} className="flex items-center gap-3 border-b px-5 py-3.5 last:border-b-0 sm:border-r sm:border-b-0 sm:p-5 sm:last:border-r-0">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold tracking-tight">{t(title)}</p>
              <p className="text-xs leading-5 text-muted-foreground">{t(body)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
