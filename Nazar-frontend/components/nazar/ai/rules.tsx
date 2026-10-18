'use client'

import { ChevronDown, Equal, Quote, ScanSearch, ShieldX } from 'lucide-react'

import { useT, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { INSTRUCTIONS } from './data'
import { AiSection } from './shared'

// The trust panel: the four rules the server hands every assistant (its MCP `instructions`), in
// plain words, with the full text one click away.

const ANSWERS = [
  { state: 'flagged', tone: 'border-flagged-border bg-flagged-soft text-flagged' },
  { state: 'retracted', tone: 'border-caution-border bg-caution-soft text-caution' },
  { state: 'no_alert', tone: 'border-quiet-border bg-quiet-soft text-quiet' },
  { state: 'unreadable', tone: 'border-caution-border bg-caution-soft text-caution' },
] as const

const RULES: { Icon: typeof Equal; n: 1 | 2 | 3 | 4; answers?: true }[] = [
  { Icon: Equal, n: 1, answers: true },
  { Icon: ShieldX, n: 2 },
  { Icon: ScanSearch, n: 3 },
  { Icon: Quote, n: 4 },
]

export function Rules() {
  const { t, tr } = useT()
  return (
    <AiSection id="rules" kicker={t('ai.rules.kicker')} title={t('ai.rules.title')} intro={t('ai.rules.intro')}>
      <div className="overflow-hidden rounded-3xl border bg-card" data-trust-panel>
        <ol className="grid sm:grid-cols-2" aria-label={t('ai.rules.aria')}>
          {RULES.map((r, i) => (
            <li key={r.n} className={cn('flex gap-4 p-5 sm:p-6', i > 0 && 'border-t', i === 1 && 'sm:border-t-0', i % 2 === 1 && 'sm:border-l')} data-trust-rule>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <r.Icon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold tracking-tight">
                  <span className="mr-1.5 font-mono text-xs text-primary">{i + 1}</span>
                  {t(`ai.rule${r.n}.title` as MessageKey)}
                </h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.6] text-muted-foreground">{t(`ai.rule${r.n}.body` as MessageKey)}</p>
                {r.answers && (
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t('ai.rules.answersAria')}>
                    {ANSWERS.map((a) => (
                      <li key={a.state} className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', a.tone)}>
                        {t(`state.${a.state}`).replace("'", '’')}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t bg-muted/30 px-5 py-4 sm:px-6">
          <p className="text-[13px] leading-5 text-muted-foreground">
            {tr('ai.rules.also', { also: <span className="font-medium text-foreground">{t('ai.rules.alsoLabel')}</span>, code: <code className="font-mono text-[12px]">arkiv_proof</code> })}
          </p>
          <details className="group mt-2">
            <summary className="-mx-1 inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              {t('ai.rules.readExact')} <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded-2xl border bg-card p-4 font-mono text-[11.5px] leading-[1.65] break-words whitespace-pre-wrap" tabIndex={0} aria-label={t('ai.rules.instructionsAria')} data-instructions>
              {INSTRUCTIONS}
            </pre>
          </details>
        </div>
      </div>
    </AiSection>
  )
}
