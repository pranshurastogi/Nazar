import type { MedicineInfo } from './schema.ts'

/**
 * Post-filter for model output. The prompt already forbids doses and the word "safe"; this is the
 * belt to that brace, because a reader acting on a dose we printed could be harmed. Any bullet that
 * looks like dosing, or that calls the medicine safe, is dropped rather than edited.
 */

const UNIT = String.raw`(?:mg|mcg|µg|g|gm|ml|mL|iu|IU|units?|tablets?|tabs?|capsules?|caps?|drops?|puffs?|sachets?|teaspoons?|tsp|tablespoons?|doses?)`
const DOSE_PATTERNS = [
  // "500 mg twice daily", "2 tablets every 6 hours", "10 ml three times"
  new RegExp(String.raw`\b\d+(?:[.,]\d+)?\s?${UNIT}\b[^.;]{0,40}\b(?:daily|a day|per day|twice|thrice|once|every|times|hourly|at night|morning|bedtime|qid|tid|bid|od)\b`, 'i'),
  // "take 1-2 tablets", "maximum of 4 g", "up to 8 tablets", "not more than 4000 mg"
  new RegExp(String.raw`\b(?:take|give|use|dose of|maximum(?: of)?|max\.?|up to|not (?:more|exceed)[a-z ]{0,12}than|no more than|exceed)\s+\d+(?:[.,]\d+)?(?:\s?-\s?\d+)?\s?${UNIT}\b`, 'i'),
  // "every 4-6 hours", "once a day", "3 times a day", "twice daily"
  /\bevery\s+\d+(?:\s?(?:-|to)\s?\d+)?\s*(?:hours?|hrs?|h)\b/i,
  /\b(?:once|twice|thrice|\d+\s*times)\s+(?:a|per|each|every)\s+(?:day|daily|week)\b/i,
  /\b(?:once|twice|thrice)\s+daily\b/i,
  /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|g|ml)\s?\/\s?kg\b/i,
]
const SAFE_WORD = /\bsafe(?:ly|st|r)?\b/i

export function looksLikeDosing(s: string): boolean {
  return DOSE_PATTERNS.some((re) => re.test(s))
}

export function saysSafe(s: string): boolean {
  return SAFE_WORD.test(s)
}

const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)
const allowed = (s: string) => s.length > 0 && !looksLikeDosing(s) && !saysSafe(s)

function list(items: string[], maxItems: number, maxLen = 160): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const s = clean(raw, maxLen)
    const k = s.toLowerCase()
    if (!allowed(s) || seen.has(k)) continue
    seen.add(k)
    out.push(s)
    if (out.length >= maxItems) break
  }
  return out
}

/** For one-sentence fields: keep the sentences that pass, else the fallback. */
function sentence(s: string, max: number, fallback: string): string {
  const kept = clean(s, 600)
    .split(/(?<=[.!?])\s+/)
    .filter(allowed)
    .join(' ')
  return kept ? clean(kept, max) : fallback
}

export interface GuardReport {
  info: MedicineInfo
  dropped: number
}

export function guardInfo(raw: MedicineInfo): GuardReport {
  const before = countItems(raw)
  const info: MedicineInfo = {
    name: sentence(raw.name, 120, 'This medicine'),
    genericNames: list(raw.genericNames, 6, 80),
    drugClass: sentence(raw.drugClass, 120, 'unknown'),
    whatItIsFor: list(raw.whatItIsFor, 4),
    howItWorks: sentence(raw.howItWorks, 240, ''),
    commonSideEffects: list(raw.commonSideEffects, 4),
    seriousWarnings: list(raw.seriousWarnings, 4),
    whoShouldBeCareful: list(raw.whoShouldBeCareful, 4),
    interactions: list(raw.interactions, 3),
    storage: sentence(raw.storage, 200, 'Store as printed on the pack, out of reach of children.'),
    prescriptionStatus: sentence(raw.prescriptionStatus, 120, 'unknown'),
    lookAlikeNames: list(raw.lookAlikeNames, 3, 60),
    confidence: raw.confidence,
  }
  // An answer stripped to almost nothing should not present itself as confident.
  if (info.whatItIsFor.length === 0 && info.confidence !== 'low') info.confidence = 'low'
  return { info, dropped: before - countItems(info) }
}

const countItems = (m: MedicineInfo) =>
  m.genericNames.length + m.whatItIsFor.length + m.commonSideEffects.length + m.seriousWarnings.length + m.whoShouldBeCareful.length + m.interactions.length + m.lookAlikeNames.length
