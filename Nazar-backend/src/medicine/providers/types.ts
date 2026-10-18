import type { z } from 'zod'

import { NazarError } from '../../lib/errors.ts'

/**
 * One LLM backend for "About this medicine". A provider turns the fixed system prompt plus one user
 * message into a JSON value; validation against MedicineInfo happens in the caller, so a provider
 * never has to be trusted to honour the schema.
 */
export interface MedicineProvider {
  readonly id: 'gemini' | 'anthropic'
  readonly model: string
  generate(req: GenerateRequest): Promise<unknown>
}

export interface GenerateRequest {
  system: string
  user: string
  signal?: AbortSignal
  /** Structured-output schema; defaults to MedicineInfo (the explainer card). */
  schema?: z.ZodType
  /** Output budget; defaults to MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number
}

/** Upstream failure (network, HTTP error, refusal, truncated or empty output). Message is already redacted. */
export class ProviderError extends NazarError {
  constructor(message: string, readonly upstreamStatus?: number) {
    super(message, 'LLM_UPSTREAM', upstreamStatus ? { status: upstreamStatus } : undefined)
  }
}

export const UPSTREAM_TIMEOUT_MS = 20_000
export const MAX_OUTPUT_TOKENS = 900
