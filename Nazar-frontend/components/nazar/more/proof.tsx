'use client'

import Link from 'next/link'
import { ArrowRight, BookOpen, Copy, Database, ExternalLink, Fingerprint, Lock } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { copy } from '@/components/nazar/result-card'
import { explorerAddress, PROJECT, PUBLISHER } from '@/lib/source'
import { cn } from '@/lib/utils'
import { IconButton, panel, SCHEMA, Section } from './shared'

const ENTITIES = [
  { type: 'notice', what: 'The regulator document: title, URL, date and SHA-256', life: '5 years' },
  { type: 'alert', what: 'One flagged batch: product, maker, failure, severity', life: 'Batch expiry + 180 days (90 days to 10 years)' },
  { type: 'retraction', what: 'Withdraws or corrects an alert', life: "Alert's remaining life + 1 year" },
  { type: 'heartbeat', what: 'Proves the pipeline is running', life: '20 minutes, renewed every 5' },
  { type: 'snapshot', what: 'Daily index of every flagged batch key', life: '7 days' },
]

const snippet = (publisher: string) => `import { createPublicClient } from '@arkiv-network/sdk'
import { str } from '@arkiv-network/sdk/attr'
import { tiramisu } from '@arkiv-network/sdk/chains'
import { eq } from '@arkiv-network/sdk/query'
import { http } from 'viem'

const client = createPublicClient({ chain: tiramisu, transport: http() })

// Batch keys are lowercase with separators removed: "SR-13" -> "sr13"
const page = await client
  .select({ key: true, attributes: true, payload: true })
  .where([
    eq('project', str('${PROJECT}')),
    eq('t', str('alert')),
    eq('batch', str('sr13')),
  ])
  .createdBy('${publisher}')
  .fetch()

console.log(page.entities.map((e) => e.toJson()))`

export function Proof() {
  const code = snippet(PUBLISHER)
  return (
    <Section
      id="proof"
      kicker="Proof on Arkiv"
      title="Check Nazar's work yourself"
      intro="Every alert is a public entity on the Arkiv Tiramisu testnet. Nazar's app and API only trust entities created by this wallet and tagged with this project, so anyone can verify the same data without asking Nazar."
    >
      <dl className="grid gap-3">
        <div className={cn(panel, 'p-4 sm:p-5')}>
          <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Fingerprint className="size-3.5" aria-hidden="true" /> Publisher wallet
          </dt>
          <dd className="mt-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 font-mono text-[13px] font-medium break-all" data-publisher>{PUBLISHER}</span>
            <IconButton label="Copy publisher wallet" onClick={() => copy(PUBLISHER, 'Publisher wallet')} />
            <a
              href={explorerAddress(PUBLISHER)}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Open publisher wallet in the Arkiv explorer"
              title="Open publisher wallet in the Arkiv explorer"
              className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-11 shrink-0 rounded-xl text-muted-foreground')}
            >
              <ExternalLink className="size-4" />
            </a>
          </dd>
        </div>
        <div className={cn(panel, 'p-4 sm:p-5')}>
          <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Database className="size-3.5" aria-hidden="true" /> Project tag
          </dt>
          <dd className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-[13px] font-medium break-all">{PROJECT}</code>
            <IconButton label="Copy project tag" onClick={() => copy(PROJECT, 'Project tag')} />
          </dd>
        </div>
      </dl>

      <h4 className="mt-10 text-base font-semibold tracking-tight">What Nazar writes, and how long it lives</h4>
      <div className={cn(panel, 'mt-3 overflow-hidden')}>
        <table className="w-full text-left text-[13px]">
          <caption className="sr-only">Arkiv entity types and lifetimes</caption>
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Entity</th>
              <th scope="col" className="hidden px-4 py-2.5 font-semibold sm:table-cell">Holds</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Lifetime</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ENTITIES.map((e) => (
              <tr key={e.type} className="align-top">
                <th scope="row" className="px-4 py-3 font-mono font-semibold">
                  {e.type}
                  <span className="mt-0.5 block font-sans text-xs font-normal text-muted-foreground sm:hidden">{e.what}</span>
                </th>
                <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{e.what}</td>
                <td className="px-4 py-3">{e.life}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 flex max-w-[65ch] items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>Alerts and notices are read-only, so nobody can edit them. Alerts can be kept alive by anyone while the batch may still be on shelves.</span>
      </p>

      <h4 className="mt-10 text-base font-semibold tracking-tight">Or read Arkiv from your own code</h4>
      <div className={cn(panel, 'mt-3 overflow-hidden bg-muted/40')}>
        <div className="flex items-center justify-between gap-3 border-b px-4 py-1.5">
          <p className="text-xs font-semibold text-muted-foreground">Look up a batch with the Arkiv SDK</p>
          <Button variant="ghost" className="h-10 px-3 text-xs" onClick={() => copy(code, 'Query')} aria-label="Copy SDK query">
            <Copy /> Copy
          </Button>
        </div>
        <pre className="max-h-80 overflow-auto p-4 font-mono text-[12px] leading-5" tabIndex={0} aria-label="Arkiv SDK query">
          <code>{code}</code>
        </pre>
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Link href="/arkiv" className={cn(buttonVariants(), 'h-12 w-full rounded-xl px-4 sm:w-auto')} data-arkiv-link>
          <Database /> Explore everything on Arkiv <ArrowRight data-icon="inline-end" />
        </Link>
        <a href={SCHEMA} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants({ variant: 'outline' }), 'h-12 w-full rounded-xl px-4 sm:w-auto')}>
          <BookOpen /> Read the full Arkiv schema <ExternalLink data-icon="inline-end" />
        </a>
      </div>
    </Section>
  )
}
