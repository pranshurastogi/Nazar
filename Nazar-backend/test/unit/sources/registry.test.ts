import { afterEach, describe, expect, it } from 'vitest'

import { setEnvForTests } from '../../../src/config/env.ts'
import { ConfigError } from '../../../src/lib/errors.ts'
import { allSources, enabledSources, getSource, sourceStatus } from '../../../src/sources/registry.ts'

afterEach(() => {
  setEnvForTests({ NAZAR_SOURCES: '' })
})

describe('source registry', () => {
  it('registers every adapter once', () => {
    const ids = allSources().map((s) => s.id)
    expect(ids).toEqual(['cdsco-online', 'cdsco-pdf', 'tn-dc', 'mh-fda', 'who-mpa', 'curated', 'tg-dca', 'ka-dc', 'kl-dc'])
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of allSources()) {
      expect(s.homepage).toMatch(/^https:\/\//)
      expect(s.jurisdiction).toMatch(/^IN(-[A-Z]{2})?$/)
      expect(s.schedule.split(' ')).toHaveLength(5)
    }
  })

  it('looks sources up by id', () => {
    expect(getSource('tn-dc')?.authority).toMatch(/Tamil Nadu/)
    expect(getSource('nope')).toBeUndefined()
  })

  it('leaves geo-blocked states off by default, with a reason', () => {
    setEnvForTests({ NAZAR_SOURCES: '' })
    const ids = enabledSources().map((s) => s.id)
    expect(ids).toEqual(['cdsco-online', 'cdsco-pdf', 'tn-dc', 'mh-fda', 'who-mpa', 'curated'])
    expect(sourceStatus(getSource('tg-dca')!)).toEqual({
      enabled: false,
      disabledReason: expect.stringMatching(/^Paused: .*outside India/),
      operatorNote: expect.stringMatching(/NAZAR_SOURCES=tg-dca/),
    })
    expect(sourceStatus(getSource('cdsco-online')!)).toEqual({ enabled: true, disabledReason: null, operatorNote: null })
  })

  it('keeps setup details out of the public reason; operators get them in operatorNote', () => {
    for (const s of allSources()) {
      const st = sourceStatus(s)
      if (st.enabled) continue
      expect(st.disabledReason).toMatch(/^Paused: /)
      // No env var names, host names or status codes in what the app shows to people.
      expect(st.disabledReason).not.toMatch(/NAZAR_|[A-Z]{2,}_[A-Z]+|\.gov\.in|\b\d{3}\b|enable/i)
      expect(st.operatorNote).toMatch(/NAZAR_SOURCES=/)
    }
    expect(sourceStatus(getSource('kl-dc')!).operatorNote).toMatch(/NAZAR_INSECURE_TLS_HOSTS/)
  })

  it('honours NAZAR_SOURCES and explicit ids, which may switch on a default-off source', () => {
    setEnvForTests({ NAZAR_SOURCES: 'tn-dc, mh-fda' })
    expect(enabledSources().map((s) => s.id)).toEqual(['tn-dc', 'mh-fda'])
    expect(enabledSources(['ka-dc']).map((s) => s.id)).toEqual(['ka-dc'])
  })

  it('fails loudly on unknown ids', () => {
    expect(() => enabledSources(['cdsco', 'tn-dc'])).toThrow(ConfigError)
  })
})
