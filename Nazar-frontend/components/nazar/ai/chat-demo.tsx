'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { ArrowUp, ArrowUpRight, Check, ChevronDown, Loader2, RotateCcw, Sparkles, Wrench } from 'lucide-react'

import { SentinelEye, type SentinelState } from '@/components/ui/sentinel-core'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { FETCHED_ON, SCENARIOS, STATE_TONE, type ReplyPara, type Scenario } from './data'

// The page's signature graphic: a person asks an assistant about a batch, the assistant calls
// Nazar's check_batch tool, the sentinel eye scans and lands on the answer, and the reply streams
// in. Every tool result and every fact in the reply comes from a real response of the live
// server (./fixtures). Each part of the transcript holds its space from the start and fades in,
// so nothing jumps. With reduced motion the finished conversation is shown, still.

const CHAR_MS = 26
const WORD_MS = 30

type Seg = { text: string; bold: boolean }
/** "**Flagged.** Batch …" → [{ Flagged., bold }, { Batch …, plain }] */
const segments = (p: ReplyPara): Seg[] => p.text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((t) => (t.startsWith('**') ? { text: t.slice(2, -2), bold: true } : { text: t, bold: false }))
const plain = (p: ReplyPara) => p.text.replace(/\*\*/g, '')
const wordCount = (paras: ReplyPara[]) => paras.reduce((n, p) => n + plain(p).split(/\s+/).filter(Boolean).length, 0)

/** When each beat of the conversation starts, in ms from the start of a run. */
function planFor(s: Scenario) {
  const type = 350
  const sent = type + s.question.length * CHAR_MS + 300
  const think = sent + 300
  const call = think + 900
  const result = call + 1500
  const reply = result + 650
  const words = wordCount(s.reply)
  const done = reply + words * WORD_MS + 250
  return { type, sent, think, call, result, reply, words, done }
}

// The transcript (question, tool result, reply) is the server's real English; only the frame around it is translated.

function Reply({ paras, shown }: { paras: ReplyPara[]; shown: number }) {
  let i = 0
  return (
    <div className="grid gap-2.5">
      {paras.map((p, pi) => (
        <p key={pi} className={cn(p.quiet ? 'text-[12.5px] leading-5 text-muted-foreground' : 'text-[14px] leading-6')}>
          {segments(p).map((seg, si) => {
            const parts = seg.text.split(/(\s+)/)
            const body = parts.map((w, wi) => {
              if (!w.trim()) return w
              const on = i++ < shown
              return (
                <span key={wi} className={cn('ai-word', on && 'is-on')}>
                  {w}
                </span>
              )
            })
            return seg.bold ? (
              <strong key={si} className="font-semibold" data-reply-verdict>
                {body}
              </strong>
            ) : (
              <span key={si}>{body}</span>
            )
          })}
        </p>
      ))}
    </div>
  )
}

function ToolResult({ text, on }: { text: string; on: boolean }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const long = text.length > 260
  return (
    <div className={cn('ai-reveal border-t border-dashed px-3 pt-2.5 pb-3', on && 'is-on')}>
      <p className="text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{t('ai.demo.result')}</p>
      <pre
        id="ai-tool-result"
        className={cn(
          'mt-1.5 font-mono text-[11.5px] leading-[1.6] break-words whitespace-pre-wrap text-foreground/85',
          long && !open && 'max-h-[6.4em] overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]',
        )}
        data-tool-result
      >
        {text}
      </pre>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="ai-tool-result"
          tabIndex={on ? 0 : -1}
          className="-mx-1 -mb-2 mt-0.5 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-xs font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {open ? t('ai.demo.showLess') : t('ai.demo.showFull')}
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export function ChatDemo() {
  const { t: tx, tr } = useT()
  const reduce = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [run, setRun] = useState(0)
  const [inView, setInView] = useState(false)
  const [t, setT] = useState(0)
  const s = SCENARIOS[active]
  const plan = useMemo(() => planFor(s), [s])

  // Start the first run once the demo is on screen, so nobody misses the beginning.
  useEffect(() => {
    const el = rootRef.current
    if (!el || inView) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setInView(true), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  // One clock per run; every beat is derived from it. Updates are quantised to keep renders cheap.
  useEffect(() => {
    if (reduce) return setT(Number.POSITIVE_INFINITY)
    setT(0)
    if (!inView) return
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const e = now - t0
      setT(Math.floor(e / 20) * 20)
      if (e < plan.done) raf = requestAnimationFrame(tick)
      else setT(Number.POSITIVE_INFINITY)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, run, inView, reduce, plan])

  const typed = t < plan.type ? 0 : Math.min(s.question.length, Math.floor((t - plan.type) / CHAR_MS))
  const sent = t >= plan.sent
  const thinking = t >= plan.think && t < plan.call
  const calling = t >= plan.call
  const resulted = t >= plan.result
  const shown = t < plan.reply ? 0 : Math.min(plan.words, Math.floor((t - plan.reply) / WORD_MS) + 1)
  const done = t >= plan.done
  const phase = done ? 'done' : t >= plan.reply ? 'reply' : resulted ? 'result' : calling ? 'calling' : thinking ? 'thinking' : typed ? 'typing' : 'idle'
  const eye: SentinelState = !calling ? 'idle' : !resulted ? 'scanning' : s.id
  const tone = STATE_TONE[s.id]

  const pick = (i: number) => {
    setActive(i)
    setRun((r) => r + 1)
  }
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const n = SCENARIOS.length
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (to < 0) return
    e.preventDefault()
    pick(to)
    document.getElementById(`ai-demo-tab-${SCENARIOS[to].id}`)?.focus()
  }

  const steps = [
    { label: tx('ai.demo.step1'), on: sent },
    { label: tx('ai.demo.step2', { code: 'check_batch' }), on: calling },
    { label: tx('ai.demo.step3'), on: resulted },
    { label: tx(`ai.demo.step4.${s.id}`), on: done },
  ]
  const caption = !calling ? tx('ai.demo.watching') : !resulted ? tx('ai.demo.checking', { batch: s.batch }) : tx(`ai.demo.word.${s.id}`)

  return (
    <div ref={rootRef} className="overflow-hidden rounded-3xl border bg-card shadow-[0_1px_0_0_rgb(0_0_0/0.02),0_24px_48px_-32px_rgb(15_23_42/0.25)]" data-chat-demo data-scenario={s.id} data-phase={phase}>
      <div role="tablist" aria-label={tx('ai.demo.tabsAria')} className="grid grid-cols-3 border-b bg-muted/30">
        {SCENARIOS.map((sc, i) => {
          const on = i === active
          return (
            <button
              key={sc.id}
              id={`ai-demo-tab-${sc.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="ai-demo-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => pick(i)}
              onKeyDown={(e) => onTabKey(e, i)}
              data-chat-tab={sc.id}
              className={cn(
                'relative flex min-h-14 flex-col items-start justify-center gap-0.5 border-r px-3 py-2 text-left transition-colors last:border-r-0 hover:bg-muted/60 focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-2 sm:px-5',
                on && 'bg-card hover:bg-card',
              )}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <span className={cn('size-2 shrink-0 rounded-full', STATE_TONE[sc.id].dot)} aria-hidden="true" />
                {tx(`ai.demo.tab.${sc.id}`)}
              </span>
              <span className="font-mono text-[11.5px] text-muted-foreground">{sc.batch}</span>
              {on && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_15.5rem]">
        {/* The watcher: a compact strip on phones, a side panel on wide screens. */}
        <aside className="flex items-center gap-4 border-b px-4 py-3 sm:px-5 lg:sticky lg:top-4 lg:order-2 lg:flex-col lg:items-stretch lg:gap-0 lg:self-start lg:border-b-0 lg:px-6 lg:py-7" aria-label={tx('ai.demo.eyeAria')} data-demo-eye>
          <div className="flex shrink-0 justify-center">
            <SentinelEye state={eye} className="w-20 lg:w-44" />
          </div>
          <div className="min-w-0 lg:mt-3 lg:text-center">
            <p className={cn('text-[15px] font-semibold tracking-tight transition-colors', resulted ? tone.text : 'text-foreground')} aria-live="polite" data-demo-caption>
              {caption}
            </p>
            <p className="text-xs text-muted-foreground lg:hidden">
              {steps.filter((x) => x.on).length}/4 · {(steps.findLast((x) => x.on) ?? steps[0]).label}
            </p>
          </div>
          <ol className="mt-6 hidden gap-3 border-t pt-5 lg:grid" aria-label={tx('ai.demo.stepsAria')}>
            {steps.map((st, i) => (
              <li key={i} className={cn('flex items-start gap-2.5 text-[12.5px] leading-5 transition-colors', st.on ? 'text-foreground' : 'text-muted-foreground/70')}>
                <span
                  className={cn(
                    'mt-px grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[10px] transition-colors',
                    st.on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
                  )}
                  aria-hidden="true"
                >
                  {st.on ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                {i === 1 ? <span>{tr('ai.demo.step2', { code: <code className="font-mono text-[11.5px] font-semibold">check_batch</code> })}</span> : st.label}
              </li>
            ))}
          </ol>
          <p className="hidden pt-6 text-[11px] leading-4 text-muted-foreground lg:block">{tx('ai.demo.recorded', { date: FETCHED_ON })}</p>
        </aside>

        <div className="flex min-w-0 flex-col lg:order-1 lg:border-r">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-1.5 sm:px-5">
            <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <span className="truncate">
                {tx('ai.demo.yourAssistant')}
                <span className="font-medium text-foreground">{tx('ai.demo.connected')}</span>
              </span>
            </p>
            <button
              type="button"
              onClick={() => setRun((r) => r + 1)}
              className="-mr-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              data-demo-replay
            >
              <RotateCcw className="size-3.5" aria-hidden="true" /> {tx('ai.demo.replay')}
            </button>
          </div>

          <div id="ai-demo-panel" role="tabpanel" aria-labelledby={`ai-demo-tab-${s.id}`} className="grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 px-4 py-5 sm:px-6 sm:py-6" data-demo-transcript>
            {/* The person */}
            <div className={cn('ai-reveal flex justify-end', sent && 'is-on')}>
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[14px] leading-6 text-primary-foreground" data-chat-question>
                {s.question}
              </p>
            </div>

            {/* The assistant */}
            <div className="flex min-w-0 items-start gap-3">
              <span className={cn('ai-reveal grid size-8 shrink-0 place-items-center rounded-full border bg-muted text-foreground', (thinking || calling) && 'is-on')} aria-hidden="true">
                <Sparkles className="size-4" />
              </span>
              <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3">
                <div className="relative">
                  {thinking && (
                    <span className="ai-dots absolute top-2.5 left-1 flex gap-1 text-muted-foreground" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  )}
                  <div className={cn('ai-reveal overflow-hidden rounded-xl border bg-muted/35', calling && 'is-on', calling && !resulted && 'ai-calling')} data-tool-call data-tool="check_batch">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                      <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <span className="text-xs text-muted-foreground">{resulted ? 'Called' : 'Calling'}</span>
                      <code className="font-mono text-[12px] font-semibold">check_batch</code>
                      <code className="min-w-0 rounded-md bg-card px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground ring-1 ring-border" data-tool-args>
                        {`{ "batch": "${s.batch}" }`}
                      </code>
                      <span className="ml-auto">
                        {resulted ? (
                          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold', tone.pill)} data-tool-state>
                            {s.id}
                          </span>
                        ) : (
                          <Loader2 className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={tx('ai.demo.waiting')} />
                        )}
                      </span>
                    </div>
                    <ToolResult key={s.id} text={s.toolText} on={resulted} />
                  </div>
                </div>

                <div className={cn('rounded-2xl rounded-tl-md border bg-background/60 px-4 py-3', shown ? 'ai-reveal is-on' : 'ai-reveal')} data-chat-reply data-state={s.id}>
                  <Reply paras={s.reply} shown={shown} />
                  {s.links.length > 0 && (
                    <div className={cn('ai-reveal mt-3 flex flex-wrap gap-2', done && 'is-on')} data-reply-links>
                      {s.links.map((l) => (
                        <a
                          key={l.href}
                          href={l.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          tabIndex={done ? 0 : -1}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-3.5 text-[13px] font-medium transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                          data-reply-link
                        >
                          {l.label}
                          <span className="font-mono text-[11px] text-muted-foreground">{l.detail}</span>
                          <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* A pretend composer: the question is typed here first. */}
          <div className="border-t px-4 py-3 sm:px-5" aria-hidden="true">
            <div className="flex min-h-12 items-center gap-3 rounded-2xl border bg-background/70 py-2 pr-2 pl-4">
              <p className={cn('min-w-0 flex-1 text-[13.5px] leading-5', !typed || sent ? 'text-muted-foreground' : 'text-foreground')}>
                {typed && !sent ? (
                  <>
                    {s.question.slice(0, typed)}
                    <span className="ai-caret" />
                  </>
                ) : (
                  tx('ai.demo.composer')
                )}
              </p>
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-full transition-colors', typed && !sent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                <ArrowUp className="size-4" />
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="border-t px-4 py-2.5 text-[11px] leading-4 text-muted-foreground lg:hidden">{tx('ai.demo.recorded', { date: FETCHED_ON })}</p>
    </div>
  )
}
