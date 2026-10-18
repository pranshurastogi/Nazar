import { env } from '../config/env.ts'
import { errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import type { Ledger } from '../storage/ledger.ts'
import { CACHE_TTL_MS, MedicineCache, identifyCacheKey } from './cache.ts'
import { ExplainError, providerFromEnv } from './explain.ts'
import { groundAnswer } from './ground.ts'
import { ClientLimiter, DEFAULT_IDENTIFY_LIMITS, DailyCap, hashIp, randomSalt, type ClientLimits } from './limits.ts'
import { buildIdentifyPrompt, IDENTIFY_SYSTEM_PROMPT } from './prompt.ts'
import { ProviderError, type MedicineProvider } from './providers/types.ts'
import { IDENTIFY_FIELDS, IdentifyAnswer, type IdentifyField, type IdentifyInput, type IdentifyResponse } from './schema.ts'

/**
 * "Add to cabinet from a photo": the device OCRs the pack label and sends only the text; an LLM
 * guesses which medicine it is, and every value is then grounded against that text (ground.ts), so a
 * batch number or expiry that is not printed on the label never comes back.
 * Same order of work as the explainer: cache → per-client limit → global daily cap → LLM, with its own
 * (smaller) budget. Only the hashed client and the outcome are logged, never the label text.
 */

const log = child('medicine')

/** The answer carries a few quotes plus thinking room; the explainer's 900 is tight for it. */
const IDENTIFY_OUTPUT_TOKENS = 1200

const S = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const isField = (v: unknown): v is IdentifyField => typeof v === 'string' && (IDENTIFY_FIELDS as readonly string[]).includes(v)

/**
 * Validates model output. A near miss (a field missing or of the wrong type) is repaired with empty
 * values and forced to low confidence; output that has none of the expected fields is rejected.
 */
export function validateIdentifyAnswer(raw: unknown): IdentifyAnswer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (!IDENTIFY_FIELDS.some((f) => f in o)) return null
  const direct = IdentifyAnswer.safeParse(raw)
  const ok = direct.success
  const evidence = Array.isArray(o.evidence)
    ? o.evidence
        .filter((e): e is { field: IdentifyField; quote: string } => !!e && typeof e === 'object' && isField((e as Record<string, unknown>).field) && typeof (e as Record<string, unknown>).quote === 'string')
        .slice(0, 24)
        .map((e) => ({ field: e.field, quote: e.quote.slice(0, 300) }))
    : []
  return {
    product: S(o.product, 200),
    brand: S(o.brand, 200),
    composition: Array.isArray(o.composition) ? o.composition.filter((x): x is string => typeof x === 'string').slice(0, 8).map((x) => x.slice(0, 200)) : [],
    form: S(o.form, 60),
    manufacturer: S(o.manufacturer, 250),
    batch: S(o.batch, 60),
    expiry: S(o.expiry, 20),
    evidence,
    confidence: ok ? direct.data.confidence : 'low',
  }
}

export interface IdentifierDeps {
  ledger: Ledger
  /** null = LLM disabled; undefined = from env. */
  provider?: MedicineProvider | null
  now?: () => number
  limits?: ClientLimits
  dailyCap?: number
  salt?: string
}

export class MedicineIdentifier {
  private readonly cache: MedicineCache<IdentifyAnswer>
  private readonly provider: MedicineProvider | null
  private readonly now: () => number
  private readonly clients: ClientLimiter
  private readonly cap: DailyCap
  private readonly salt: string
  private readonly inflight = new Map<string, Promise<{ answer: IdentifyAnswer; model: string }>>()

  constructor(deps: IdentifierDeps) {
    const e = env()
    // The raw (validated) model answer is cached, and grounded again on every request against the text actually sent.
    this.cache = new MedicineCache<IdentifyAnswer>(deps.ledger.db, CACHE_TTL_MS, 'medicine_identify_cache')
    this.provider = deps.provider === undefined ? providerFromEnv(e) : deps.provider
    this.now = deps.now ?? Date.now
    this.clients = new ClientLimiter(deps.limits ?? DEFAULT_IDENTIFY_LIMITS)
    this.cap = new DailyCap(deps.dailyCap ?? e.NAZAR_LLM_IDENTIFY_DAILY_CAP)
    this.salt = deps.salt ?? e.NAZAR_IP_SALT ?? randomSalt()
  }

  get enabled() {
    return this.provider !== null
  }

  async identify(input: IdentifyInput, ip: string): Promise<IdentifyResponse> {
    const who = hashIp(ip, this.salt)
    const key = identifyCacheKey(input.text)
    const now = this.now()

    const hit = this.cache.get(key, now)
    if (hit) return this.respond(input, hit.info, hit.model, true, who, 'cache_hit')

    if (!this.provider) {
      log.info({ client: who, outcome: 'disabled' }, 'medicine identify')
      throw new ExplainError(503, 'LLM_DISABLED', 'Reading medicine packs is not available on this server.')
    }

    const running = this.inflight.get(key)
    if (running) {
      const r = await running
      return this.respond(input, r.answer, r.model, true, who, 'shared')
    }

    const capWait = this.cap.wait(now)
    if (capWait > 0) {
      log.warn({ client: who, outcome: 'daily_cap' }, 'medicine identify')
      throw new ExplainError(429, 'DAILY_CAP', 'Nazar has read as many medicine packs as it can today. Please type the details or try again tomorrow.', capWait)
    }
    const limit = this.clients.take(who, now)
    if (!limit.ok) {
      log.warn({ client: who, outcome: `rate_limited_${limit.window}` }, 'medicine identify')
      const msg = limit.window === 'day' ? "You've scanned many packs today. Please type the details or try again tomorrow." : 'Too many scans in a short time. Please wait a minute and try again.'
      throw new ExplainError(429, 'RATE_LIMITED', msg, limit.retryAfterSec)
    }
    this.cap.take(now)

    const job = this.ask(input)
    this.inflight.set(key, job)
    try {
      const r = await job
      this.cache.put(key, r.answer, r.model, this.now())
      return this.respond(input, r.answer, r.model, false, who, 'answered')
    } catch (err) {
      log.warn({ client: who, outcome: 'upstream_error', err: errorMessage(err) }, 'medicine identify')
      if (err instanceof ExplainError) throw err
      throw new ExplainError(502, 'LLM_FAILED', 'Could not read this pack right now. Please type the details or try again later.')
    } finally {
      this.inflight.delete(key)
    }
  }

  private async ask(input: IdentifyInput): Promise<{ answer: IdentifyAnswer; model: string }> {
    const provider = this.provider!
    let raw: unknown
    try {
      raw = await provider.generate({ system: IDENTIFY_SYSTEM_PROMPT, user: buildIdentifyPrompt(input), schema: IdentifyAnswer, maxOutputTokens: IDENTIFY_OUTPUT_TOKENS })
    } catch (err) {
      throw err instanceof ProviderError ? err : new ProviderError(errorMessage(err))
    }
    const answer = validateIdentifyAnswer(raw)
    if (!answer) throw new ExplainError(502, 'LLM_BAD_OUTPUT', 'Could not read this pack right now. Please type the details or try again later.')
    return { answer, model: `${provider.id}:${provider.model}` }
  }

  private respond(input: IdentifyInput, answer: IdentifyAnswer, model: string, cached: boolean, who: string, outcome: string): IdentifyResponse {
    const g = groundAnswer(answer, input.text)
    const kept = (Object.keys(g.guess) as (keyof typeof g.guess)[]).filter((k) => (Array.isArray(g.guess[k]) ? (g.guess[k] as string[]).length > 0 : g.guess[k] !== null))
    log.info({ client: who, outcome, provider: this.provider?.id, confidence: g.confidence, kept, dropped: g.dropped }, 'medicine identify')
    return { guess: g.guess, confidence: g.confidence, evidence: g.evidence, aiGenerated: true, model, cached }
  }
}
