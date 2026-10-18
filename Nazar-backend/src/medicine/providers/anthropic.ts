import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

import { errorMessage } from '../../lib/errors.ts'
import { MedicineInfo } from '../schema.ts'
import { ProviderError, UPSTREAM_TIMEOUT_MS, type MedicineProvider } from './types.ts'

/**
 * Claude via the official SDK (optional; NAZAR_LLM_PROVIDER=anthropic). Structured output comes from
 * the same zod schema, and the static system prompt carries a cache breakpoint so repeated lookups
 * read it from the prompt cache.
 */

/** The slice of the SDK client this provider uses, so tests can pass a fake. */
export interface AnthropicLike {
  messages: {
    parse(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<{ parsed_output?: unknown; stop_reason?: string | null; content: { type: string; text?: string }[] }>
  }
}

export class AnthropicProvider implements MedicineProvider {
  readonly id = 'anthropic' as const
  readonly model: string
  private readonly client: AnthropicLike

  constructor(o: { apiKey?: string; model: string; client?: AnthropicLike }) {
    this.model = o.model
    this.client = o.client ?? (new Anthropic({ apiKey: o.apiKey, maxRetries: 1, timeout: UPSTREAM_TIMEOUT_MS }) as unknown as AnthropicLike)
  }

  async generate({ system, user, signal }: { system: string; user: string; signal?: AbortSignal }): Promise<unknown> {
    let res: Awaited<ReturnType<AnthropicLike['messages']['parse']>>
    try {
      res = await this.client.messages.parse({
        model: this.model,
        // Room for brief adaptive thinking plus the JSON answer; the answer itself is short.
        max_tokens: 2048,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        output_config: { effort: 'low', format: zodOutputFormat(MedicineInfo) },
      }, signal ? { signal } : undefined)
    } catch (err) {
      const status = err instanceof Anthropic.APIError ? err.status : undefined
      throw new ProviderError(`Claude request failed: ${errorMessage(err)}`, status)
    }
    if (res.stop_reason === 'refusal') throw new ProviderError('Claude declined the request')
    if (res.stop_reason === 'max_tokens') throw new ProviderError('Claude stopped early (max_tokens)')
    if (res.parsed_output != null) return res.parsed_output
    const text = res.content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('')
    try {
      return JSON.parse(text)
    } catch {
      throw new ProviderError('Claude returned text that is not JSON')
    }
  }
}
