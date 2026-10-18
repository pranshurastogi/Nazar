import { Fingerprint, Gauge, Hash, Lock, MessageSquareOff, UserRoundX } from 'lucide-react'

import { AiSection } from './shared'

// What the MCP server can and cannot see, and how hard it can be used. Every line matches the
// server code (Nazar-backend/src/mcp/http.ts and server.ts).

const ITEMS = [
  { Icon: Lock, title: 'Read-only', body: 'Every tool is marked read-only. Nothing can be written, changed or deleted through it.' },
  { Icon: UserRoundX, title: 'No personal data', body: 'No account, no sign-in and no API key. The server never asks who you are.' },
  { Icon: Hash, title: 'Batch numbers only', body: 'Nazar receives only tool arguments: a batch number, search words or an id, never your conversation. Logs keep the tool name, outcome and time, not the arguments.' },
  { Icon: Fingerprint, title: 'Salted IP hash', body: 'Rate limits know a client only by a salted hash of its IP address, held in memory.' },
  { Icon: Gauge, title: 'Fair limits', body: '60 tool calls a minute per client, 240 requests a minute, and request bodies up to 64 KB.' },
  { Icon: MessageSquareOff, title: 'No medicine explainer', body: 'The app’s AI medicine explainer is not exposed. Dosing and medical questions belong with a pharmacist or doctor.' },
] as const

export function Limits() {
  return (
    <AiSection id="limits" kicker="Privacy and limits" title="It sees a batch number, and nothing else." intro="The MCP server is built to know as little as possible about the person asking.">
      <ul className="grid gap-px overflow-hidden rounded-3xl border bg-border sm:grid-cols-2 lg:grid-cols-3" aria-label="Privacy and limits" data-ai-limits>
        {ITEMS.map(({ Icon, title, body }) => (
          <li key={title} className="flex gap-3.5 bg-card p-5">
            <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="text-[14.5px] font-semibold tracking-tight">{title}</h3>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </AiSection>
  )
}
