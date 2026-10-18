'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { AnimatePresence, LayoutGroup, motion, useScroll, useSpring } from 'motion/react'
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Bot,
  CircleHelp,
  Database,
  FileText,
  History,
  Layers,
  ScanText,
  Search,
  SearchCheck,
  Smartphone,
  TriangleAlert,
} from 'lucide-react'

import { serif } from '@/lib/fonts'
import { checkPath } from '@/lib/share'
import { explorerAddress, PUBLISHER } from '@/lib/source'
import { cn } from '@/lib/utils'
import { SCENES, STORY } from './scenes'
import { PROSE, Section } from './shared'
import './journey.css'

// How it works, told as the life of one real alert in six chapters.
//
// Desktop (lg+): the chapters scroll on the left while a sticky stage on the right shows the
// alert at the current step, with a chain-of-custody rail that lights up as you go. The batch
// token is a shared layout element, so it visibly travels from the notice to the phone.
// Phones and tablets: a vertical stepper, each chapter with its picture inline, revealed as it
// scrolls in. Reduced motion: the same stepper at every width, fully static.

const ANSWERS = [
  { Icon: TriangleAlert, label: 'Flagged', cls: 'bg-flagged text-white dark:text-background', body: 'A regulator named this exact batch as failed, fake or contaminated. Stop using it and keep the pack.' },
  { Icon: History, label: 'Retracted', cls: 'bg-caution text-white dark:text-background', body: 'An alert on this batch was withdrawn or corrected. The original stays on record.' },
  { Icon: Search, label: 'No alert found', cls: 'bg-quiet text-white dark:text-background', body: 'No regulator has published an alert for this batch yet. It is not a safety certificate.' },
  { Icon: CircleHelp, label: "Can't tell", cls: 'bg-caution text-white dark:text-background', body: 'The batch could not be read, or it is one character away from a batch with an alert. Re-read the pack before trusting it.' },
]

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

type Chapter = { kicker: string; Icon: typeof FileText; title: string; body: React.ReactNode; specs?: React.ReactNode[]; extra?: React.ReactNode }

const CHAPTERS: Chapter[] = [
  {
    kicker: 'Source',
    Icon: FileText,
    title: 'A regulator publishes a notice',
    body: (
      <>
        On {STORY.noticeDate} the {STORY.authority} issued {STORY.noticeNo}. It named {STORY.brand} cough syrup, batch {STORY.batch}, made by {STORY.maker}, contaminated with
        diethylene glycol at {STORY.finding}. CDSCO and state drug controllers publish notices like this every month, as PDFs and web pages.
      </>
    ),
    extra: STORY.noticeUrl ? (
      <a href={STORY.noticeUrl} target="_blank" rel="noreferrer noopener" className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
        Read the WHO notice <ArrowUpRight className="size-4" aria-hidden="true" />
      </a>
    ) : null,
  },
  {
    kicker: 'Read',
    Icon: ScanText,
    title: 'Nazar reads it',
    body: 'Nazar downloads the notice, fingerprints it and reads every row. If a row fails a check, it is rejected, never guessed.',
    specs: [
      <>Fetched and fingerprinted with SHA-256, so anyone can prove it is the same file</>,
      <>Text layer first, OCR for scanned pages</>,
      <>AI help only for messy tables, and every field must appear in the source text</>,
      <>A row with a missing or unreadable batch is dropped</>,
    ],
  },
  {
    kicker: 'Case',
    Icon: Layers,
    title: 'It becomes a case',
    body: (
      <>
        The batch becomes a match key, so &ldquo;SR 13&rdquo; and &ldquo;sr-13&rdquo; find it too. A batch one character away, like 5R-13, gets &ldquo;Can&apos;t tell&rdquo;
        instead of a guess. Fixed rules score severity from 1 to 5.
      </>
    ),
    specs: [
      <>
        Normalised key: <code className="font-mono text-foreground">{STORY.batch}</code> → <code className="font-mono text-foreground">{STORY.key}</code>
      </>,
      <>Look-alikes folded: O and 0, I and 1, S and 5, B and 8</>,
      <>Severity by versioned rules, not by AI. A toxic glycol is 5; a children&apos;s syrup turns on Child Shield</>,
    ],
  },
  {
    kicker: 'Publish',
    Icon: Blocks,
    title: 'It is written to Arkiv',
    body: "Nazar writes the alert to Arkiv as a public entity, signed by its publisher wallet and linked to the notice. It is read-only, so nobody can edit it. A correction is a new retraction entity, and the original stays on record.",
    specs: [
      <>
        Signed by one wallet,{' '}
        <a href={explorerAddress(PUBLISHER)} target="_blank" rel="noreferrer noopener" className="font-mono font-medium text-primary underline-offset-4 hover:underline">
          {short(PUBLISHER)}
        </a>
      </>,
      <>Expires 180 days after the batch does, while it may still be on shelves</>,
      <>Anyone can extend an alert&apos;s life; nobody can change it</>,
    ],
  },
  {
    kicker: 'Check',
    Icon: Smartphone,
    title: 'You check your batch',
    body: 'Type or scan the batch printed on the pack. Nazar gives one of four honest answers, and colour, icon and words always agree. It never says a medicine is fine to use.',
    extra: (
      <div className="mt-5">
        <h5 className="text-sm font-semibold">Four honest answers</h5>
        <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 lg:motion-reduce:grid-cols-2" data-answers>
          {ANSWERS.map((a) => (
            <li key={a.label} className="flex items-start gap-3 rounded-xl border bg-card p-3">
              <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', a.cls)}>
                <a.Icon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{a.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{a.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    kicker: 'Verify',
    Icon: SearchCheck,
    title: 'Anyone can verify',
    body: "You don't have to trust Nazar. Open the same entity on the Arkiv page, look up the publisher wallet in the explorer, or ask an AI assistant through Nazar's MCP server. Every path ends at the regulator's own notice.",
    extra: (
      <div className="mt-5 flex flex-wrap gap-2" data-verify-links>
        <Link href={`/arkiv?batch=${encodeURIComponent(STORY.batch)}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted">
          <Database className="size-4 text-primary" aria-hidden="true" /> {STORY.batch} on Arkiv
        </Link>
        <a href="#mcp" className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted">
          <Bot className="size-4 text-primary" aria-hidden="true" /> Ask your AI assistant
        </a>
        <Link href={checkPath(STORY.batch)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
          Check {STORY.batch} now <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    ),
  },
]

const RAIL_ICONS = CHAPTERS.map((c) => c.Icon)

const REDUCE = '(prefers-reduced-motion: reduce)'
const onReduceChange = (cb: () => void) => {
  const m = window.matchMedia(REDUCE)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
/** Reduced motion, hydration-safe: false on the server and during hydration, then the real value. */
const usePrefersReducedMotion = () =>
  useSyncExternalStore(
    onReduceChange,
    () => window.matchMedia(REDUCE).matches,
    () => false,
  )

/** The picture for one chapter, framed for the inline (phone) layout. */
function InlineScene({ i }: { i: number }) {
  const Scene = SCENES[i]
  return (
    <div className="hw-reveal hw-dots mt-6 rounded-2xl border bg-muted/30 px-3 py-5 sm:px-5 lg:hidden lg:motion-reduce:block lg:motion-reduce:max-w-md" aria-hidden="true" data-inline-scene={i}>
      <Scene live={false} />
    </div>
  )
}

/** The sticky stage on desktop: rail, the current scene, and a caption. Decorative: the chapter text says it all. */
function Stage({ active }: { active: number }) {
  const Scene = SCENES[active]
  const n = CHAPTERS.length
  return (
    <div className="overflow-hidden rounded-3xl border bg-card shadow-[0_30px_60px_-40px_rgb(10_21_48/0.35)]" aria-hidden="true" data-stage data-active={active}>
      <div className="border-b px-5 pt-4 pb-5">
        <div className="flex items-center justify-between text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
          <span>Chain of custody</span>
          <span className="font-mono tracking-normal">
            {active + 1} / {n}
          </span>
        </div>
        <div className="relative mt-4 flex items-center justify-between">
          <span className="absolute inset-x-4 top-1/2 h-px -translate-y-1/2 bg-border" />
          <motion.span
            className="absolute top-1/2 left-4 h-0.5 origin-left -translate-y-1/2 rounded-full bg-primary"
            style={{ width: 'calc(100% - 2rem)' }}
            initial={false}
            animate={{ scaleX: active / (n - 1) }}
            transition={{ type: 'spring', stiffness: 160, damping: 26 }}
          />
          {RAIL_ICONS.map((Icon, i) => (
            <span
              key={i}
              data-node={i}
              data-lit={i <= active}
              className={cn(
                'relative grid size-8 place-items-center rounded-full border bg-card text-muted-foreground transition-[background-color,color,border-color,box-shadow] duration-300',
                i <= active && 'border-primary bg-primary text-primary-foreground',
                i === active && 'shadow-[0_0_0_5px_color-mix(in_srgb,var(--primary)_18%,transparent)]',
              )}
            >
              <Icon className="size-3.5" />
            </span>
          ))}
        </div>
      </div>
      <div className="hw-dots relative grid h-[27rem] place-items-center bg-muted/30">
        <LayoutGroup>
          <AnimatePresence initial={false}>
            <motion.div
              key={active}
              className="absolute inset-0 grid place-items-center p-5"
              initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
              transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
            >
              <Scene live />
            </motion.div>
          </AnimatePresence>
        </LayoutGroup>
      </div>
      <div className="flex items-baseline gap-2 border-t px-5 py-3.5">
        <span className={cn(serif.className, 'text-xl leading-none text-primary')}>{active + 1}</span>
        <p className="min-w-0 truncate text-[13px] font-medium">{CHAPTERS[active].title}</p>
      </div>
    </div>
  )
}

export function Journey() {
  const reduce = usePrefersReducedMotion()
  const [active, setActive] = useState(0)
  const [ready, setReady] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  const { scrollYProgress } = useScroll({ target: listRef, offset: ['start 55%', 'end 55%'] })
  const fill = useSpring(scrollYProgress, { stiffness: 150, damping: 30, restDelta: 0.001 })

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    setReady(true)
    const items = [...list.querySelectorAll<HTMLElement>('[data-chapter]')]
    // The chapter crossing a band just above the middle of the screen is the current one.
    const current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.chapter))
      },
      { rootMargin: '-40% 0px -50% 0px' },
    )
    // Each chapter is revealed once, the first time it scrolls in.
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          ;(e.target as HTMLElement).dataset.seen = '1'
          reveal.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    for (const el of items) {
      current.observe(el)
      reveal.observe(el)
    }
    return () => {
      current.disconnect()
      reveal.disconnect()
    }
  }, [])

  return (
    <Section
      id="how"
      kicker="How it works"
      title={
        <>
          The life of <span className={cn(serif.className, 'font-normal tracking-[-0.01em] text-primary')}>one alert</span>
        </>
      }
      intro={`Follow ${STORY.brand} batch ${STORY.batch} from a WHO notice to your phone. Every alert in Nazar takes the same six steps, and you can check each one yourself.`}
      className="pt-10 sm:pt-14"
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-10 lg:motion-reduce:block" data-journey data-hw-ready={ready ? '' : undefined}>
        <ol ref={listRef} className="relative" aria-label="The life of one alert, in six chapters">
          {/* The rail: a quiet line, filled in primary as you scroll. Static with reduced motion. */}
          <span className="absolute top-2 bottom-2 left-[1.375rem] w-px bg-border" aria-hidden="true" />
          {!reduce && (
            <motion.span className="absolute top-2 bottom-2 left-[1.3125rem] w-[3px] origin-top rounded-full bg-primary motion-reduce:hidden" style={{ scaleY: fill }} aria-hidden="true" />
          )}
          {CHAPTERS.map((c, i) => {
            const lit = reduce || i <= active
            return (
              <li
                key={c.title}
                data-chapter={i}
                data-current={!reduce && i === active ? '' : undefined}
                aria-labelledby={`how-ch-${i}`}
                className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 pb-14 last:pb-2 sm:gap-x-6 lg:min-h-[70vh] lg:content-center lg:pb-0 lg:last:pb-0 lg:motion-reduce:min-h-0 lg:motion-reduce:pb-16"
              >
                <span
                  className={cn(
                    'relative z-[1] grid size-11 place-items-center self-start rounded-full border-2 bg-background text-[1.375rem] leading-none transition-colors duration-300',
                    serif.className,
                    lit ? 'border-primary text-primary' : 'border-border text-muted-foreground',
                    !reduce && i === active && 'bg-primary text-primary-foreground',
                  )}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 pt-1">
                  <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
                    <c.Icon className="size-3.5 text-primary" aria-hidden="true" />
                    Chapter {i + 1} · {c.kicker}
                  </p>
                  <h4 id={`how-ch-${i}`} className="mt-2 text-xl leading-snug font-semibold tracking-[-0.02em] sm:text-[1.375rem]" data-chapter-title>
                    {c.title}
                  </h4>
                  <p className={cn(PROSE, 'mt-2.5 text-[15px] leading-7 text-pretty text-muted-foreground')}>{c.body}</p>
                  {c.specs && (
                    <ul className={cn(PROSE, 'mt-4 grid gap-1.5 text-[13px] leading-5 text-muted-foreground')}>
                      {c.specs.map((s, k) => (
                        <li key={k} className="flex gap-2.5">
                          <span className="mt-[0.45rem] h-px w-3 shrink-0 bg-primary" aria-hidden="true" />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.extra}
                  <InlineScene i={i} />
                </div>
              </li>
            )
          })}
        </ol>
        {!reduce && (
          <div className="hidden lg:block lg:motion-reduce:hidden">
            <div className="sticky top-[max(1.5rem,calc(50vh-19rem))]">
              <Stage active={active} />
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}
