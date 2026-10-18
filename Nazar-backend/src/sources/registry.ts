import { env } from '../config/env.ts'
import { ConfigError } from '../lib/errors.ts'
import { blockedSources } from './blocked.ts'
import { cdscoOnline } from './cdsco-online.ts'
import { cdscoPdf } from './cdsco-pdf.ts'
import type { ManagedSource } from './common.ts'
import { curated } from './curated.ts'
import { mhFda } from './mh-fda.ts'
import { tnDc } from './tn-dc.ts'
import type { SourceAdapter } from './types.ts'
import { whoMpa } from './who-mpa.ts'

export type { ManagedSource } from './common.ts'

/** Order matters for display only: national structured feed first, then notices, states, WHO, curated. */
const SOURCES: ManagedSource[] = [cdscoOnline, cdscoPdf, tnDc, mhFda, whoMpa, curated, ...blockedSources]

export function allSources(): SourceAdapter[] {
  return [...SOURCES]
}

export function getSource(id: string): SourceAdapter | undefined {
  return SOURCES.find((s) => s.id === id)
}

/** Whether a source runs by default; why not (public wording) and how to switch it on (operators only). */
export function sourceStatus(s: SourceAdapter): { enabled: boolean; disabledReason: string | null; operatorNote: string | null } {
  const m = s as ManagedSource
  if (m.enabled !== false) return { enabled: true, disabledReason: null, operatorNote: null }
  return { enabled: false, disabledReason: m.disabledReason ?? 'Paused for now.', operatorNote: m.operatorNote ?? null }
}

/**
 * Sources to poll. An explicit list (argument, else NAZAR_SOURCES) selects exactly those ids and
 * may name a default-off source to switch it on; with no list, every source not marked disabled.
 */
export function enabledSources(ids?: string[]): SourceAdapter[] {
  const wanted = ids?.length ? ids : env().NAZAR_SOURCES
  if (!wanted.length) return SOURCES.filter((s) => sourceStatus(s).enabled)
  const unknown = wanted.filter((id) => !getSource(id))
  if (unknown.length) {
    throw new ConfigError(`unknown source id(s): ${unknown.join(', ')}; known: ${SOURCES.map((s) => s.id).join(', ')}`)
  }
  return SOURCES.filter((s) => wanted.includes(s.id))
}
