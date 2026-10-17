import { isPlausibleBatch } from '../domain/batch.ts'
import type { PublishTier } from '../domain/types.ts'
import { stableId } from '../lib/hash.ts'

/**
 * A case is one physical batch, however many notices mention it (CDSCO list, the state's own
 * list, a WHO alert). Keyed on the batch plus the brand (or, when no brand is printed, the
 * maker), so "SR-13" from Sresan and an unrelated "SR-13" from another firm stay apart.
 */
export function caseIdFor(batchKey: string, discriminator: string): string {
  return stableId('case', batchKey, discriminator || 'unknown')
}

export const TIER_AUTO = 0.9
export const TIER_MACHINE = 0.6

/** Batch-level alerts the app may show as a flag. Everything else waits for a curator. */
export const PUBLISHABLE_TIERS: readonly PublishTier[] = ['auto', 'machine_read']
export const isPublishableTier = (t: PublishTier | string) => (PUBLISHABLE_TIERS as readonly string[]).includes(t)

/** True when the extractor itself doubted the batch cell, or the batch does not look like one. */
export function batchUncertain(batch: string, issues: string[]): boolean {
  return !isPlausibleBatch(batch) || issues.some((i) => /batch/i.test(i))
}

/**
 * ≥ 0.90 auto, 0.60–0.89 machine_read (shown with a "machine-read" label),
 * < 0.60 with an uncertain batch → drug_level (never a batch flag), < 0.60 otherwise → curator_only.
 */
export function tierFor(confidence: number, uncertainBatch: boolean): PublishTier {
  if (confidence >= TIER_AUTO) return 'auto'
  if (confidence >= TIER_MACHINE) return 'machine_read'
  return uncertainBatch ? 'drug_level' : 'curator_only'
}
