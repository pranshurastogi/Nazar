import { env, type Env } from '../config/env.ts'
import { matchKey } from '../domain/batch.ts'
import { NazarError, errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { isPublishableTier } from '../resolve/case.ts'
import type { Ledger } from '../storage/ledger.ts'
import { MedicineCache, cacheKey } from './cache.ts'
import { guardInfo } from './guard.ts'
import { ClientLimiter, DEFAULT_CLIENT_LIMITS, DailyCap, hashIp, randomSalt, type ClientLimits } from './limits.ts'
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt.ts'
import { AnthropicProvider } from './providers/anthropic.ts'
import { GeminiProvider } from './providers/gemini.ts'
import { ProviderError, type MedicineProvider } from './providers/types.ts'
import { DISCLAIMER, MedicineInfo, type ExplainInput, type ExplainResponse } from './schema.ts'

/**
 * "About this medicine": general reference text from an LLM, combined with Nazar's own alert count.
 * Order of work per request: cache (free, unlimited) → per-client limit → global daily cap → LLM.
 * Only the hashed client IP and the outcome are logged.
 */

const log = child('medicine')

export class ExplainError extends NazarError {
  constructor(
    readonly status: 429 | 502 | 503,
    code: string,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message, code)
  }
}

/** Picks the configured provider, or null when it has no key (the endpoint then answers 503 LLM_DISABLED). */
export function providerFromEnv(e: Env = env()): MedicineProvider | null {
  if (!e.NAZAR_LLM_ENABLED) return null
  if (e.NAZAR_LLM_PROVIDER === 'anthropic') return e.ANTHROPIC_API_KEY ? new AnthropicProvider({ apiKey: e.ANTHROPIC_API_KEY, model: e.NAZAR_LLM_MODEL }) : null
  return e.GEMINI_API_KEY ? new GeminiProvider({ apiKey: e.GEMINI_API_KEY, model: e.NAZAR_GEMINI_MODEL, fallbackModel: e.NAZAR_GEMINI_FALLBACK_MODEL || undefined }) : null
}

const EMPTY: MedicineInfo = {
  name: '',
  genericNames: [],
  drugClass: 'unknown',
  whatItIsFor: [],
  howItWorks: '',
  commonSideEffects: [],
  seriousWarnings: [],
  whoShouldBeCareful: [],
  interactions: [],
  storage: '',
  prescriptionStatus: 'unknown',
  lookAlikeNames: [],
  confidence: 'low',
}

/**
 * Validates model output against the schema. A near miss (a field missing or of the wrong type) is
 * repaired with empty defaults and forced to low confidence; anything else is rejected.
 */
export function validateAnswer(raw: unknown): MedicineInfo | null {
  const direct = MedicineInfo.safeParse(raw)
  if (direct.success) return direct.data
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name.trim()) return null
  const repaired: Record<string, unknown> = { ...EMPTY }
  for (const [k, v] of Object.entries(EMPTY)) {
    const got = o[k]
    if (Array.isArray(v)) repaired[k] = Array.isArray(got) ? got.filter((x): x is string => typeof x === 'string') : []
    else if (typeof got === 'string') repaired[k] = got
  }
  repaired.confidence = 'low'
  const r = MedicineInfo.safeParse(repaired)
  return r.success ? r.data : null
}

/** "Paracetamol IP 500 mg" → "Paracetamol"; the name part of an ingredient line, for searching alerts. */
export function genericOf(line: string): string {
  return line
    .replace(/^(?:each|every)\b[^:]*:\s*/i, '')
    .split(/\d/)[0]!
    .replace(/\b(?:i\.?p|b\.?p|u\.?s\.?p|ph\.?\s?eur)\b\.?/gi, ' ')
    .replace(/[^A-Za-z\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface ExplainerDeps {
  ledger: Ledger
  /** null = LLM disabled; undefined = from env. */
  provider?: MedicineProvider | null
  now?: () => number
  limits?: ClientLimits
  dailyCap?: number
  salt?: string
}

export class MedicineExplainer {
  private readonly cache: MedicineCache
  private readonly provider: MedicineProvider | null
  private readonly now: () => number
  private readonly clients: ClientLimiter
  private readonly cap: DailyCap
  private readonly salt: string
  private readonly inflight = new Map<string, Promise<{ info: MedicineInfo; model: string }>>()

  constructor(private readonly deps: ExplainerDeps) {
    const e = env()
    this.cache = new MedicineCache(deps.ledger.db)
    this.provider = deps.provider === undefined ? providerFromEnv(e) : deps.provider
    this.now = deps.now ?? Date.now
    this.clients = new ClientLimiter(deps.limits ?? DEFAULT_CLIENT_LIMITS)
    this.cap = new DailyCap(deps.dailyCap ?? e.NAZAR_LLM_DAILY_CAP)
    this.salt = deps.salt ?? e.NAZAR_IP_SALT ?? randomSalt()
  }

  get enabled() {
    return this.provider !== null
  }

  async explain(input: ExplainInput, ip: string): Promise<ExplainResponse> {
    const who = hashIp(ip, this.salt)
    const key = cacheKey(input)
    const now = this.now()

    const hit = this.cache.get(key, now)
    if (hit) {
      log.info({ client: who, outcome: 'cache_hit' }, 'medicine explain')
      return this.respond(input, hit.info, hit.model, true, hit.createdMs)
    }

    if (!this.provider) {
      log.info({ client: who, outcome: 'disabled' }, 'medicine explain')
      throw new ExplainError(503, 'LLM_DISABLED', 'Medicine information is not available on this server.')
    }

    // A second identical request while the first is still running shares its answer and its cost.
    const running = this.inflight.get(key)
    if (running) {
      const r = await running
      return this.respond(input, r.info, r.model, true, now)
    }

    const capWait = this.cap.wait(now)
    if (capWait > 0) {
      log.warn({ client: who, outcome: 'daily_cap' }, 'medicine explain')
      throw new ExplainError(429, 'DAILY_CAP', 'Nazar has answered as many medicine questions as it can today. Please try again tomorrow.', capWait)
    }
    const limit = this.clients.take(who, now)
    if (!limit.ok) {
      log.warn({ client: who, outcome: `rate_limited_${limit.window}` }, 'medicine explain')
      const msg = limit.window === 'day' ? "You've asked about many medicines today. Please try again tomorrow." : 'Too many questions in a short time. Please wait a minute and try again.'
      throw new ExplainError(429, 'RATE_LIMITED', msg, limit.retryAfterSec)
    }
    this.cap.take(now)

    const job = this.ask(input)
    this.inflight.set(key, job)
    try {
      const r = await job
      this.cache.put(key, r.info, r.model, this.now())
      log.info({ client: who, outcome: 'answered', provider: this.provider.id }, 'medicine explain')
      return this.respond(input, r.info, r.model, false, this.now())
    } catch (err) {
      log.warn({ client: who, outcome: 'upstream_error', err: errorMessage(err) }, 'medicine explain')
      if (err instanceof ExplainError) throw err
      throw new ExplainError(502, 'LLM_FAILED', 'Could not get medicine information right now. Please try again later.')
    } finally {
      this.inflight.delete(key)
    }
  }

  private async ask(input: ExplainInput): Promise<{ info: MedicineInfo; model: string }> {
    const provider = this.provider!
    let raw: unknown
    try {
      raw = await provider.generate({ system: SYSTEM_PROMPT, user: buildUserPrompt(input) })
    } catch (err) {
      throw err instanceof ProviderError ? err : new ProviderError(errorMessage(err))
    }
    const valid = validateAnswer(raw)
    if (!valid) throw new ExplainError(502, 'LLM_BAD_OUTPUT', 'Could not get medicine information right now. Please try again later.')
    return { info: guardInfo(valid).info, model: `${provider.id}:${provider.model}` }
  }

  private respond(input: ExplainInput, info: MedicineInfo, model: string, cached: boolean, at: number): ExplainResponse {
    const m = this.nazarMatches(input, info)
    return {
      medicine: { ...info, notMedicalAdvice: true },
      disclaimer: DISCLAIMER,
      aiGenerated: true,
      nazarAlerts: m.brandAlerts,
      brandName: m.brandName,
      brandAlerts: m.brandAlerts,
      ingredientName: m.ingredientName,
      ingredientAlerts: m.ingredientAlerts,
      nazarQuery: m.brandName ?? m.ingredientName,
      batchAlerts: input.batch ? this.deps.ledger.alertsByBatchKey(matchKey(input.batch)).filter((r) => isPublishableTier(r.record.tier)).length : 0,
      cached,
      model,
      generatedAt: new Date(at).toISOString(),
    }
  }

  /**
   * Two separate counts, never blended: alerts for THIS brand (precise), and alerts for other
   * products that merely share an ingredient (context). Paracetamol alone matches well over a
   * hundred alerts; folding those into one "alerts for this medicine" number would make an
   * ordinary strip look dangerous.
   */
  private nazarMatches(input: ExplainInput, info: MedicineInfo): { brandName: string | null; brandAlerts: number; ingredientName: string | null; ingredientAlerts: number } {
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
    const generics = [...(input.composition ?? []).map(genericOf), ...info.genericNames.map(genericOf)].filter((g) => g.length >= 4)
    const genericWords = new Set(generics.flatMap((g) => g.toLowerCase().split(/\s+/)))
    // A brand is only claimed when the caller named one, or the product line leads with a word
    // that is not one of its own ingredients ("Dolo 650", "COLDRIF (paracetamol…)").
    const lead = genericOf(input.product ?? '').split(' ')[0] ?? ''
    const brandRaw = (input.brand?.trim() || (lead.length >= 3 && !genericWords.has(lead.toLowerCase()) ? (input.product ?? '').split(/[(,]/)[0]!.trim() : '')).replace(/\s+(?:tablets?|capsules?|syrup|suspension|injection|drops)\b.*$/i, '')
    const brandKey = norm(brandRaw)
    const brandWord = brandRaw.split(/\s+/).find((w) => w.length >= 3) ?? ''

    const publishable = (rows: ReturnType<Ledger['searchAlerts']>) => rows.filter((r) => isPublishableTier(r.record.tier))
    const search = (t: string) => {
      try {
        return publishable(this.deps.ledger.searchAlerts(t, 500))
      } catch {
        return [] // an FTS syntax edge case must not break the card
      }
    }

    const brandRids = new Set<string>()
    if (brandKey.length >= 3 && brandWord) {
      for (const r of search(brandWord)) {
        const b = norm(r.record.brand)
        if (b.length >= 3 && (b === brandKey || b.startsWith(brandKey) || (b.length >= 4 && brandKey.startsWith(b)))) brandRids.add(r.rid)
      }
    }
    const ingredientRids = new Set<string>()
    for (const g of [...new Set(generics.map((x) => x.toLowerCase()))].slice(0, 4)) {
      for (const r of search(g)) if (!brandRids.has(r.rid)) ingredientRids.add(r.rid)
    }
    const ingredient = generics[0] ? generics[0].replace(/\b\w/g, (c) => c.toUpperCase()) : null
    return { brandName: brandKey.length >= 3 ? brandRaw : null, brandAlerts: brandRids.size, ingredientName: ingredient, ingredientAlerts: ingredientRids.size }
  }
}
