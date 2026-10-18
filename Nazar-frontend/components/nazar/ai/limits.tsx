'use client'

import { Fingerprint, Gauge, Hash, Lock, MessageSquareOff, UserRoundX } from 'lucide-react'

import { useT, type MessageKey } from '@/lib/i18n'
import { AiSection } from './shared'

// What the MCP server can and cannot see, and how hard it can be used. Every line matches the
// server code (Nazar-backend/src/mcp/http.ts and server.ts).

const ITEMS: { Icon: typeof Lock; n: 1 | 2 | 3 | 4 | 5 | 6 }[] = [
  { Icon: Lock, n: 1 },
  { Icon: UserRoundX, n: 2 },
  { Icon: Hash, n: 3 },
  { Icon: Fingerprint, n: 4 },
  { Icon: Gauge, n: 5 },
  { Icon: MessageSquareOff, n: 6 },
]

export function Limits() {
  const { t } = useT()
  return (
    <AiSection id="limits" kicker={t('ai.limits.kicker')} title={t('ai.limits.title')} intro={t('ai.limits.intro')}>
      <ul className="grid gap-px overflow-hidden rounded-3xl border bg-border sm:grid-cols-2 lg:grid-cols-3" aria-label={t('ai.limits.kicker')} data-ai-limits>
        {ITEMS.map(({ Icon, n }) => (
          <li key={n} className="flex gap-3.5 bg-card p-5">
            <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="text-[14.5px] font-semibold tracking-tight">{t(`ai.limit${n}.title` as MessageKey)}</h3>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{t(`ai.limit${n}.body` as MessageKey)}</p>
            </div>
          </li>
        ))}
      </ul>
    </AiSection>
  )
}
