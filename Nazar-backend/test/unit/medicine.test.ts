import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../../src/api/app.ts'
import { confusionKey } from '../../src/domain/batch.ts'
import { redactSecrets } from '../../src/lib/errors.ts'
import { MedicineCache, cacheKey, CACHE_TTL_MS } from '../../src/medicine/cache.ts'
import { ExplainError, MedicineExplainer, genericOf, validateAnswer } from '../../src/medicine/explain.ts'
import { guardInfo, looksLikeDosing, saysSafe } from '../../src/medicine/guard.ts'
import { ClientLimiter, DailyCap, clientIp, hashIp } from '../../src/medicine/limits.ts'
import { buildUserPrompt, SYSTEM_PROMPT } from '../../src/medicine/prompt.ts'
import { AnthropicProvider, type AnthropicLike } from '../../src/medicine/providers/anthropic.ts'
import { GeminiProvider, MEDICINE_GEMINI_SCHEMA } from '../../src/medicine/providers/gemini.ts'
import { ProviderError, type MedicineProvider } from '../../src/medicine/providers/types.ts'
import type { MedicineInfo } from '../../src/medicine/schema.ts'
import { resolveRows } from '../../src/resolve/index.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'

const GOOGLE_KEY = 'AIza' + 'Sy0123456789abcdefghijklmnopqrstuvw'
const AQ_KEY = 'AQ.' + 'Ab8RN6Lx_some-base64url-secret-value-123'

const ANSWER: MedicineInfo = {
  name: 'Dolo 650 tablet',
  genericNames: ['Paracetamol'],
  drugClass: 'Pain reliever and fever reducer (analgesic)',
  whatItIsFor: ['Fever', 'Headache and body ache', 'Take 500 mg twice daily for pain'],
  howItWorks: 'It reduces pain signals and lowers fever. It is safe for most people.',
  commonSideEffects: ['Nausea', 'Mild stomach upset'],
  seriousWarnings: ['Yellow eyes or skin (liver damage)', 'Swelling of face or throat'],
  whoShouldBeCareful: ['Liver disease', 'Regular alcohol use', 'Generally safe in pregnancy'],
  interactions: ['Other paracetamol medicines', 'Do not exceed 4 g in 24 hours'],
  storage: 'Store below 30°C, away from children.',
  prescriptionStatus: 'Usually sold without prescription in India',
  lookAlikeNames: ['Dolo-Cold'],
  confidence: 'high',
}

function seededLedger() {
  const ledger = new Ledger(':memory:')
  const doc = rawDoc({ title: 'CDSCO NSQ list', sourceId: 'cdsco-online', noticeYm: 202606 })
  const rows = [
    row(doc, 1, { product: 'Paracetamol Tablets IP 500 mg', batch: 'PX-101', reason: 'Dissolution' }),
    row(doc, 2, { product: 'DOLO 650 tablets', batch: 'DL-650A', reason: 'Assay' }),
    row(doc, 3, { product: 'Amoxicillin Capsules', batch: 'AM-1', reason: 'Assay' }),
  ]
  ledger.upsertDocument(doc)
  const r = resolveRows(doc, rows)
  ledger.upsertAlerts([...r.alerts, ...r.curator], confusionKey)
  return ledger
}

class FakeProvider implements MedicineProvider {
  readonly id = 'gemini' as const
  readonly model = 'fake-1'
  calls: { system: string; user: string }[] = []
  constructor(private answer: unknown | (() => unknown) = ANSWER) {}
  async generate(req: { system: string; user: string }) {
    this.calls.push(req)
    return typeof this.answer === 'function' ? (this.answer as () => unknown)() : structuredClone(this.answer)
  }
}

const INPUT = { product: 'Dolo 650', composition: ['Paracetamol IP 650 mg'], form: 'tablet', batch: 'DL-650A' }

describe('guard', () => {
  it('detects dosing and the word safe', () => {
    expect(looksLikeDosing('Take 500 mg twice daily')).toBe(true)
    expect(looksLikeDosing('2 tablets every 6 hours')).toBe(true)
    expect(looksLikeDosing('Do not exceed 4 g in 24 hours')).toBe(true)
    expect(looksLikeDosing('once a day')).toBe(true)
    expect(looksLikeDosing('10 mg/kg')).toBe(true)
    expect(looksLikeDosing('Store below 30°C')).toBe(false)
    expect(looksLikeDosing('Headache and body ache')).toBe(false)
    expect(saysSafe('Generally safe in pregnancy')).toBe(true)
    expect(saysSafe('Use it safely')).toBe(true)
    expect(saysSafe('Unsafe in liver disease')).toBe(false)
  })

  it('drops dose-like and "safe" bullets, keeps the rest', () => {
    const { info, dropped } = guardInfo(ANSWER)
    expect(info.whatItIsFor).toEqual(['Fever', 'Headache and body ache'])
    expect(info.whoShouldBeCareful).toEqual(['Liver disease', 'Regular alcohol use'])
    expect(info.interactions).toEqual(['Other paracetamol medicines'])
    expect(info.howItWorks).toBe('It reduces pain signals and lowers fever.')
    expect(info.storage).toBe('Store below 30°C, away from children.')
    expect(dropped).toBe(3)
    expect(JSON.stringify(info)).not.toMatch(/\bsafe\b/i)
  })

  it('an answer stripped of every use is never presented as confident', () => {
    expect(guardInfo({ ...ANSWER, whatItIsFor: ['Take 2 tablets daily'] }).info.confidence).toBe('low')
  })
})

describe('validateAnswer', () => {
  it('accepts a valid answer, repairs a near miss to low confidence, rejects junk', () => {
    expect(validateAnswer(ANSWER)?.confidence).toBe('high')
    const partial = validateAnswer({ name: 'Dolo', whatItIsFor: ['Fever', 3], confidence: 'high' })
    expect(partial).toMatchObject({ name: 'Dolo', whatItIsFor: ['Fever'], commonSideEffects: [], confidence: 'low' })
    expect(validateAnswer('nope')).toBeNull()
    expect(validateAnswer({ whatItIsFor: [] })).toBeNull()
    expect(validateAnswer([ANSWER])).toBeNull()
  })
})

describe('cache', () => {
  it('keys ignore case, spacing, IP/BP suffixes and ingredient order; batch and manufacturer do not split the key', () => {
    const a = cacheKey({ product: 'Dolo 650', composition: ['Paracetamol IP 650 mg', 'Caffeine 50mg'], form: 'Tablet' })
    const b = cacheKey({ product: ' DOLO   650 ', composition: ['caffeine 50mg', 'paracetamol 650 mg'], form: 'tablet', batch: 'X1', manufacturer: 'M' })
    expect(a).toBe(b)
    expect(cacheKey({ product: 'Dolo 650', form: 'syrup' })).not.toBe(cacheKey({ product: 'Dolo 650', form: 'tablet' }))
  })

  it('expires after 30 days', () => {
    const c = new MedicineCache(new Ledger(':memory:').db)
    c.put('k', ANSWER, 'm', 1000)
    expect(c.get('k', 1000 + CACHE_TTL_MS - 1)?.info.name).toBe('Dolo 650 tablet')
    expect(c.get('k', 1000 + CACHE_TTL_MS + 1)).toBeNull()
    expect(c.size()).toBe(0)
  })
})

describe('limits (fake clock)', () => {
  it('per client: 5 per minute, refilling over the minute', () => {
    const l = new ClientLimiter({ perMinute: 5, perDay: 30 })
    for (let i = 0; i < 5; i++) expect(l.take('a', 0).ok).toBe(true)
    const r = l.take('a', 0)
    expect(r).toMatchObject({ ok: false, window: 'minute' })
    expect(r.ok === false && r.retryAfterSec).toBe(12)
    expect(l.take('b', 0).ok).toBe(true) // other clients are unaffected
    expect(l.take('a', 12_000).ok).toBe(true)
    expect(l.take('a', 12_000).ok).toBe(false)
  })

  it('per client: 30 per day even when spread out', () => {
    const l = new ClientLimiter({ perMinute: 5, perDay: 30 })
    let t = 0
    for (let i = 0; i < 30; i++, t += 60_000) expect(l.take('a', t).ok).toBe(true)
    const r = l.take('a', t)
    expect(r).toMatchObject({ ok: false, window: 'day' })
    expect(r.ok === false && r.retryAfterSec).toBeGreaterThan(60)
  })

  it('global daily cap resets at UTC midnight and says how long to wait', () => {
    const cap = new DailyCap(2)
    const t0 = Date.UTC(2026, 9, 18, 23, 0, 0)
    cap.take(t0)
    cap.take(t0)
    expect(cap.wait(t0)).toBe(3600)
    expect(cap.wait(Date.UTC(2026, 9, 19, 0, 0, 1))).toBe(0)
  })

  it('hashes IPs with a salt and reads the first X-Forwarded-For hop', () => {
    expect(hashIp('1.2.3.4', 's1')).not.toBe(hashIp('1.2.3.4', 's2'))
    expect(hashIp('1.2.3.4', 's1')).toMatch(/^[0-9a-f]{16}$/)
    expect(clientIp({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })).toBe('203.0.113.9')
    expect(clientIp({ 'x-real-ip': '198.51.100.2' })).toBe('198.51.100.2')
    expect(clientIp({}, '127.0.0.1')).toBe('127.0.0.1')
  })
})

describe('MedicineExplainer', () => {
  const make = (o: { provider?: MedicineProvider | null; now?: () => number; dailyCap?: number } = {}) =>
    new MedicineExplainer({ ledger: seededLedger(), provider: o.provider === undefined ? new FakeProvider() : o.provider, now: o.now ?? (() => 1_800_000_000_000), dailyCap: o.dailyCap ?? 100, salt: 'test' })

  it('answers with the guarded info, the disclaimer and Nazar alert counts; never sends the batch to the model', async () => {
    const provider = new FakeProvider()
    const ex = make({ provider })
    const r = await ex.explain(INPUT, '1.2.3.4')
    expect(r.medicine.notMedicalAdvice).toBe(true)
    expect(r.aiGenerated).toBe(true)
    expect(r.disclaimer).toMatch(/doctor or pharmacist/)
    expect(r.medicine.whatItIsFor).toEqual(['Fever', 'Headache and body ache'])
    // Brand and ingredient are counted apart: the DOLO row is about this brand, the plain
    // paracetamol row is another product that shares the ingredient; amoxicillin is neither.
    expect(r.brandName).toBe('Dolo 650')
    expect(r.brandAlerts).toBe(1)
    expect(r.nazarAlerts).toBe(1)
    expect(r.ingredientName).toBe('Paracetamol')
    expect(r.ingredientAlerts).toBe(1)
    expect(r.nazarQuery).toBe('Dolo 650')
    expect(r.batchAlerts).toBe(1)
    expect(r.cached).toBe(false)
    expect(provider.calls[0]!.user).not.toContain('DL-650A')
    expect(provider.calls[0]!.user).toContain('Paracetamol IP 650 mg')
    expect(provider.calls[0]!.system).toBe(SYSTEM_PROMPT)
  })

  it('never claims a brand for an unbranded generic, and never counts ingredient matches as brand alerts', async () => {
    const r = await make().explain({ product: 'Paracetamol Tablets IP 500 mg', composition: ['Paracetamol IP 500 mg'], form: 'tablet' }, '1.2.3.4')
    expect(r.brandName).toBeNull()
    expect(r.brandAlerts).toBe(0)
    expect(r.nazarAlerts).toBe(0)
    expect(r.ingredientName).toBe('Paracetamol')
    expect(r.ingredientAlerts).toBeGreaterThanOrEqual(1)
    expect(r.nazarQuery).toBe('Paracetamol')
  })

  it('reports zero brand alerts for a brand Nazar has never flagged', async () => {
    const r = await make().explain({ product: 'Calpol 500', composition: ['Paracetamol IP 500 mg'], form: 'tablet' }, '1.2.3.4')
    expect(r.brandName).toBe('Calpol 500')
    expect(r.brandAlerts).toBe(0)
    expect(r.ingredientAlerts).toBeGreaterThanOrEqual(1)
  })

  it('serves repeats from the cache without calling the model or counting against limits', async () => {
    const provider = new FakeProvider()
    const ex = new MedicineExplainer({ ledger: seededLedger(), provider, now: () => 0, limits: { perMinute: 1, perDay: 1 }, dailyCap: 10, salt: 's' })
    await ex.explain(INPUT, '1.2.3.4')
    for (let i = 0; i < 5; i++) expect((await ex.explain({ ...INPUT, product: 'DOLO 650 ' }, '1.2.3.4')).cached).toBe(true)
    expect(provider.calls).toHaveLength(1)
    // A different medicine is a miss and hits the 1/min limit.
    await expect(ex.explain({ product: 'Crocin' }, '1.2.3.4')).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' })
  })

  it('rate-limits per client and enforces the global daily cap', async () => {
    let now = 0
    const ex = new MedicineExplainer({ ledger: seededLedger(), provider: new FakeProvider(), now: () => now, limits: { perMinute: 2, perDay: 30 }, dailyCap: 3, salt: 's' })
    await ex.explain({ product: 'A1' }, 'ip1')
    await ex.explain({ product: 'A2' }, 'ip1')
    const err = await ex.explain({ product: 'A3' }, 'ip1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ExplainError)
    expect(err).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterSec: 30 })
    await ex.explain({ product: 'B1' }, 'ip2')
    await expect(ex.explain({ product: 'B2' }, 'ip3')).rejects.toMatchObject({ status: 429, code: 'DAILY_CAP' })
    now = 86_400_000
    expect((await ex.explain({ product: 'B2' }, 'ip3')).cached).toBe(false)
  })

  it('LLM_DISABLED when no provider is configured', async () => {
    await expect(make({ provider: null }).explain(INPUT, 'x')).rejects.toMatchObject({ status: 503, code: 'LLM_DISABLED' })
  })

  it('bad model output → 502 LLM_BAD_OUTPUT; upstream failure → 502 with a generic message (no key leaks)', async () => {
    await expect(make({ provider: new FakeProvider({ hello: 1 }) }).explain(INPUT, 'x')).rejects.toMatchObject({ status: 502, code: 'LLM_BAD_OUTPUT' })
    const failing = new FakeProvider(() => {
      throw new ProviderError(`Gemini returned 400: API key ${GOOGLE_KEY} not valid`)
    })
    const err = (await make({ provider: failing }).explain(INPUT, 'x').catch((e: unknown) => e)) as ExplainError
    expect(err).toMatchObject({ status: 502, code: 'LLM_FAILED' })
    expect(err.message).not.toContain(GOOGLE_KEY)
  })

  it('genericOf keeps the ingredient name only', () => {
    expect(genericOf('Paracetamol IP 500 mg')).toBe('Paracetamol')
    expect(genericOf('Each tablet contains: Amoxicillin Trihydrate IP eq. to Amoxicillin 500 mg')).toBe('Amoxicillin Trihydrate eq to Amoxicillin')
  })

  it('the user prompt leaves out the batch', () => {
    expect(buildUserPrompt(INPUT)).not.toContain('DL-650A')
  })
})

describe('providers', () => {
  it('Gemini: key only in the header, JSON schema + caps in generationConfig', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(ANSWER) }] }, finishReason: 'STOP' }] }), { status: 200 }),
    )
    const p = new GeminiProvider({ apiKey: GOOGLE_KEY, model: 'gemini-flash-latest', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await p.generate({ system: 'S', user: 'U' })).toEqual(ANSWER)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent')
    expect(String(url)).not.toContain(GOOGLE_KEY)
    expect((init!.headers as Record<string, string>)['X-goog-api-key']).toBe(GOOGLE_KEY)
    const body = JSON.parse(String(init!.body))
    expect(body.generationConfig).toMatchObject({ temperature: 0.2, maxOutputTokens: 900, responseMimeType: 'application/json' })
    expect(body.generationConfig.responseSchema.required).toContain('seriousWarnings')
    expect(MEDICINE_GEMINI_SCHEMA.properties?.confidence).toMatchObject({ type: 'STRING', enum: ['high', 'medium', 'low'] })
  })

  it('Gemini: an overloaded model (503) is retried once, then the fallback model answers', async () => {
    const urls: string[] = []
    let calls = 0
    const p = new GeminiProvider({
      apiKey: 'k',
      model: 'gemini-flash-latest',
      fallbackModel: 'gemini-flash-lite-latest',
      retryDelayMs: 0,
      fetchImpl: (async (u: unknown) => {
        urls.push(String(u))
        calls++
        if (calls <= 2) return new Response('{"error":{"code":503,"status":"UNAVAILABLE","message":"high demand"}}', { status: 503 })
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(ANSWER) }] }, finishReason: 'STOP' }] }), { status: 200 })
      }) as unknown as typeof fetch,
    })
    expect(await p.generate({ system: 'S', user: 'U' })).toEqual(ANSWER)
    expect(urls.map((u) => u.split('/models/')[1])).toEqual([
      'gemini-flash-latest:generateContent',
      'gemini-flash-latest:generateContent',
      'gemini-flash-lite-latest:generateContent',
    ])
  })

  it('Gemini: a non-transient error (400) is not retried', async () => {
    let calls = 0
    const p = new GeminiProvider({ apiKey: 'k', model: 'm', fallbackModel: 'f', retryDelayMs: 0, fetchImpl: (async () => (calls++, new Response('{"error":"bad"}', { status: 400 }))) as unknown as typeof fetch })
    await expect(p.generate({ system: 'S', user: 'U' })).rejects.toThrow(/400/)
    expect(calls).toBe(1)
  })

  it('Gemini: errors are redacted; truncation is an error; a thinking-config 400 is retried once without it', async () => {
    const bad = new GeminiProvider({ apiKey: GOOGLE_KEY, model: 'm', fetchImpl: (async () => new Response(`{"error":"API key ${GOOGLE_KEY} invalid"}`, { status: 400 })) as unknown as typeof fetch })
    const e = (await bad.generate({ system: 'S', user: 'U' }).catch((x: unknown) => x)) as ProviderError
    expect(e.message).toMatch(/Gemini returned 400/)
    expect(e.message).not.toContain(GOOGLE_KEY)

    const cut = new GeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"name":' }] }, finishReason: 'MAX_TOKENS' }] }))) as unknown as typeof fetch })
    await expect(cut.generate({ system: 'S', user: 'U' })).rejects.toThrow(/MAX_TOKENS/)

    const bodies: unknown[] = []
    const retry = new GeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: (async (_u: unknown, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)))
        return bodies.length === 1
          ? new Response('Thinking level LOW is not supported for this model', { status: 400 })
          : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(ANSWER) }] }, finishReason: 'STOP' }] }))
      }) as unknown as typeof fetch,
    })
    expect(await retry.generate({ system: 'S', user: 'U' })).toEqual(ANSWER)
    expect((bodies[0] as { generationConfig: Record<string, unknown> }).generationConfig.thinkingConfig).toBeDefined()
    expect((bodies[1] as { generationConfig: Record<string, unknown> }).generationConfig.thinkingConfig).toBeUndefined()
  })

  it('Anthropic: cached system prompt, structured output, refusal is an error', async () => {
    const seen: Record<string, unknown>[] = []
    const client: AnthropicLike = {
      messages: {
        parse: async (params) => {
          seen.push(params as unknown as Record<string, unknown>)
          return { parsed_output: ANSWER, stop_reason: 'end_turn', content: [] }
        },
      },
    }
    const p = new AnthropicProvider({ model: 'claude-haiku-5-5', client })
    expect(await p.generate({ system: 'SYS', user: 'U' })).toEqual(ANSWER)
    expect(seen[0]).toMatchObject({ model: 'claude-haiku-5-5', system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }] })
    expect((seen[0]!.output_config as { format: { type: string } }).format.type).toBe('json_schema')
    const refusing = new AnthropicProvider({ model: 'm', client: { messages: { parse: async () => ({ stop_reason: 'refusal', content: [] }) } } })
    await expect(refusing.generate({ system: 'S', user: 'U' })).rejects.toThrow(/declined/)
  })

  it('redactSecrets hides Google (AIza…, AQ.…) and Anthropic keys', () => {
    const msg = `bad key ${GOOGLE_KEY} and ${AQ_KEY} and sk-ant-api03-abcdefghijklmnop`
    const out = redactSecrets(msg)
    expect(out).not.toContain(GOOGLE_KEY)
    expect(out).not.toContain(AQ_KEY)
    expect(out).not.toContain('abcdefghijklmnop')
    expect(out).toContain('AIza***')
    expect(out).toContain('AQ.***')
  })
})

describe('POST /v1/medicine/explain', () => {
  const ORIGIN = 'http://localhost:3000'
  const appWith = (medicine: MedicineExplainer) => createApp({ ledger: seededLedger(), reader: null, corsOrigins: [ORIGIN], medicine })
  const post = (app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = {}) =>
    app.request('/v1/medicine/explain', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

  it('answers, with no-store and CORS for the configured origin only', async () => {
    const app = appWith(new MedicineExplainer({ ledger: seededLedger(), provider: new FakeProvider(), salt: 's' }))
    const res = await post(app, INPUT)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const body = await res.json()
    expect(body.medicine.name).toBe('Dolo 650 tablet')
    expect(JSON.stringify(body)).not.toMatch(/\bsafe\b/i)

    const pre = await app.request('/v1/medicine/explain', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } })
    expect(pre.headers.get('access-control-allow-methods')).toMatch(/POST/)
    const evil = await app.request('/v1/medicine/explain', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
    expect(evil.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('rejects oversized, non-JSON, unknown-field and empty bodies', async () => {
    const app = appWith(new MedicineExplainer({ ledger: seededLedger(), provider: new FakeProvider(), salt: 's' }))
    expect((await post(app, { product: 'x'.repeat(100), manufacturer: 'y'.repeat(3000) })).status).toBe(413)
    expect((await post(app, 'not json')).status).toBe(400)
    expect((await post(app, { product: 'Dolo', image: 'data:...' })).status).toBe(400)
    expect((await post(app, {})).status).toBe(400)
    expect((await post(app, { composition: Array(9).fill('a') })).status).toBe(400)
  })

  it('503 LLM_DISABLED without a provider; 429 with Retry-After and a friendly message', async () => {
    const off = appWith(new MedicineExplainer({ ledger: seededLedger(), provider: null, salt: 's' }))
    const r = await post(off, INPUT)
    expect(r.status).toBe(503)
    expect((await r.json()).error.code).toBe('LLM_DISABLED')

    const app = appWith(new MedicineExplainer({ ledger: seededLedger(), provider: new FakeProvider(), salt: 's', now: () => 0, limits: { perMinute: 1, perDay: 30 } }))
    expect((await post(app, { product: 'A' }, { 'x-forwarded-for': '203.0.113.9' })).status).toBe(200)
    expect((await post(app, { product: 'B' }, { 'x-forwarded-for': '198.51.100.1' })).status).toBe(200)
    const limited = await post(app, { product: 'C' }, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect((await limited.json()).error).toMatchObject({ code: 'RATE_LIMITED', message: expect.stringMatching(/wait a minute/) })
  })
})
