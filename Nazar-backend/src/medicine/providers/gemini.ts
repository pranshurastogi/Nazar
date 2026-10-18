import { z } from 'zod'

import { redactSecrets } from '../../lib/errors.ts'
import { MedicineInfo } from '../schema.ts'
import { MAX_OUTPUT_TOKENS, ProviderError, UPSTREAM_TIMEOUT_MS, type GenerateRequest, type MedicineProvider } from './types.ts'

/**
 * Google Gemini over plain fetch. The key travels only in the X-goog-api-key header (never in the URL,
 * so it cannot leak through proxies or access logs), and structured output is requested with a
 * responseSchema derived from the same zod schema the answer is validated against.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: unknown[]; description?: string }
export type GeminiSchema = { type: string; properties?: Record<string, GeminiSchema>; required?: string[]; propertyOrdering?: string[]; items?: GeminiSchema; enum?: string[]; description?: string }

/** JSON Schema (from zod) → the OpenAPI subset Gemini's responseSchema accepts. */
export function toGeminiSchema(s: JsonSchema): GeminiSchema {
  const type = (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type) ?? 'string'
  const out: GeminiSchema = { type: type.toUpperCase() }
  if (s.description) out.description = s.description
  if (s.enum) out.enum = s.enum.map(String)
  if (s.items) out.items = toGeminiSchema(s.items)
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]))
    out.propertyOrdering = Object.keys(s.properties)
    out.required = s.required ?? Object.keys(s.properties)
  }
  return out
}

export const MEDICINE_GEMINI_SCHEMA = toGeminiSchema(z.toJSONSchema(MedicineInfo) as JsonSchema)

const converted = new WeakMap<z.ZodType, GeminiSchema>()
/** responseSchema for a request: MedicineInfo unless the caller passes its own zod schema (converted once). */
export function geminiSchemaFor(schema?: z.ZodType): GeminiSchema {
  if (!schema || schema === MedicineInfo) return MEDICINE_GEMINI_SCHEMA
  let out = converted.get(schema)
  if (!out) converted.set(schema, (out = toGeminiSchema(z.toJSONSchema(schema) as JsonSchema)))
  return out
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

export interface GeminiOptions {
  apiKey: string
  model: string
  /** Tried after one retry when the primary model is overloaded or unavailable. */
  fallbackModel?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Pause before retrying a transient failure (tests pass 0). */
  retryDelayMs?: number
}

/** Upstream states worth another try: rate limiting, overload ("high demand"), gateway errors. */
const TRANSIENT = new Set([429, 500, 502, 503, 504])
const isTransient = (err: unknown) => err instanceof ProviderError && (err.upstreamStatus === undefined ? /timed out|request failed/i.test(err.message) : TRANSIENT.has(err.upstreamStatus))

export class GeminiProvider implements MedicineProvider {
  readonly id = 'gemini' as const
  readonly model: string
  private readonly fallbackModel: string | undefined
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly retryDelayMs: number

  constructor(o: GeminiOptions) {
    this.apiKey = o.apiKey
    this.model = o.model
    this.fallbackModel = o.fallbackModel && o.fallbackModel !== o.model ? o.fallbackModel : undefined
    this.fetchImpl = o.fetchImpl ?? fetch
    this.timeoutMs = o.timeoutMs ?? UPSTREAM_TIMEOUT_MS
    this.retryDelayMs = o.retryDelayMs ?? 800
  }

  /** Primary model, one retry on a transient failure, then the fallback model. */
  async generate(req: GenerateRequest): Promise<unknown> {
    try {
      return await this.withThinkingFallback(this.model, req)
    } catch (err) {
      if (!isTransient(err) || req.signal?.aborted) throw err
    }
    await new Promise((r) => setTimeout(r, this.retryDelayMs))
    try {
      return await this.withThinkingFallback(this.model, req)
    } catch (err) {
      if (!isTransient(err) || !this.fallbackModel || req.signal?.aborted) throw err
    }
    return this.withThinkingFallback(this.fallbackModel, req)
  }

  private async withThinkingFallback(model: string, req: GenerateRequest): Promise<unknown> {
    try {
      return await this.call(model, req, true)
    } catch (err) {
      // Thinking controls differ between Gemini generations; a model that rejects them gets one plain retry.
      if (err instanceof ProviderError && err.upstreamStatus === 400 && /thinking/i.test(err.message)) return this.call(model, req, false)
      throw err
    }
  }

  private async call(model: string, { system, user, signal, schema, maxOutputTokens }: GenerateRequest, lowThinking: boolean): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: maxOutputTokens ?? MAX_OUTPUT_TOKENS,
            responseMimeType: 'application/json',
            responseSchema: geminiSchemaFor(schema),
            // Low thinking keeps the whole budget for the answer (default thinking spent ~600 tokens and truncated it).
            ...(lowThinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
          },
        }),
      })
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      throw new ProviderError(name === 'TimeoutError' || timeout.aborted ? `Gemini timed out after ${this.timeoutMs} ms` : `Gemini request failed: ${redactSecrets(String((err as Error)?.message ?? err))}`)
    }
    if (!res.ok) {
      // Google echoes request details in error bodies; keep a short, redacted excerpt only.
      const detail = redactSecrets((await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200))
      throw new ProviderError(`Gemini returned ${res.status}${detail ? `: ${detail}` : ''}`, res.status)
    }
    const body = (await res.json().catch(() => null)) as GeminiResponse | null
    if (body?.promptFeedback?.blockReason) throw new ProviderError(`Gemini blocked the prompt (${body.promptFeedback.blockReason})`)
    const cand = body?.candidates?.[0]
    const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim()
    if (!text) throw new ProviderError(`Gemini returned no text (finish: ${cand?.finishReason ?? 'unknown'})`)
    if (cand?.finishReason && cand.finishReason !== 'STOP') throw new ProviderError(`Gemini stopped early (${cand.finishReason})`)
    try {
      return JSON.parse(text)
    } catch {
      throw new ProviderError('Gemini returned text that is not JSON')
    }
  }
}
