'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { MotionConfig, motion } from 'motion/react'
import { toast } from 'sonner'
// Navigation icons come from Phosphor, one module per icon so only these ship. Active items use the
// duotone weight, the rest regular. Lucide stays the icon set everywhere else.
import { BellSimple } from '@phosphor-icons/react/dist/csr/BellSimple'
import { BookOpenText } from '@phosphor-icons/react/dist/csr/BookOpenText'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { DotsThreeCircle } from '@phosphor-icons/react/dist/csr/DotsThreeCircle'
import { ListChecks } from '@phosphor-icons/react/dist/csr/ListChecks'
import { LockSimple } from '@phosphor-icons/react/dist/csr/LockSimple'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { Moon } from '@phosphor-icons/react/dist/csr/Moon'
import { Pill } from '@phosphor-icons/react/dist/csr/Pill'
import { Question } from '@phosphor-icons/react/dist/csr/Question'
import { Robot } from '@phosphor-icons/react/dist/csr/Robot'
import { Sun } from '@phosphor-icons/react/dist/csr/Sun'

import { Button } from '@/components/ui/button'
import { AUTHOR, SocialIcons } from '@/components/nazar/author-links'
import { Logo } from '@/components/nazar/logo'
import { Onboarding, ONBOARDED_KEY } from '@/components/nazar/onboarding'
import { StatusPill } from '@/components/nazar/status-pill'
import { PerfRuntime } from '@/components/nazar/perf/runtime'
import { useCabinetFlagged, useUnseenAlerts } from '@/lib/badges'
import { useT, type MessageKey } from '@/lib/i18n'
import { prefetchFor } from '@/lib/source/prefetch'
import { loadPipelineStatus, type PipelineStatus } from '@/lib/source'
import { cn } from '@/lib/utils'

// The frame shared by every tab: nav rail, header with the pipeline status, mobile bottom
// nav, footer and the guide. It lives in the route-group layout, so moving between Check
// and Alerts is a client-side navigation that keeps the status and theme state.

const STATUS_REFRESH_MS = 2 * 60 * 1000

export const soon = (what: string) => toast(`${what} is coming in the next build.`)

type Icon = typeof Pill

type NavEntry = {
  /** Stable hook for tests and analytics (data-nav). */
  key: string
  href: string
  icon: Icon
  label: MessageKey
  /** One short line under the label in the desktop rail. */
  hint: MessageKey
  /** The mobile bar: its label and icon when they differ, or false to keep the entry off the bar. */
  bar?: { label?: MessageKey; icon?: Icon; aria?: MessageKey } | false
}

type NavSection = { id: string; title: MessageKey; items: NavEntry[] }

/** A count on a nav item: unseen alerts (quiet, primary) or flagged cabinet medicines (red). */
type Badge = { count: number; tone: 'new' | 'flagged'; label: string }

const badgeText = (n: number) => (n > 99 ? '99+' : String(n))

/**
 * The count itself. Screen readers hear it in the link's name (aria-label), so it is hidden from
 * them, and drawn as generated content so the link's text stays its label.
 */
function BadgeDot({ badge, className }: { badge: Badge; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-nav-badge={badge.tone}
      data-count={badgeText(badge.count)}
      className={cn(
        'pointer-events-none grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full px-1 font-mono text-[10px] leading-none font-bold tabular-nums before:content-[attr(data-count)]',
        badge.tone === 'flagged' ? 'bg-flagged text-white dark:text-background' : 'bg-primary text-primary-foreground',
        className,
      )}
    />
  )
}

// Desktop: four labelled groups, in the order a visitor needs them. Phone: five tabs. On-chain
// (Arkiv) stays off the phone bar: it is a dense explorer for verifying the record, reached from
// every result's proof link and from More, while the bar keeps the things people do on the go.
const SECTIONS: NavSection[] = [
  {
    id: 'lookup',
    title: 'nav.section.lookup',
    items: [
      { key: 'check', href: '/', icon: MagnifyingGlass, label: 'nav.check', hint: 'nav.check.hint' },
      { key: 'alerts', href: '/feed', icon: BellSimple, label: 'nav.alerts', hint: 'nav.alerts.hint' },
      // Desktop only: the phone bar keeps five tabs; on a phone Check and More link to it.
      { key: 'sweep', href: '/sweep', icon: ListChecks, label: 'nav.sweep', hint: 'nav.sweep.hint', bar: false },
    ],
  },
  {
    id: 'yours',
    title: 'nav.section.yours',
    items: [{ key: 'cabinet', href: '/cabinet', icon: Pill, label: 'nav.cabinet', hint: 'nav.cabinet.hint', bar: { label: 'nav.cabinet.bar', aria: 'nav.cabinet' } }],
  },
  {
    id: 'verify',
    title: 'nav.section.verify',
    items: [
      { key: 'onchain', href: '/arkiv', icon: Cube, label: 'nav.onchain', hint: 'nav.onchain.hint', bar: false },
      { key: 'ai', href: '/ai', icon: Robot, label: 'nav.ai', hint: 'nav.ai.hint', bar: { label: 'nav.ai.bar', aria: 'nav.ai' } },
    ],
  },
  {
    id: 'learn',
    title: 'nav.section.learn',
    items: [
      {
        key: 'learn',
        href: '/more',
        icon: BookOpenText,
        label: 'nav.learn',
        hint: 'nav.learn.hint',
        // On a phone this tab also holds On-chain, settings and About, so it reads "More" there.
        bar: { label: 'nav.learn.bar', icon: DotsThreeCircle, aria: 'nav.learn.barAria' },
      },
    ],
  },
]

const BAR = SECTIONS.flatMap((s) => s.items).filter((n) => n.bar !== false)

const TITLES: Record<string, MessageKey> = {
  '/': 'title./',
  '/feed': 'title./feed',
  '/sweep': 'title./sweep',
  '/cabinet': 'title./cabinet',
  '/more': 'title./more',
  '/arkiv': 'title./arkiv',
  '/ai': 'title./ai',
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

/** The active marker glides between items; MotionConfig turns that into a jump under reduced motion. */
const GLIDE = { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 } as const

const focusRing = 'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'

/** Warms the tab's data while the pointer, a finger or focus is on its link. */
const prefetchHandlers = (href: string) => ({
  onPointerEnter: () => prefetchFor(href),
  onFocus: () => prefetchFor(href),
  onTouchStart: () => prefetchFor(href),
})

function RailItem({ entry, active, badge }: { entry: NavEntry; active: boolean; badge?: Badge | null }) {
  const { t } = useT()
  const { key, href, icon: Icon } = entry
  const label = t(entry.label)
  const hint = t(entry.hint)
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={badge ? `${label}, ${badge.label}` : undefined}
      aria-describedby={`nav-hint-${key}`}
      data-nav={key}
      data-label={label}
      className={cn(
        'group/nav relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-muted-foreground transition-colors',
        active ? 'text-primary' : 'hover:bg-muted/70 hover:text-foreground dark:hover:bg-muted/60',
        focusRing,
      )}
      {...prefetchHandlers(href)}
    >
      {active && (
        <motion.span
          layoutId="nav-rail-active"
          transition={GLIDE}
          className="absolute inset-0 rounded-xl bg-primary/[0.08] ring-1 ring-primary/15 ring-inset dark:bg-primary/[0.13] dark:ring-primary/20"
          aria-hidden="true"
        >
          <span className="absolute top-1/2 left-1 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary/80" />
        </motion.span>
      )}
      <Icon weight={active ? 'duotone' : 'regular'} className="relative size-5 shrink-0" aria-hidden="true" />
      <span className="relative flex min-w-0 flex-col">
        <span className={cn('text-sm leading-5 font-semibold tracking-[-0.01em]', !active && 'text-foreground/85 group-hover/nav:text-foreground')}>{label}</span>
        {/* The hint is a second line on screens tall enough for it; shorter ones keep the label alone.
            Screen readers get it as the link's description, so the link's name stays the label. */}
        <span
          id={`nav-hint-${key}`}
          aria-hidden="true"
          className={cn(
            'hidden truncate text-xs leading-4 font-normal [@media(min-height:860px)]:block',
            active ? 'text-primary/75' : 'text-muted-foreground/90',
          )}
        >
          {hint}
        </span>
      </span>
      {badge && <BadgeDot badge={badge} className="relative ml-auto shrink-0" />}
    </Link>
  )
}

function BarItem({ entry, active, badge }: { entry: NavEntry; active: boolean; badge?: Badge | null }) {
  const { t } = useT()
  const { key, href } = entry
  const bar = entry.bar || {}
  const Icon = bar.icon ?? entry.icon
  const label = t(bar.label ?? entry.label)
  const aria = bar.aria ? t(bar.aria) : undefined
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={badge ? `${aria ?? label}, ${badge.label}` : aria}
      data-nav={key}
      data-label={label}
      className={cn(
        'relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] leading-none font-semibold transition-colors',
        active ? 'text-primary' : 'text-muted-foreground active:text-foreground',
        focusRing,
      )}
      {...prefetchHandlers(href)}
    >
      <span className="relative grid h-8 w-14 place-items-center">
        {active && (
          <motion.span
            layoutId="nav-bar-active"
            transition={GLIDE}
            className="absolute inset-0 rounded-full bg-primary/[0.12] dark:bg-primary/[0.18]"
            aria-hidden="true"
          />
        )}
        <Icon weight={active ? 'duotone' : 'regular'} className="relative size-6" aria-hidden="true" />
        {/* Sits on the icon's corner, inside the tab, so the 56px target and the label are untouched. */}
        {badge && <BadgeDot badge={badge} className="absolute -top-1 right-1.5 ring-2 ring-card" />}
      </span>
      <span className="max-w-full truncate px-0.5 hi:py-0.5 hi:text-xs hi:leading-[1.35]">{label}</span>
    </Link>
  )
}

/**
 * "EN | हिं": one 44px button that switches the language for the whole app (saved on the device).
 * The active side is bold; screen readers hear the name and, as its description, the current language.
 */
function LanguageToggle() {
  const { locale, setLocale, t } = useT()
  const hi = locale === 'hi'
  return (
    <Button
      variant="ghost"
      className="h-11 min-w-11 gap-1 rounded-full px-2 text-[13px] font-medium min-[380px]:px-2.5 text-muted-foreground hover:text-foreground dark:hover:bg-muted"
      onClick={() => setLocale(hi ? 'en' : 'hi')}
      aria-label={t('lang.aria')}
      aria-describedby="lang-current"
      data-lang-toggle={locale}
    >
      {/* From 380px: both, the active one bold. Narrower phones keep the status pill readable by
          showing only the language a tap switches to. */}
      <span className="hidden items-center gap-1 min-[380px]:inline-flex">
        <span lang="en" className={cn(!hi && 'font-bold text-foreground')}>EN</span>
        <span aria-hidden="true" className="text-border">|</span>
        <span lang="hi" className={cn(hi && 'font-bold text-foreground')}>हिं</span>
      </span>
      <span lang={hi ? 'en' : 'hi'} className="font-semibold text-foreground min-[380px]:hidden">{hi ? 'EN' : 'हिं'}</span>
      <span id="lang-current" hidden>{t('lang.current')}</span>
    </Button>
  )
}

function ThemeToggle() {
  const { t } = useT()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  const Glyph = dark ? Sun : Moon
  return (
    <Button
      variant="ghost"
      className="size-11 rounded-full p-0 text-muted-foreground hover:text-foreground dark:hover:bg-muted"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={t('shell.darkMode')}
    >
      <Glyph className="size-5" aria-hidden="true" />
    </Button>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, tp, tr, intl } = useT()
  const pathname = usePathname()
  const router = useRouter()
  const [status, setStatus] = useState<PipelineStatus>({ kind: 'checking' })
  const [guideOpen, setGuideOpen] = useState(false)
  const [today, setToday] = useState('')
  const runner = useRef<((batch: string) => void) | null>(null)
  const pending = useRef<string | null>(null)

  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) setGuideOpen(true)
    } catch {}
  }, [])

  useEffect(() => {
    setToday(new Date().toLocaleDateString(intl, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
  }, [intl])

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

  const title = TITLES[pathname] ? t(TITLES[pathname]) : 'Nazar'

  // Nav badges, read on the device. The Alerts count clears on the Alerts page itself, which
  // records what is on screen as seen.
  const unseen = useUnseenAlerts()
  const flagged = useCabinetFlagged()
  const badges: Record<string, Badge | null> = {
    alerts: unseen > 0 && !isActive('/feed', pathname) ? { count: unseen, tone: 'new', label: tp('badge.newAlerts', unseen) } : null,
    cabinet: flagged > 0 ? { count: flagged, tone: 'flagged', label: tp('badge.flagged', flagged) } : null,
  }

  return (
    <ShellContext.Provider value={shell}>
      <div className="min-h-dvh bg-background text-foreground">
        <a
          href="#content"
          className={cn(
            'fixed top-3 left-3 z-50 -translate-y-[200%] rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background shadow-lg transition-transform focus:translate-y-0',
            focusRing,
          )}
          data-skip-link
        >
          {t('shell.skip')}
        </a>
        <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col overflow-y-auto border-r bg-background px-4 py-6 [scrollbar-width:none] lg:flex dark:bg-[color-mix(in_oklab,var(--background),var(--card)_35%)]">
          <Link href="/" aria-label={t('nav.home')} className={cn('inline-flex min-h-11 items-center self-start rounded-lg px-2', focusRing)}>
            <Logo />
          </Link>
          <MotionConfig reducedMotion="user">
            <nav className="mt-8 flex flex-col gap-5 [@media(max-height:759px)]:mt-5 [@media(max-height:759px)]:gap-3" aria-label={t('nav.main')}>
              {SECTIONS.map((section) => (
                <div key={section.id} className="flex flex-col gap-1">
                  <p id={`nav-${section.id}`} className="px-3 pb-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground/75 uppercase">
                    {t(section.title)}
                  </p>
                  <ul className="flex flex-col gap-0.5" aria-labelledby={`nav-${section.id}`}>
                    {section.items.map((n) => (
                      <li key={n.key}>
                        <RailItem entry={n} active={isActive(n.href, pathname)} badge={badges[n.key]} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </MotionConfig>
          <div className="mt-auto pt-6">
            <div className="rounded-2xl border bg-card p-3.5 shadow-xs">
              <p className="flex items-center gap-2.5 text-sm font-semibold">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary dark:bg-primary/15">
                  <LockSimple weight="duotone" className="size-[18px]" aria-hidden="true" />
                </span>
                {t('shell.private')}
              </p>
              {/* Short screens keep the headline only, so the rail never has to scroll. */}
              <p className="mt-2.5 text-xs leading-5 text-muted-foreground [@media(max-height:859px)]:sr-only">{t('shell.privateHint')}</p>
            </div>
            <div className="mt-4 px-1" data-author>
              <p className="text-xs text-muted-foreground">
                {tr('shell.builtBy', {
                  name: (
                    <a href={AUTHOR.site} target="_blank" rel="noreferrer noopener me" className="font-medium text-foreground underline-offset-2 hover:underline">
                      {AUTHOR.name}
                    </a>
                  ),
                })}
              </p>
              <SocialIcons only={['X', 'GitHub', 'LinkedIn']} className="-ml-3 mt-0.5" />
            </div>
          </div>
        </aside>

        <div className="mx-auto max-w-6xl px-4 pb-32 sm:px-6 lg:pb-12 lg:pl-[18.5rem] lg:pr-10">
          <header className="flex min-h-11 items-center justify-between gap-2 py-4 sm:gap-3 lg:py-7">
            <Link href="/" aria-label={t('nav.home')} className={cn('-ml-1 inline-flex min-h-11 shrink-0 items-center rounded-lg px-1 lg:hidden', focusRing)}>
              <Logo />
            </Link>
            {/* A quiet location line, not a heading: each page's own hero headline is its h1. */}
            <div className="hidden lg:block" data-shell-title>
              <p className="text-sm text-muted-foreground" suppressHydrationWarning>{today || ' '}</p>
              <p className="mt-0.5 text-[15px] font-medium tracking-tight">{title}</p>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <StatusPill status={status} />
              {/* Guide and theme share one capsule: same 44px height as the status pill, one outline. */}
              <div className="flex h-11 shrink-0 items-center rounded-full bg-card shadow-xs ring-1 ring-border ring-inset">
                <Button
                  variant="ghost"
                  className="h-11 min-w-11 gap-1.5 rounded-full px-3 text-sm font-semibold text-muted-foreground hover:text-foreground sm:pr-3.5 dark:hover:bg-muted"
                  onClick={() => setGuideOpen(true)}
                >
                  <Question className="size-5" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">{t('shell.guide')}</span>
                </Button>
                <span className="h-5 w-px bg-border" aria-hidden="true" />
                <LanguageToggle />
                <span className="h-5 w-px bg-border" aria-hidden="true" />
                <ThemeToggle />
              </div>
            </div>
          </header>

          <main id="content" tabIndex={-1} className="scroll-mt-4 focus:outline-none">
            {children}
          </main>

          <footer className="mt-12 flex flex-col gap-1 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>{t('shell.footer')}</p>
            <div className="flex flex-wrap items-center gap-x-3">
              <Link
                href="/ai"
                className={cn('-mx-1 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 font-medium text-primary underline-offset-2 hover:underline', focusRing)}
                data-mcp-link
              >
                <Robot weight="duotone" className="size-4" aria-hidden="true" /> {t('shell.useInAi')}
              </Link>
              <p>
                {tr('shell.copyright', {
                  year: new Date().getFullYear(),
                  name: (
                    <a href={AUTHOR.site} target="_blank" rel="noreferrer noopener me" className="font-medium text-foreground underline-offset-2 hover:underline">
                      {AUTHOR.name}
                    </a>
                  ),
                })}
              </p>
              <SocialIcons only={['X', 'GitHub', 'LinkedIn']} className="lg:hidden" />
            </div>
          </footer>
        </div>

        <MotionConfig reducedMotion="user">
          <nav
            aria-label={t('nav.mobile')}
            className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 mx-auto flex max-w-md gap-0.5 rounded-[1.375rem] border border-border/70 bg-card/80 p-1 shadow-[0_8px_30px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 lg:hidden dark:border-white/[0.08] dark:bg-card/75 dark:shadow-[0_10px_34px_-10px_rgb(0_0_0/0.7)]"
          >
            {BAR.map((n) => (
              <BarItem key={n.key} entry={n} active={isActive(n.href, pathname)} badge={badges[n.key]} />
            ))}
          </nav>
        </MotionConfig>

        <Onboarding open={guideOpen} onOpenChange={setGuideOpen} onTry={requestCheck} />
        <PerfRuntime />
      </div>
    </ShellContext.Provider>
  )
}
