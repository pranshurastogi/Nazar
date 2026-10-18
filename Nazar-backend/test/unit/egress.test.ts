import { describe, expect, it } from 'vitest'

import { CDSCO_PROBE_URL, checkEgress } from '../../src/pipeline/egress.ts'

const geo = (country: string, city: string) => ({ ok: true, status: 200, json: async () => ({ ip: '1.2.3.4', country, city }) })
const now = () => new Date('2026-10-18T00:00:00Z')

describe('checkEgress', () => {
  it('passes when CDSCO answers', async () => {
    const s = await checkEgress({
      now,
      fetchImpl: async (url) => (url === CDSCO_PROBE_URL ? { ok: true, status: 200, json: async () => [] } : geo('SG', 'Singapore')),
    })
    expect(s).toMatchObject({ country: 'SG', cdsco: 'ok', warning: null })
  })

  it('warns loudly when CDSCO refuses connections (e.g. a US region)', async () => {
    const s = await checkEgress({
      now,
      fetchImpl: async (url) => {
        if (url === CDSCO_PROBE_URL) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } })
        return geo('US', 'Santa Clara')
      },
    })
    expect(s.cdsco).toBe('unreachable')
    expect(s.cdscoError).toBe('ETIMEDOUT')
    expect(s.warning).toMatch(/CDSCO is unreachable from Santa Clara, US/)
    expect(s.warning).toMatch(/Singapore/)
  })

  it('treats an HTTP error as unreachable and survives a failed geo lookup', async () => {
    const s = await checkEgress({
      now,
      fetchImpl: async (url) => {
        if (url === CDSCO_PROBE_URL) return { ok: false, status: 403, json: async () => ({}) }
        throw new Error('geo down')
      },
    })
    expect(s).toMatchObject({ country: null, cdsco: 'unreachable', cdscoError: 'HTTP 403' })
    expect(s.warning).toMatch(/this region/)
  })
})
