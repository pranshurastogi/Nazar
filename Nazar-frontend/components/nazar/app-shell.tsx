'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { BookOpen, CircleHelp, History, House, Menu, Moon, ShieldCheck, Sun } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Logo } from '@/components/nazar/logo'
import { Onboarding, ONBOARDED_KEY } from '@/components/nazar/onboarding'
import { StatusPill } from '@/components/nazar/status-pill'
import { loadPipelineStatus, type PipelineStatus } from '@/lib/source'
import { cn } from '@/lib/utils'

// The frame shared by every tab: nav rail, header with the pipeline status, mobile bottom
// nav, footer and the guide. It lives in the route-group layout, so moving between Check
// and Feed is a client-side navigation that keeps the status and theme state.

const STATUS_REFRESH_MS = 2 * 60 * 1000

export const soon = (what: string) => toast(`${what} is coming in the next build.`)

type NavEntry = { icon: typeof House; label: string; href: string }

const NAV: NavEntry[] = [
  { icon: House, label: 'Check', href: '/' },
  { icon: History, label: 'Feed', href: '/feed' },
  { icon: BookOpen, label: 'Cabinet', href: '/cabinet' },
  { icon: Menu, label: 'More', href: '/more' },
]

const TITLES: Record<string, string> = {
  '/': 'Check a medicine batch',
  '/feed': 'Alert feed',
  '/cabinet': 'My medicine cabinet',
  '/more': 'More about Nazar',
}

/** A tab is current on its own path and below it (/more#proof, /cabinet/…). */
const isActive = (href: string, pathname: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`))

type Shell = {
  /** Runs a batch check on the Check tab, navigating there first when needed. */
  requestCheck: (batch: string) => void
  /** The Check tab registers its runner while mounted. */
  registerCheck: (run: ((batch: string) => void) | null) => void
  /** A check requested from another tab, consumed once by the Check tab. */
  takePendingCheck: () => string | null
  /** Opens the onboarding guide (Guide button, More › Settings). */
  openGuide: () => void
}

const ShellContext = createContext<Shell | null>(null)

export function useShell() {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used inside AppShell')
  return ctx
}

function NavItem({ icon: Icon, label, href, active, compact }: NavEntry & { active: boolean; compact?: boolean }) {
  const cls = cn(
    'flex min-h-12 items-center rounded-xl font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
    compact ? 'flex-1 flex-col justify-center gap-1 text-[11px]' : 'gap-3 px-3.5 text-sm',
    active && 'bg-primary/10 text-primary hover:text-primary',
  )
  const body = (
    <>
      <Icon className="size-5" aria-hidden="true" />
      {label}
    </>
  )
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={cls}>
      {body}
    </Link>
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [status, setStatus] = useState<PipelineStatus>({ kind: 'checking' })
  const [guideOpen, setGuideOpen] = useState(false)
  const [today, setToday] = useState('')
  const runner = useRef<((batch: string) => void) | null>(null)
  const pending = useRef<string | null>(null)

  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) setGuideOpen(true)
    } catch {}
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    const refresh = () =>
      loadPipelineStatus(ctrl.signal).then(
        (s) => !ctrl.signal.aborted && setStatus(s),
        (err) => {
          if (ctrl.signal.aborted) return
          console.info('Nazar status unavailable', err)
          setStatus((s) => (s.kind === 'checking' ? { kind: 'offline' } : s))
        },
      )
    refresh()
    const t = setInterval(refresh, STATUS_REFRESH_MS)
    return () => {
      ctrl.abort()
      clearInterval(t)
    }
  }, [])

  const requestCheck = useCallback(
    (batch: string) => {
      if (runner.current) return runner.current(batch)
      pending.current = batch
      router.push('/')
    },
    [router],
  )

  const shell = useMemo<Shell>(
    () => ({
      requestCheck,
      registerCheck: (run) => {
        runner.current = run
      },
      takePendingCheck: () => {
        const b = pending.current
        pending.current = null
        return b
      },
      openGuide: () => setGuideOpen(true),
    }),
    [requestCheck],
  )

  const title = TITLES[pathname] ?? 'Nazar'

  return (
    <ShellContext.Provider value={shell}>
      <main className="min-h-dvh bg-background text-foreground">
        <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-background px-5 py-7 lg:flex">
          <Link href="/" aria-label="Nazar home" className="rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <Logo />
          </Link>
          <nav className="mt-12 flex flex-col gap-1.5" aria-label="Main navigation">
            {NAV.map((n) => <NavItem key={n.label} {...n} active={isActive(n.href, pathname)} />)}
          </nav>
          <div className="mt-auto rounded-2xl border bg-card p-4">
            <ShieldCheck className="size-5 text-primary" />
            <p className="mt-2.5 text-sm font-semibold">Private by design</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Your checks and cabinet stay on this device.</p>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Built by Pranshu Rastogi</p>
        </aside>

        <div className="mx-auto max-w-6xl px-4 pb-32 sm:px-6 lg:pb-12 lg:pl-[17rem] lg:pr-10">
          <header className="flex items-center justify-between gap-3 py-5 lg:py-7">
            <Link href="/" aria-label="Nazar home" className="rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none lg:hidden">
              <Logo />
            </Link>
            <div className="hidden lg:block">
              <p className="text-sm text-muted-foreground" suppressHydrationWarning>{today || ' '}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={status} />
              <Button variant="outline" className="h-11 rounded-full px-3.5" onClick={() => setGuideOpen(true)}>
                <CircleHelp /> <span className="hidden sm:inline">Guide</span>
              </Button>
              <ThemeToggle />
            </div>
          </header>

          {children}

          <footer className="mt-12 flex flex-col gap-1 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
            <p>Nazar reports what regulators publish. It never certifies a medicine as safe.</p>
            <p>© {new Date().getFullYear()} Nazar · Built by Pranshu Rastogi</p>
          </footer>
        </div>

        <nav
          aria-label="Mobile navigation"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 flex gap-1 rounded-2xl border bg-card/90 p-1.5 shadow-lg backdrop-blur-lg lg:hidden"
        >
          {NAV.map((n) => <NavItem key={n.label} {...n} active={isActive(n.href, pathname)} compact />)}
        </nav>

        <Onboarding open={guideOpen} onOpenChange={setGuideOpen} onTry={requestCheck} />
      </main>
    </ShellContext.Provider>
  )
}
