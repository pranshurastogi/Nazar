'use client'

import { ArrowUpRight, Landmark, PenLine, SearchCheck } from 'lucide-react'

import SculptureHero from '@/components/ui/liquid-sculpture-hero'
import { serif } from '@/lib/fonts'
import { explorerAddress, PUBLISHER } from '@/lib/source/config'

// The top of /arkiv: what this page is, in one picture. Nazar's own mark is rebuilt from GPU
// particles that scatter under the cursor and settle back, the way scattered regulator notices
// settle into one public record. Without WebGL2, on a software renderer, or with reduced motion
// it is the still mark; the particles only animate while the hero is on screen.
//
// The hero's height is fixed in CSS (taller on phones so the mark has room above the copy), so
// nothing below it moves when the canvas, the image or the fonts arrive.

const MARK = '/brand/nazar-mark.png'

const STEPS = [
  { Icon: Landmark, title: 'A regulator publishes', text: 'CDSCO, a state drug controller or WHO posts a notice naming failed batches.' },
  { Icon: PenLine, title: 'Nazar writes it to Arkiv', text: 'Each batch becomes a public entity, signed by one publisher wallet and set to expire.' },
  { Icon: SearchCheck, title: 'Anyone can verify', text: 'Query Arkiv here or from your own code. No account and no Nazar server in between.' },
] as const

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function ArkivHero() {
  return (
    <section
      className="overflow-hidden rounded-3xl border bg-card [--arkiv-hero-h:620px] sm:[--arkiv-hero-h:clamp(520px,70svh,720px)] max-sm:[&_.sh-h1]:text-[clamp(34px,10vw,40px)]!"
      aria-labelledby="arkiv-hero-title"
      data-arkiv-hero
    >
      <SculptureHero
        src={MARK}
        darkSrc={MARK}
        mobileSrc={MARK}
        mobileDarkSrc={MARK}
        imageAlt="The Nazar mark, a capsule with an eye, built from particles"
        showNav={false}
        themeToggle={false}
        loadFonts={false}
        headingAs="h2"
        eyebrow="Arkiv directory · Tiramisu testnet"
        headline={'Every alert,\nverifiable by anyone.'}
        headlineAccent="verifiable by anyone."
        body="Nazar publishes each regulator alert as a public entity on Arkiv. Browse them below, see the exact query behind every view, or read Arkiv straight from your browser."
        primaryCta={{ label: 'Browse entities', href: '#arkiv-results' }}
        secondaryCta={{ label: 'See the query', href: '#arkiv-query' }}
        hint="Move across the mark"
        hintTouch="Drag across the mark"
        backdropText="arkiv"
        background="var(--card)"
        darkBackground="var(--card)"
        textColor="var(--foreground)"
        accentColor="var(--primary)"
        headingFont="var(--font-noto-sans), system-ui, sans-serif"
        bodyFont="var(--font-noto-sans), system-ui, sans-serif"
        accentFont={serif.style.fontFamily}
        height="var(--arkiv-hero-h)"
        sculptureScale={0.95}
        mobileSculptureScale={0.95}
        particleDensity={0.4}
        radius={190}
        intro
        style={{ backgroundImage: 'radial-gradient(110% 70% at 50% 0%, color-mix(in srgb, var(--primary) 9%, transparent), transparent 65%)' }}
      />
      <span id="arkiv-hero-title" className="sr-only">Arkiv directory: every Nazar alert, verifiable by anyone</span>

      <ol className="grid border-t sm:grid-cols-3" aria-label="How an alert reaches Arkiv">
        {STEPS.map(({ Icon, title, text }, i) => (
          <li key={title} className="flex gap-3 border-b p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:p-5 sm:last:border-r-0">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                <span className="mr-1.5 font-mono text-xs text-muted-foreground">{i + 1}</span>
                {title}
              </p>
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{text}</p>
              {i === 1 && (
                <a
                  href={explorerAddress(PUBLISHER)}
                  target="_blank"
                  rel="noreferrer"
                  className="-mx-1 mt-0.5 inline-flex min-h-11 items-center gap-1 rounded-md px-1 font-mono text-xs font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Publisher {short(PUBLISHER)} <ArrowUpRight className="size-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
