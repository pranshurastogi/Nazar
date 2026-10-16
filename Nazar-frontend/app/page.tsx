'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  ArrowRight,
  Baby,
  BookOpen,
  ChevronRight,
  CircleHelp,
  FileSpreadsheet,
  History,
  House,
  Menu,
  Moon,
  ScanLine,
  Search,
  ShieldCheck,
  Sun,
  TriangleAlert,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Logo } from '@/components/nazar/logo'
import { Onboarding, ONBOARDED_KEY } from '@/components/nazar/onboarding'
import { ResultCard } from '@/components/nazar/result-card'
import { Rings } from '@/components/nazar/rings'
import { activeAlerts, checkBatch, childAlerts, type CheckResult, type ResultState } from '@/lib/mock-source'
import { cn } from '@/lib/utils'

const RECENT_KEY = 'nazar:recent'
type Recent = { batch: string; name: string; state: ResultState }

const NAV = [
  { icon: House, label: 'Check' },
  { icon: History, label: 'Feed' },
  { icon: BookOpen, label: 'Cabinet' },
  { icon: Menu, label: 'More' },
]

const STATE_STYLE: Record<ResultState, { icon: typeof Search; cls: string; label: string }> = {
  flagged: { icon: TriangleAlert, cls: 'bg-flagged-soft text-flagged', label: 'Flagged' },
  retracted: { icon: History, cls: 'bg-caution-soft text-caution', label: 'Retracted' },
  no_alert: { icon: Search, cls: 'bg-quiet-soft text-quiet', label: 'No alert found' },
  unreadable: { icon: CircleHelp, cls: 'bg-caution-soft text-caution', label: "Can't tell" },
}

const soon = (what: string) => toast(`${what} is coming in the next build.`)

function NavItem({ icon: Icon, label, active, compact }: { icon: typeof House; label: string; active?: boolean; compact?: boolean }) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      onClick={() => !active && soon(label)}
      className={cn(
        'flex min-h-12 items-center rounded-xl font-semibold text-muted-foreground transition-colors hover:text-foreground',
        compact ? 'flex-1 flex-col justify-center gap-1 text-[11px]' : 'gap-3 px-3.5 text-sm',
        active && 'bg-primary/10 text-primary hover:text-primary',
      )}
    >
      <Icon className="size-5" />
      {label}
    </button>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  return (
    <Button variant="outline" size="icon-lg" className="size-11 rounded-full" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label="Toggle dark mode">
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}

export default function Page() {
  const [batch, setBatch] = useState('')
  const [result, setResult] = useState<CheckResult | null>(null)
  const [recent, setRecent] = useState<Recent[]>([])
  const [guideOpen, setGuideOpen] = useState(false)
  const [today, setToday] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'))
      if (!localStorage.getItem(ONBOARDED_KEY)) setGuideOpen(true)
    } catch {}
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const runCheck = (value = batch) => {
    if (!value.trim()) {
      inputRef.current?.focus()
      return
    }
    const r = checkBatch(value)
    setBatch(r.batch)
    setResult(r)
    if (r.state !== 'unreadable') {
      const entry: Recent = { batch: r.batch, name: 'alert' in r ? r.alert.brand : 'Batch check', state: r.state }
      const next = [entry, ...recent.filter((x) => x.batch !== r.batch)].slice(0, 6)
      setRecent(next)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {}
    }
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  const clearRecent = () => {
    setRecent([])
    try {
      localStorage.removeItem(RECENT_KEY)
    } catch {}
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-background px-5 py-7 lg:flex">
        <Logo />
        <nav className="mt-12 flex flex-col gap-1.5" aria-label="Main navigation">
          {NAV.map((n, i) => <NavItem key={n.label} {...n} active={i === 0} />)}
        </nav>
        <div className="mt-auto rounded-2xl border bg-card p-4">
          <ShieldCheck className="size-5 text-primary" />
          <p className="mt-2.5 text-sm font-semibold">Private by design</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Your checks stay on this device.</p>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Built by Pranshu Rastogi</p>
      </aside>

      <div className="mx-auto max-w-6xl px-4 pb-32 sm:px-6 lg:pb-12 lg:pl-[17rem] lg:pr-10">
        <header className="flex items-center justify-between gap-3 py-5 lg:py-7">
          <Logo className="lg:hidden" />
          <div className="hidden lg:block">
            <p className="text-sm text-muted-foreground" suppressHydrationWarning>{today || ' '}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Check a medicine batch</h1>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Badge variant="outline" className="hidden h-8 gap-2 rounded-full px-3 text-xs font-semibold text-muted-foreground sm:inline-flex" />
                }
              >
                <span className="size-2 rounded-full bg-primary" /> Demo data
              </TooltipTrigger>
              <TooltipContent>Sample alerts while the Arkiv pipeline is being connected</TooltipContent>
            </Tooltip>
            <Button variant="outline" className="h-11 rounded-full px-3.5" onClick={() => setGuideOpen(true)}>
              <CircleHelp /> <span className="hidden sm:inline">Guide</span>
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <section className="grid grid-cols-1 items-center gap-8 pt-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:pt-14">
          <div className="max-w-lg">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary">Har batch par nazar</p>
            <h2 className="mt-3 text-[clamp(2.5rem,8vw,3.25rem)] md:text-[2.5rem] xl:text-[3.25rem] font-semibold leading-[0.98] tracking-[-0.05em]">
              Check the batch,
              <br />
              <span className="text-muted-foreground">not just the brand.</span>
            </h2>
            <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
              Match any batch number against alerts published by CDSCO and state drug regulators. Every answer shows where it came from.
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between">
              <label htmlFor="batch" className="text-sm font-semibold">Batch number</label>
              <span className="text-xs text-muted-foreground">
                Look for <span className="font-mono">B.No.</span> on the pack
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-xl border bg-background px-4 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
              <Search className="size-5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                id="batch"
                value={batch}
                onChange={(e) => setBatch(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && runCheck()}
                onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                placeholder="e.g. SR-13"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="search"
                className="h-14 min-w-0 flex-1 bg-transparent font-mono text-xl tracking-wider uppercase outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:normal-case placeholder:text-muted-foreground/70"
              />
              {batch && (
                <button onClick={() => { setBatch(''); setResult(null); inputRef.current?.focus() }} className="grid size-10 place-items-center text-muted-foreground" aria-label="Clear batch">
                  <X className="size-5" />
                </button>
              )}
            </div>
            <div className="mt-4 flex gap-3">
              <Button className="h-13 flex-1 rounded-xl text-base font-semibold" onClick={() => runCheck()}>
                Check batch <ArrowRight data-icon="inline-end" />
              </Button>
              <Button variant="outline" className="size-13 rounded-xl text-primary" aria-label="Scan the pack" onClick={() => soon('Camera scan')}>
                <ScanLine className="size-5" />
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Try:</span>
              {['SR-13', 'DEMO-RT1', 'AB1234', '5R-13'].map((b) => (
                <button key={b} onClick={() => runCheck(b)} className="min-h-8 rounded-full border px-2.5 font-mono font-medium text-foreground hover:bg-muted">
                  {b}
                </button>
              ))}
              <span className="ml-auto hidden lg:inline">
                <kbd className="rounded border px-1.5 font-mono">/</kbd> to focus
              </span>
            </div>
          </div>
        </section>

        <div ref={resultRef} className="scroll-mb-28 scroll-mt-6">
          {result && <div className="mt-8"><ResultCard result={result} onCheck={runCheck} /></div>}
        </div>

        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Regulator notices</p>
                <h3 className="mt-1 text-lg font-semibold tracking-tight">Active alerts</h3>
              </div>
              <Badge variant="secondary" className="h-6 px-2.5">{activeAlerts.length} active</Badge>
            </div>
            <ul className="mt-4 divide-y">
              {activeAlerts.map((a) => (
                <li key={a.batch}>
                  <button onClick={() => runCheck(a.batch)} className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-flagged-soft text-flagged"><TriangleAlert className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{a.brand}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="font-mono">{a.batch}</span> · {a.authority} · {a.noticeDate}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col rounded-2xl border bg-card p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Baby className="size-5" /></span>
              <div>
                <h3 className="font-semibold">Child Shield</h3>
                <p className="text-xs text-muted-foreground">Syrups, drops and suspensions</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Children&apos;s medicines with a glycol contamination alert are ranked at the highest severity.{' '}
              <span className="font-semibold text-foreground">{childAlerts.length} active right now.</span>
            </p>
            <div className="mt-auto pt-5">
              <Button variant="outline" className="h-11" onClick={() => runCheck(childAlerts[0].batch)}>
                See the latest <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">On this device</p>
              <h3 className="mt-1 text-xl font-semibold tracking-tight">Recent checks</h3>
            </div>
            {recent.length > 0 && <Button variant="ghost" className="h-10" onClick={clearRecent}>Clear</Button>}
          </div>
          {recent.length === 0 ? (
            <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed px-6 py-10 text-center">
              <Rings className="size-24"><Search /></Rings>
              <p className="mt-4 font-semibold">No checks yet</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">Batches you check appear here. They never leave this device.</p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((item) => {
                const s = STATE_STYLE[item.state]
                return (
                  <button key={item.batch} onClick={() => runCheck(item.batch)} className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/50">
                    <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', s.cls)}><s.icon className="size-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{item.name}</span>
                      <span className="block truncate text-xs text-muted-foreground"><span className="font-mono">{item.batch}</span> · {s.label}</span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><FileSpreadsheet className="size-5" /></span>
            <div>
              <h3 className="font-semibold">Have a whole shelf to check?</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">Shelf Sweep matches a stock CSV in your browser.</p>
            </div>
          </div>
          <Button variant="outline" className="h-11" onClick={() => soon('Shelf Sweep')}>
            Open Shelf Sweep <ArrowRight data-icon="inline-end" />
          </Button>
        </section>

        <footer className="mt-12 flex flex-col gap-1 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <p>Nazar reports what regulators publish. It never certifies a medicine as safe.</p>
          <p>© {new Date().getFullYear()} Nazar · Built by Pranshu Rastogi</p>
        </footer>
      </div>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 flex gap-1 rounded-2xl border bg-card/90 p-1.5 shadow-lg backdrop-blur-lg lg:hidden"
      >
        {NAV.map((n, i) => <NavItem key={n.label} {...n} active={i === 0} compact />)}
      </nav>

      <Onboarding open={guideOpen} onOpenChange={setGuideOpen} onTry={(b) => runCheck(b)} />
    </main>
  )
}
