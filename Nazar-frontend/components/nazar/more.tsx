'use client'

import { useEffect, useState } from 'react'

import { loadSources, type SourceList } from '@/lib/source'
import { apiSummary } from '@/lib/source/directory'
import { Hero, type SummaryState } from './more/hero'
import { Journey } from './more/journey'
import { Mcp } from './more/mcp'
import { About, Privacy } from './more/privacy'
import { Proof } from './more/proof'
import { Settings } from './more/settings'
import { Sources } from './more/sources'
import { TocChips, TocRail, useActiveSection } from './more/toc'

// The More tab: how Nazar works (told as the life of one real alert), where its data comes
// from, how to verify it on Arkiv, how to use it from an AI assistant, what stays private,
// settings and credits. One page with in-page anchors, so every section can be linked to
// directly (/more#proof). The sections live in components/nazar/more/.

export function More() {
  const active = useActiveSection()
  const [sources, setSources] = useState<SourceList | null>(null)
  const [summary, setSummary] = useState<SummaryState>({ kind: 'loading' })
  const [now, setNow] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    loadSources(ctrl.signal).then(
      (l) => {
        if (ctrl.signal.aborted) return
        setNow(Date.now())
        setSources(l)
        // Count alerts only when the API answered; never a number Nazar could not read.
        if (l.source !== 'api') return setSummary({ kind: 'none' })
        apiSummary(ctrl.signal).then(
          (data) => !ctrl.signal.aborted && setSummary(data?.alerts && Number.isFinite(data.alerts.total) ? { kind: 'ok', data } : { kind: 'none' }),
          () => !ctrl.signal.aborted && setSummary({ kind: 'none' }),
        )
      },
      () => !ctrl.signal.aborted && setSummary({ kind: 'none' }),
    )
    return () => ctrl.abort()
  }, [])

  return (
    <div className="pt-2 md:pt-4" data-more>
      <Hero sources={sources} summary={summary} now={now} />
      <TocChips active={active} />
      <Journey />
      <div className="border-t lg:grid lg:grid-cols-[minmax(0,1fr)_10.5rem] lg:gap-12">
        <div className="lg:col-start-2 lg:row-start-1 lg:pt-16">
          <TocRail active={active} />
        </div>
        <div className="min-w-0 divide-y lg:col-start-1 lg:row-start-1">
          <Sources list={sources} now={now} />
          <Proof />
          <Mcp />
          <Privacy />
          <Settings />
          <About />
        </div>
      </div>
    </div>
  )
}
