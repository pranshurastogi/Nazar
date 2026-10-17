import { describe, expect, it, vi } from 'vitest'

import { parseEnv } from '../../../src/config/env.ts'
import { isGrounded, llmEnabled, LLM_CONFIDENCE_CAP, recoverRejected, verifyGrounded, type LlmClient } from '../../../src/extract/llm.ts'

const RAW =
  'S.No: 7. | Product/Drug Name: Enzox Liquid Digestive Supplement | Batch No.: ES - 24011/11 | Manufacturing Date: 12/2024 | Expiry Date: 05/2026 | Manufactured By: M/s.Tidal Laboratories Pvt. Ltd. Patch-5, Bilaspur- 174201 | NSQ Result: Assay/Content of Pepsin activity.'

const fakeClient = (answer: unknown): LlmClient & { calls: unknown[] } => {
  const calls: unknown[] = []
  return {
    calls,
    messages: {
      create: vi.fn(async (params: unknown) => {
        calls.push(params)
        return { content: [{ type: 'text', text: JSON.stringify(answer) }] }
      }),
    },
  }
}

describe('grounding verifier', () => {
  it('accepts values present in the source, ignoring case and wrapping whitespace', () => {
    expect(isGrounded('enzox liquid digestive supplement', RAW)).toBe(true)
    expect(isGrounded('ES-24011/11', RAW)).toBe(true) // printed "ES - 24011/11"
    expect(isGrounded('Bilaspur-174201', RAW)).toBe(true)
  })
  it('drops values that do not appear in the source', () => {
    const { kept, dropped } = verifyGrounded(
      { product: 'Enzox Liquid Digestive Supplement', batches: ['ES-24011/11', 'ES-99999'], mfg: '12/2024', exp: '06/2026', manufacturer: 'Tidal Labs', reason: 'Assay/Content of Pepsin activity.', reportedBy: null },
      RAW,
    )
    expect(kept.batches).toEqual(['ES-24011/11'])
    expect(kept.exp).toBeNull()
    expect(kept.manufacturer).toBeNull()
    expect(kept.mfg).toBe('12/2024')
    expect(dropped).toEqual(['batch "ES-99999"', 'exp', 'manufacturer'])
  })
})

describe('recoverRejected', () => {
  const ctx = { sourceSha: 'b'.repeat(64), parser: 'cdsco-modern@1', expectPin: true, model: 'test-model', nowYm: 202610 }
  const rejected = [{ rowNo: 7, page: 1, rawText: RAW, reason: 'implausible batch' }]

  it('keeps only verified values, marks rows llm and caps confidence', async () => {
    const client = fakeClient({ product: 'Enzox Liquid Digestive Supplement', batches: ['ES-24011/11'], mfg: '12/2024', exp: '05/2026', manufacturer: 'M/s.Tidal Laboratories Pvt. Ltd. Patch-5, Bilaspur- 174201', reason: 'Assay/Content of Pepsin activity.', reportedBy: 'Invented Lab' })
    const res = await recoverRejected(rejected, { ...ctx, client })
    expect(res.remaining).toHaveLength(0)
    expect(res.rows).toHaveLength(1)
    const row = res.rows[0]!
    expect(row.method).toBe('llm')
    expect(row.batch).toBe('ES-24011/11')
    expect(row.mfgYm).toBe(202412)
    expect(row.expYm).toBe(202605)
    expect(row.reportedBy).toBeNull()
    expect(row.confidence).toBeLessThanOrEqual(LLM_CONFIDENCE_CAP)
    expect(row.issues).toContain('LLM value not in source, dropped: reportedBy')
    const params = client.calls[0] as { model: string; output_config: { format: { type: string } } }
    expect(params.model).toBe('test-model')
    expect(params.output_config.format.type).toBe('json_schema')
  })

  it('leaves the row rejected when the batch cannot be verified', async () => {
    const client = fakeClient({ product: 'Enzox Liquid Digestive Supplement', batches: ['ZZ12345'], mfg: null, exp: null, manufacturer: null, reason: null, reportedBy: null })
    const res = await recoverRejected(rejected, { ...ctx, client })
    expect(res.rows).toHaveLength(0)
    expect(res.remaining[0]!.reason).toContain('LLM found no verifiable batch')
  })

  it('survives a failing client', async () => {
    const client: LlmClient = { messages: { create: async () => Promise.reject(new Error('boom')) } }
    const res = await recoverRejected(rejected, { ...ctx, client })
    expect(res.remaining).toHaveLength(1)
    expect(res.warnings[0]).toContain('boom')
  })
})

describe('llmEnabled', () => {
  it('is off without an API key or when disabled', () => {
    expect(llmEnabled(parseEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv))).toBe(false)
    expect(llmEnabled(parseEnv({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'k', NAZAR_LLM_ENABLED: 'false' } as NodeJS.ProcessEnv))).toBe(false)
    expect(llmEnabled(parseEnv({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv))).toBe(true)
  })
})
