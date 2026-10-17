import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { LookupAddress } from 'node:dns'
import { afterEach, describe, expect, it } from 'vitest'

import { TransientError } from '../../src/lib/errors.ts'
import { PoliteHttp, fallbackLookup, type PoliteHttpOptions } from '../../src/lib/http.ts'

const opts = (o: Partial<PoliteHttpOptions> = {}): PoliteHttpOptions => ({
  userAgent: 'NazarTest/1.0',
  hostDelayMs: 0,
  timeoutMs: 400,
  retries: 0,
  insecureHosts: [],
  ...o,
})

const servers: Server[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  }
})

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const s = createServer(handler)
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}

async function elapsed<T>(p: Promise<T>): Promise<{ ms: number; err: unknown }> {
  const t0 = Date.now()
  try {
    await p
    return { ms: Date.now() - t0, err: null }
  } catch (err) {
    return { ms: Date.now() - t0, err }
  }
}

describe('PoliteHttp deadlines', () => {
  it('rejects with TransientError when a server accepts but never sends headers', async () => {
    const base = await serve(() => {}) // hold the request open forever
    const { ms, err } = await elapsed(new PoliteHttp(opts()).get(`${base}/slow.pdf`, { skipRobots: true }))
    expect(err).toBeInstanceOf(TransientError)
    expect(ms).toBeLessThan(2000)
  })

  it('rejects with TransientError when the body stalls after the headers', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': '100000' })
      res.write('%PDF-1.4 partial') // then nothing, connection left open
    })
    const { ms, err } = await elapsed(new PoliteHttp(opts()).get(`${base}/stall.pdf`, { skipRobots: true }))
    expect(err).toBeInstanceOf(TransientError)
    expect((err as Error).message).toMatch(/timed out|body|abort/i)
    expect(ms).toBeLessThan(2000)
  })

  it('is released even when fetch ignores the abort signal and never settles', async () => {
    const never = () => new Promise<Response>(() => {})
    const { ms, err } = await elapsed(new PoliteHttp(opts(), never).get('https://example.gov.in/x.pdf', { skipRobots: true }))
    expect(err).toBeInstanceOf(TransientError)
    expect((err as Error).message).toMatch(/timed out after 400 ms/)
    expect(ms).toBeLessThan(1500)
  })

  it('is released when the body promise never settles after headers arrived', async () => {
    const stuckBody = async () =>
      ({ status: 200, url: '', headers: new Headers({ 'content-type': 'text/html' }), arrayBuffer: () => new Promise(() => {}) }) as unknown as Response
    const { ms, err } = await elapsed(new PoliteHttp(opts(), stuckBody).get('https://example.gov.in/', { skipRobots: true }))
    expect(err).toBeInstanceOf(TransientError)
    expect(ms).toBeLessThan(1500)
  })

  it('bounds the whole retry sequence', async () => {
    const base = await serve(() => {})
    const http = new PoliteHttp(opts({ timeoutMs: 300, retries: 1 }), undefined, undefined, async () => {})
    const { ms, err } = await elapsed(http.get(`${base}/x`, { skipRobots: true }))
    expect(err).toBeInstanceOf(TransientError)
    // two attempts of 300 ms plus one backoff (≤ 2 s at baseMs 2000)
    expect(ms).toBeLessThan(4000)
  })

  it('still reads a normal response', async () => {
    const base = await serve((_req, res) => res.end('hello'))
    const r = await new PoliteHttp(opts()).getText(`${base}/ok`, { skipRobots: true })
    expect(r.text).toBe('hello')
  })

  it('does not let a hung robots.txt block the request', async () => {
    const base = await serve((req, res) => {
      if (req.url === '/robots.txt') return // never answers
      res.end('ok')
    })
    const r = await new PoliteHttp(opts({ robotsTimeoutMs: 300 })).getText(`${base}/page`)
    expect(r.text).toBe('ok')
  })
})

describe('fallbackLookup', () => {
  type Cb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
  const fails = (_h: string, _o: unknown, cb: Cb) => {
    const err: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND')
    err.code = 'ENOTFOUND'
    cb(err, '')
  }
  const answers = (_h: string, o: { all?: boolean }, cb: Cb) =>
    o.all ? cb(null, [{ address: '10.0.0.1', family: 4 }]) : cb(null, '10.0.0.1', 4)
  const silent = () => {}
  const call = (lookup: ReturnType<typeof fallbackLookup>, ...args: unknown[]) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) =>
      (lookup as (...a: unknown[]) => void)(...args, (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => resolve({ err, address, family })),
    )

  it('accepts (host, cb), (host, family, cb) and (host, options, cb)', async () => {
    const l = fallbackLookup({}, { resolve: answers })
    expect(await call(l, 'a.gov.in')).toMatchObject({ err: null, address: '10.0.0.1', family: 4 })
    expect(await call(l, 'a.gov.in', 4)).toMatchObject({ err: null, address: '10.0.0.1', family: 4 })
    expect(await call(l, 'a.gov.in', { all: true })).toMatchObject({ err: null, address: [{ address: '10.0.0.1', family: 4 }] })
    expect(await call(l, 'a.gov.in', undefined)).toMatchObject({ err: null, address: '10.0.0.1' })
  })

  it('falls back to the pinned IP in the shape the caller asked for', async () => {
    const l = fallbackLookup({ 'fda.maharashtra.gov.in': '164.100.51.41' }, { resolve: fails })
    expect(await call(l, 'FDA.maharashtra.gov.in', {})).toMatchObject({ err: null, address: '164.100.51.41', family: 4 })
    expect(await call(l, 'fda.maharashtra.gov.in', { all: true })).toMatchObject({ address: [{ address: '164.100.51.41', family: 4 }] })
    expect((await call(l, 'other.gov.in', {})).err?.code).toBe('ENOTFOUND')
  })

  it('always calls back when the resolver never answers', async () => {
    const pinned = fallbackLookup({ 'x.gov.in': '1.2.3.4' }, { resolve: silent, timeoutMs: 50 })
    expect(await call(pinned, 'x.gov.in', { all: true })).toMatchObject({ err: null, address: [{ address: '1.2.3.4', family: 4 }] })
    const plain = fallbackLookup({}, { resolve: silent, timeoutMs: 50 })
    expect((await call(plain, 'y.gov.in', {})).err?.code).toBe('ETIMEOUT')
  })

  it('calls back when the resolver throws, and only once', async () => {
    let calls = 0
    const l = fallbackLookup({}, {
      resolve: (_h, _o, cb) => {
        cb(null, '10.0.0.2', 4)
        cb(null, '10.0.0.3', 4)
      },
    })
    ;(l as (...a: unknown[]) => void)('a.gov.in', {}, () => calls++)
    expect(calls).toBe(1)
    const throwing = fallbackLookup({}, { resolve: () => { throw new Error('bad hostname') } })
    expect((await call(throwing, 'a.gov.in', {})).err?.message).toBe('bad hostname')
  })
})
