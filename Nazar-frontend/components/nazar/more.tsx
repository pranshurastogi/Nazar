'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import {
  ArrowRight,
  BookOpen,
  CircleHelp,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Fingerprint,
  Code2,
  History,
  Laptop,
  Link2,
  Moon,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { useShell } from '@/components/nazar/app-shell'
import { copy } from '@/components/nazar/result-card'
import { timeAgo } from '@/components/nazar/status-pill'
import { clearCabinet, clearRecent, RECENT_KEY, useCabinet, useHydrated } from '@/lib/cabinet'
import { explorerAddress, loadSources, PROJECT, PUBLISHER, stateName, type SourceList } from '@/lib/source'
import { cn } from '@/lib/utils'

// The More tab: how Nazar works, where its data comes from, how to verify it on Arkiv,
// what stays private, settings and credits. One page with in-page anchors, so every
// section can be linked to directly (/more#proof).

const REPO = 'https://github.com/pranshurastogi/Nazar'
const SCHEMA = `${REPO}/blob/main/arkiv/schema.md`

const SECTIONS = [
  { id: 'how', label: 'How it works' },
  { id: 'sources', label: 'Sources' },
  { id: 'proof', label: 'Proof on Arkiv' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'settings', label: 'Settings' },
  { id: 'about', label: 'About' },
] as const

const STEPS = [
  { icon: FileText, title: 'Regulator documents', body: 'CDSCO, state drug controllers and WHO publish lists of failed and fake batches as web pages and PDFs.' },
  { icon: Search, title: 'Read', body: 'Nazar downloads each document, fingerprints it with SHA-256 and reads every row: text layer first, OCR for scans.' },
  { icon: Sparkles, title: 'Resolved', body: 'Batch numbers are normalised, manufacturers and states identified, and a severity from 1 to 5 is scored by fixed rules.' },
  { icon: Link2, title: 'Published on Arkiv', body: 'Each alert becomes a public, read-only entity on Arkiv, signed by the Nazar publisher wallet and linked to its notice.' },
  { icon: ShieldCheck, title: 'You check', body: 'Your batch is matched against those alerts: from the Nazar API, straight from Arkiv, or built-in demo data as a last resort.' },
]

const ANSWERS = [
  { icon: TriangleAlert, label: 'Flagged', cls: 'bg-flagged text-white dark:text-background', body: 'A regulator named this exact batch as failed, fake or contaminated. Stop using it and keep the pack.' },
  { icon: History, label: 'Retracted', cls: 'bg-caution text-white dark:text-background', body: 'An alert on this batch was withdrawn or corrected. The original stays on record.' },
  { icon: Search, label: 'No alert found', cls: 'bg-quiet text-white dark:text-background', body: 'No regulator has published an alert for this batch yet. It is not a safety certificate.' },
  { icon: CircleHelp, label: "Can't tell", cls: 'bg-caution text-white dark:text-background', body: 'The batch could not be read, or it only looks like a flagged one. Re-read the pack before trusting it.' },
]

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

function Section({ id, kicker, title, intro, children }: { id: string; kicker: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 rounded-2xl border bg-card p-5 sm:p-7" data-more-section={id}>
      <p className="text-[11px] font-bold tracking-[0.16em] text-primary uppercase">{kicker}</p>
      <h3 id={`${id}-title`} className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl">{title}</h3>
      {intro && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{intro}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function IconButton({ label, onClick, icon: Icon = Copy }: { label: string; onClick: () => void; icon?: typeof Copy }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-11 shrink-0 rounded-xl text-muted-foreground')}>
      <Icon className="size-4" />
    </button>
  )
}

function HowItWorks() {
  return (
    <Section id="how" kicker="How Nazar works" title="From a regulator's PDF to your answer" intro="Nazar repeats what regulators publish. It never tests medicines and never guesses.">
      <ol className="grid gap-0 md:grid-cols-5 md:gap-3" aria-label="Pipeline">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative flex gap-4 pb-5 last:pb-0 md:flex-col md:gap-3 md:pb-0">
            {i < STEPS.length - 1 && (
              <span className="absolute top-12 bottom-0 left-[1.4375rem] w-px bg-border md:top-[1.4375rem] md:right-[-0.75rem] md:bottom-auto md:left-12 md:h-px md:w-auto" aria-hidden="true" />
            )}
            <span className="relative grid size-12 shrink-0 place-items-center rounded-full border-2 border-primary/25 bg-card text-primary ring-4 ring-primary/5">
              <s.icon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-1 md:pt-0">
              <p className="text-sm font-semibold">
                <span className="mr-1.5 font-mono text-xs text-muted-foreground">{i + 1}</span>
                {s.title}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <h4 className="mt-8 text-sm font-semibold">Four honest answers</h4>
      <p className="mt-1 text-[13px] text-muted-foreground">Colour, icon and words always agree. Nazar never says a medicine is fine to use.</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {ANSWERS.map((a) => (
          <li key={a.label} className="flex gap-3 rounded-xl border bg-background/60 p-3.5">
            <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', a.cls)}>
              <a.icon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{a.label}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{a.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Sources() {
  const [list, setList] = useState<SourceList | null>(null)
  const [now, setNow] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    loadSources(ctrl.signal).then(
      (l) => {
        if (ctrl.signal.aborted) return
        setNow(Date.now())
        setList(l)
      },
      () => {},
    )
    return () => ctrl.abort()
  }, [])

  return (
    <Section
      id="sources"
      kicker="Sources"
      title="Where the alerts come from"
      intro="Only official regulators. Each is re-checked on a schedule, and every alert links back to the document it came from."
    >
      <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground" data-sources-from={list?.source ?? 'loading'}>
        <span className={cn('size-1.5 rounded-full', list?.source === 'api' ? 'bg-primary' : 'bg-muted-foreground/50')} aria-hidden="true" />
        {!list ? 'Loading sources…' : list.source === 'api' ? 'Live · Nazar API, with each source’s last run' : 'Built-in list · the Nazar API is not reachable, so last runs are not shown'}
      </p>
      <ul className="divide-y rounded-xl border" aria-busy={!list} aria-label="Regulator sources">
        {!list &&
          [0, 1, 2, 3].map((i) => (
            <li key={i} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <span className="grid flex-1 gap-2">
                <span className="block h-3.5 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <span className="block h-3 w-3/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              </span>
            </li>
          ))}
        {list?.items.map((s) => {
          const where = s.jurisdiction === 'IN' ? 'All India' : (stateName(s.jurisdiction.replace('IN-TG', 'IN-TS')) ?? s.jurisdiction)
          return (
            <li key={s.id} className="flex items-start gap-3 px-4 py-3.5" data-source-row={s.id} data-enabled={s.enabled}>
              <span
                className={cn('mt-1.5 size-2 shrink-0 rounded-full', s.enabled ? (s.lastRun && !s.lastRun.ok ? 'bg-caution' : 'bg-primary') : 'bg-muted-foreground/40')}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold">{s.authority}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{s.id}</span>
                </p>
                <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{s.description}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="rounded-full border px-2 py-0.5 font-medium text-muted-foreground">{where}</span>
                  {s.enabled ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">On</span>
                  ) : (
                    <span className="rounded-full bg-caution-soft px-2 py-0.5 font-semibold text-caution">Off</span>
                  )}
                  {s.enabled && s.lastRun && (
                    <span className="text-muted-foreground">
                      Last run {timeAgo(s.lastRun.lastCheckedMs, now)}
                      {s.lastRun.ok ? '' : ' · failed, will retry'}
                    </span>
                  )}
                </p>
                {!s.enabled && s.disabledReason && <p className="mt-1.5 text-xs leading-5 text-caution">{s.disabledReason}</p>}
              </div>
              <a
                href={s.homepage}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Open ${s.authority} website`}
                title={`Open ${s.authority} website`}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11 shrink-0 text-muted-foreground')}
              >
                <ExternalLink className="size-4" />
              </a>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function Proof() {
  const code = snippet(PUBLISHER)
  return (
    <Section
      id="proof"
      kicker="Proof on Arkiv"
      title="Check Nazar's work yourself"
      intro="Every alert is a public entity on the Arkiv Tiramisu testnet. Nazar's app and API only trust entities created by this wallet and tagged with this project, so anyone can verify the same data without asking Nazar."
    >
      <dl className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="rounded-xl border bg-background/60 p-4">
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
        <div className="rounded-xl border bg-background/60 p-4">
          <dt className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Database className="size-3.5" aria-hidden="true" /> Project tag
          </dt>
          <dd className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-[13px] font-medium break-all">{PROJECT}</code>
            <IconButton label="Copy project tag" onClick={() => copy(PROJECT, 'Project tag')} />
          </dd>
        </div>
      </dl>

      <div className="mt-5 overflow-hidden rounded-xl border">
        <table className="w-full text-left text-[13px]">
          <caption className="sr-only">Arkiv entity types and lifetimes</caption>
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3.5 py-2.5 font-semibold">Entity</th>
              <th scope="col" className="hidden px-3.5 py-2.5 font-semibold sm:table-cell">Holds</th>
              <th scope="col" className="px-3.5 py-2.5 font-semibold">Lifetime</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ENTITIES.map((e) => (
              <tr key={e.type} className="align-top">
                <th scope="row" className="px-3.5 py-2.5 font-mono font-semibold">
                  {e.type}
                  <span className="mt-0.5 block font-sans text-xs font-normal text-muted-foreground sm:hidden">{e.what}</span>
                </th>
                <td className="hidden px-3.5 py-2.5 text-muted-foreground sm:table-cell">{e.what}</td>
                <td className="px-3.5 py-2.5">{e.life}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Alerts and notices are read-only, so nobody can edit them. Alerts can be kept alive by anyone while the batch may still be on shelves.
      </p>

      <div className="mt-5 overflow-hidden rounded-xl border bg-muted/40">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
          <p className="text-xs font-semibold text-muted-foreground">Look up a batch with the Arkiv SDK</p>
          <Button variant="ghost" className="h-10 px-3 text-xs" onClick={() => copy(code, 'Query')} aria-label="Copy SDK query">
            <Copy /> Copy
          </Button>
        </div>
        <pre className="max-h-80 overflow-auto p-4 font-mono text-[12px] leading-5" tabIndex={0} aria-label="Arkiv SDK query">
          <code>{code}</code>
        </pre>
      </div>

      <a href={SCHEMA} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants({ variant: 'outline' }), 'mt-5 h-12 w-full px-4 sm:w-auto')}>
        <BookOpen /> Read the full Arkiv schema <ExternalLink data-icon="inline-end" />
      </a>
    </Section>
  )
}

function Privacy() {
  return (
    <Section id="privacy" kicker="Privacy" title="Nothing about you leaves this device">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-sm font-semibold">Stays on this device</p>
          <ul className="mt-2 grid gap-1.5 text-[13px] leading-5 text-muted-foreground">
            <li>Your recent checks</li>
            <li>Your medicine cabinet: names, batches, notes and expiry dates</li>
            <li>Your theme and whether you have seen the guide</li>
          </ul>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-sm font-semibold">Never collected</p>
          <ul className="mt-2 grid gap-1.5 text-[13px] leading-5 text-muted-foreground">
            <li>No account, name, phone number or email</li>
            <li>No location, contacts or camera images</li>
            <li>No analytics, ads or tracking cookies</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
        To answer a check, only the batch number is sent to the Nazar API or the public Arkiv network. It is not linked to you, and your cabinet list is never uploaded.
      </p>
    </Section>
  )
}

function Settings() {
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()
  const shell = useShell()
  const cabinet = useCabinet()
  const [recentCount, setRecentCount] = useState(0)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    try {
      const r: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
      setRecentCount(Array.isArray(r) ? r.length : 0)
    } catch {}
  }, [])

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Laptop },
  ]
  const current = hydrated ? (theme ?? 'system') : null

  const row = 'flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between'

  return (
    <Section id="settings" kicker="Settings" title="Make Nazar yours">
      <div className="divide-y">
        <div className={row}>
          <div>
            <p className="text-sm font-semibold" id="theme-label">Theme</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">System follows your phone or computer.</p>
          </div>
          <div role="radiogroup" aria-labelledby="theme-label" className="grid h-12 grid-cols-3 overflow-hidden rounded-xl border bg-background sm:w-80">
            {themes.map((t) => (
              <button
                key={t.value}
                role="radio"
                aria-checked={current === t.value}
                data-theme-option={t.value}
                onClick={() => setTheme(t.value)}
                className={cn(
                  'flex h-full items-center justify-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
                  current === t.value && 'bg-primary/10 text-primary hover:text-primary',
                )}
              >
                <t.icon className="size-4" aria-hidden="true" /> {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className={row}>
          <div>
            <p className="text-sm font-semibold">Guide</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">The four-step tour from your first visit.</p>
          </div>
          <Button variant="outline" className="h-12 px-4 sm:w-56" onClick={shell.openGuide}>
            <CircleHelp /> Replay the guide
          </Button>
        </div>

        <div className={row}>
          <div>
            <p className="text-sm font-semibold">Recent checks</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {recentCount ? `${recentCount} saved on this device.` : 'Nothing saved yet.'}
            </p>
          </div>
          <Button
            variant="outline"
            className="h-12 px-4 sm:w-56"
            disabled={!recentCount}
            onClick={() => {
              clearRecent()
              setRecentCount(0)
              toast.success('Recent checks cleared')
            }}
          >
            <Trash2 /> Clear recent checks
          </Button>
        </div>

        <div className={row} data-clear-cabinet>
          <div>
            <p className="text-sm font-semibold">Medicine cabinet</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {!hydrated ? ' ' : cabinet.length ? `${cabinet.length} ${cabinet.length === 1 ? 'medicine' : 'medicines'} saved on this device.` : 'Empty.'}{' '}
              {hydrated && cabinet.length > 0 && (
                <Link href="/cabinet" className="font-medium text-primary underline-offset-2 hover:underline">Open cabinet</Link>
              )}
            </p>
          </div>
          {!confirming ? (
            <Button variant="destructive" className="h-12 px-4 sm:w-56" disabled={!hydrated || !cabinet.length} onClick={() => setConfirming(true)}>
              <Trash2 /> Clear cabinet
            </Button>
          ) : (
            <div role="group" aria-label="Confirm clearing the cabinet" className="rounded-xl border border-flagged-border bg-flagged-soft p-3 sm:max-w-sm">
              <p className="text-[13px] font-medium">
                Remove all {cabinet.length} {cabinet.length === 1 ? 'medicine' : 'medicines'} from this device? This can&apos;t be undone. Export first if you want a copy.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" className="h-11 flex-1" onClick={() => setConfirming(false)} autoFocus>
                  Cancel
                </Button>
                <Button
                  className="h-11 flex-1 bg-flagged font-semibold text-white hover:bg-flagged/90 dark:text-background"
                  onClick={() => {
                    clearCabinet()
                    setConfirming(false)
                    toast.success('Cabinet cleared')
                  }}
                >
                  Yes, clear it
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}

function About() {
  return (
    <Section id="about" kicker="About" title="Built in the open">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <p className="text-sm leading-6">
            Nazar is built by <span className="font-semibold">Pranshu Rastogi</span> and released under the <span className="font-semibold">MIT licence</span>. The pipeline,
            the app and the Arkiv schema are all public.
          </p>
        </div>
        <a href={REPO} target="_blank" rel="noreferrer noopener" className={cn(buttonVariants({ variant: 'outline' }), 'h-12 px-4')}>
          <Code2 /> View on GitHub <ArrowRight data-icon="inline-end" />
        </a>
      </div>
      <p className="mt-5 flex items-start gap-2.5 rounded-xl border border-caution-border bg-caution-soft px-4 py-3 text-[13px] leading-5 text-caution" data-disclaimer>
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Nazar repeats what regulators publish. It does not test medicines and is not medical advice. If a medicine has harmed someone, contact a doctor.
        </span>
      </p>
    </Section>
  )
}

export function More() {
  return (
    <div className="pt-4 md:pt-8">
      <section className="max-w-2xl">
        <p className="text-[11px] font-bold tracking-[0.18em] text-primary uppercase">More</p>
        <h2 className="mt-3 text-[clamp(2rem,6vw,2.75rem)] leading-[1.02] font-semibold tracking-[-0.045em]">
          How it works, <span className="text-muted-foreground">and how to check it.</span>
        </h2>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          Where Nazar&apos;s alerts come from, how to verify them on Arkiv, what stays private, and your settings.
        </p>
      </section>

      <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="inline-flex min-h-11 items-center rounded-full border bg-card px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {s.label}
          </a>
        ))}
      </nav>

      <div className="mt-6 grid grid-cols-1 gap-4">
        <HowItWorks />
        <Sources />
        <Proof />
        <Privacy />
        <Settings />
        <About />
      </div>
    </div>
  )
}
