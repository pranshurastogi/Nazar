import Anthropic from '@anthropic-ai/sdk'

import { env, type Env } from '../config/env.ts'
import { isPlausibleBatch, matchKey, splitBatches } from '../domain/batch.ts'
import type { ExtractedRow } from '../domain/types.ts'
import { errorMessage } from '../lib/errors.ts'
import { stableId } from '../lib/hash.ts'
import { child } from '../lib/logger.ts'
import { scoreRow } from './confidence.ts'
import { flat, normaliseDate } from './grammar.ts'
import type { Rejected } from './rows.ts'

/**
 * Last-resort reader for rows the deterministic parsers rejected. The model is asked
 * to COPY values from the row text, never infer them; every value it returns is
 * then checked against that text and dropped if it does not appear there. A row
 * survives only with a verified product and a verified, plausible batch.
 */

const log = child('llm')

/** Rows recovered this way never claim more certainty than this. */
export const LLM_CONFIDENCE_CAP = 0.85
const MAX_ROWS_PER_DOC = 20

/** The slice of the Anthropic client this module uses, so tests can pass a fake. */
export interface LlmClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<{ content: { type: string; text?: string }[] }>
  }
}

export interface LlmAnswer {
  product: string | null
  batches: string[]
  mfg: string | null
  exp: string | null
  manufacturer: string | null
  reason: string | null
  reportedBy: string | null
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['product', 'batches', 'mfg', 'exp', 'manufacturer', 'reason', 'reportedBy'],
  properties: {
    product: { type: ['string', 'null'] },
    batches: { type: 'array', items: { type: 'string' } },
    mfg: { type: ['string', 'null'] },
    exp: { type: ['string', 'null'] },
    manufacturer: { type: ['string', 'null'] },
    reason: { type: ['string', 'null'] },
    reportedBy: { type: ['string', 'null'] },
  },
} as const

const SYSTEM = `You read one row of an Indian drug regulator's alert table (Not of Standard Quality / spurious drugs).
Return JSON with the row's fields. Rules:
- Copy every value exactly as it appears in the row text. Do not correct, expand, translate or infer anything.
- "batches": the batch/lot number(s) printed in the row. If no batch number is printed, return [].
- "mfg" / "exp": the manufacturing and expiry dates exactly as printed, or null.
- Use null for any field that is not present in the text.`

export function llmEnabled(e: Env = env()): boolean {
  return e.NAZAR_LLM_ENABLED && Boolean(e.ANTHROPIC_API_KEY)
}

let client: LlmClient | null = null
function defaultClient(e: Env): LlmClient {
  client ??= new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 }) as unknown as LlmClient
  return client
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[“”"’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** True when the value appears in the source, ignoring case and whitespace (wrapped cells split words). */
export function isGrounded(value: string, source: string): boolean {
  const v = norm(value)
  if (!v) return false
  const s = norm(source)
  return s.includes(v) || s.replace(/\s/g, '').includes(v.replace(/\s/g, ''))
}

/** Keeps only the values that appear in the source text; reports what was dropped. */
export function verifyGrounded(answer: LlmAnswer, source: string): { kept: LlmAnswer; dropped: string[] } {
  const dropped: string[] = []
  const keep = (field: string, v: string | null) => {
    if (v === null || !v.trim()) return null
    if (isGrounded(v, source)) return v.trim()
    dropped.push(field)
    return null
  }
  const batches = answer.batches.filter((b) => {
    const ok = isGrounded(b, source) && isPlausibleBatch(b.trim().toUpperCase())
    if (!ok) dropped.push(`batch "${b}"`)
    return ok
  })
  return {
    kept: {
      product: keep('product', answer.product),
      batches,
      mfg: keep('mfg', answer.mfg),
      exp: keep('exp', answer.exp),
      manufacturer: keep('manufacturer', answer.manufacturer),
      reason: keep('reason', answer.reason),
      reportedBy: keep('reportedBy', answer.reportedBy),
    },
    dropped,
  }
}

export function parseAnswer(text: string): LlmAnswer | null {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v : null)
    return {
      product: str(o.product),
      batches: Array.isArray(o.batches) ? o.batches.filter((b): b is string => typeof b === 'string') : [],
      mfg: str(o.mfg),
      exp: str(o.exp),
      manufacturer: str(o.manufacturer),
      reason: str(o.reason),
      reportedBy: str(o.reportedBy),
    }
  } catch {
    return null
  }
}

export interface RecoverContext {
  sourceSha: string
  parser: string
  expectPin: boolean
  client?: LlmClient
  model?: string
  nowYm?: number
}

export async function recoverRejected(
  rejected: Rejected[],
  ctx: RecoverContext & Record<string, unknown>,
): Promise<{ rows: ExtractedRow[]; remaining: Rejected[]; warnings: string[] }> {
  const e = env()
  const api = ctx.client ?? defaultClient(e)
  const model = ctx.model ?? e.NAZAR_LLM_MODEL
  const rows: ExtractedRow[] = []
  const remaining: Rejected[] = []
  const warnings: string[] = []

  for (const [i, r] of rejected.entries()) {
    if (i >= MAX_ROWS_PER_DOC || !r.rawText.trim()) {
      remaining.push(r)
      continue
    }
    let answer: LlmAnswer | null = null
    try {
      const res = await api.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Row text:\n${r.rawText}` }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
      })
      answer = parseAnswer(res.content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join(''))
    } catch (err) {
      warnings.push(`LLM call failed for row ${r.rowNo}: ${errorMessage(err)}`)
      log.warn({ err: errorMessage(err), rowNo: r.rowNo }, 'llm call failed')
    }
    if (!answer) {
      remaining.push(r)
      continue
    }
    const { kept, dropped } = verifyGrounded(answer, r.rawText)
    const batches = [...new Map(kept.batches.flatMap((b) => splitBatches(b)).map((b) => [matchKey(b), b])).values()]
    if (!kept.product || !batches.length) {
      remaining.push({ ...r, reason: `${r.reason}; LLM found no verifiable batch` })
      continue
    }
    const mfg = normaliseDate(kept.mfg)
    const exp = normaliseDate(kept.exp, mfg.ym)
    const extra = ['recovered by LLM; every value checked against the row text', ...dropped.map((d) => `LLM value not in source, dropped: ${d}`)]
    batches.forEach((batch, k) => {
      const s = scoreRow(
        { product: flat(kept.product), batch, mfgYm: mfg.ym, expYm: exp.ym, manufacturer: kept.manufacturer, reason: kept.reason },
        { expectPin: ctx.expectPin, nowYm: ctx.nowYm },
      )
      rows.push({
        rid: stableId(ctx.sourceSha, k === 0 ? r.rowNo : `${r.rowNo}.${k}`, `${ctx.parser}+llm`),
        sourceSha: ctx.sourceSha,
        rowNo: Math.max(1, r.rowNo),
        page: r.page,
        product: flat(kept.product),
        batch,
        mfgYm: mfg.ym,
        expYm: exp.ym,
        manufacturer: kept.manufacturer,
        reason: kept.reason,
        reportedBy: kept.reportedBy,
        method: 'llm',
        parser: ctx.parser,
        confidence: Math.min(LLM_CONFIDENCE_CAP, s.confidence),
        issues: [...extra, ...s.issues],
        rawText: r.rawText,
      })
    })
  }
  return { rows, remaining, warnings }
}
