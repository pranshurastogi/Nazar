import { ChevronDown, Equal, Quote, ScanSearch, ShieldX } from 'lucide-react'

import { cn } from '@/lib/utils'
import { INSTRUCTIONS } from './data'
import { AiSection } from './shared'

// The trust panel: the four rules the server hands every assistant (its MCP `instructions`), in
// plain words, with the full text one click away.

const ANSWERS = [
  { word: 'Flagged', tone: 'border-flagged-border bg-flagged-soft text-flagged' },
  { word: 'Retracted', tone: 'border-caution-border bg-caution-soft text-caution' },
  { word: 'No alert found', tone: 'border-quiet-border bg-quiet-soft text-quiet' },
  { word: 'Can’t tell', tone: 'border-caution-border bg-caution-soft text-caution' },
] as const

const RULES = [
  {
    Icon: Equal,
    title: 'Four answers, reported as given',
    body: 'Every check is exactly one of four states. The assistant repeats it and never upgrades or softens it.',
    extra: (
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="The four answers">
        {ANSWERS.map((a) => (
          <li key={a.word} className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', a.tone)}>
            {a.word}
          </li>
        ))}
      </ul>
    ),
  },
  {
    Icon: ShieldX,
    title: 'Never “safe”',
    body: 'Not “safe”, “genuine”, “fine” or “approved”. “No alert found” is not a safety certificate, and the assistant must say so.',
  },
  {
    Icon: ScanSearch,
    title: 'A look-alike is never a flag',
    body: '5R-13 looks like SR-13, so the answer is “Can’t tell”. The assistant asks you to re-read the pack and check again.',
  },
  {
    Icon: Quote,
    title: 'Cite the notice',
    body: 'For a flag: the regulator, the notice title and date, its link and the Arkiv entity, with the reason in the regulator’s own words.',
  },
] as const

export function Rules() {
  return (
    <AiSection
      id="rules"
      kicker="The rules"
      title="The rules every assistant gets."
      intro="Nazar sends these with every connection, as the server's instructions. They are the same rules the app follows, so an assistant cannot make Nazar sound surer than the regulator."
    >
      <div className="overflow-hidden rounded-3xl border bg-card" data-trust-panel>
        <ol className="grid sm:grid-cols-2" aria-label="Rules">
          {RULES.map((r, i) => (
            <li key={r.title} className={cn('flex gap-4 p-5 sm:p-6', i > 0 && 'border-t', i === 1 && 'sm:border-t-0', i % 2 === 1 && 'sm:border-l')} data-trust-rule>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <r.Icon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold tracking-tight">
                  <span className="mr-1.5 font-mono text-xs text-primary">{i + 1}</span>
                  {r.title}
                </h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.6] text-muted-foreground">{r.body}</p>
                {'extra' in r && r.extra}
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t bg-muted/30 px-5 py-4 sm:px-6">
          <p className="text-[13px] leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">Also:</span> confirm the brand and maker on the pack match the alert before concluding · use{' '}
            <code className="font-mono text-[12px]">arkiv_proof</code> to show it can be verified without trusting Nazar · no dosing or medical advice; point people to a pharmacist or doctor.
          </p>
          <details className="group mt-2">
            <summary className="-mx-1 inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              Read the exact instructions <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded-2xl border bg-card p-4 font-mono text-[11.5px] leading-[1.65] break-words whitespace-pre-wrap" tabIndex={0} aria-label="Server instructions" data-instructions>
              {INSTRUCTIONS}
            </pre>
          </details>
        </div>
      </div>
    </AiSection>
  )
}
