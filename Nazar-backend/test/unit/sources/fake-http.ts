import { readFileSync } from 'node:fs'
import path from 'node:path'

import { PoliteHttp } from '../../../src/lib/http.ts'

export const fixture = (...p: string[]) => readFileSync(path.resolve(import.meta.dirname, '../../fixtures', ...p))
export const fixtureText = (...p: string[]) => fixture(...p).toString('utf8')

export type Route = { status?: number; body: string | Uint8Array; type?: string }

/**
 * A PoliteHttp whose network is a lookup table: exact URL first, then the first matching predicate.
 * Unknown URLs (robots.txt included) answer 404. Every request is recorded with its headers.
 */
export function fakeHttp(routes: Record<string, Route> | ((url: string) => Route | undefined)) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers })
    const r = typeof routes === 'function' ? routes(url) : routes[url]
    if (!r) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
    return new Response(r.body as BodyInit, { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'text/html' } })
  }
  const http = new PoliteHttp(
    { userAgent: 'NazarTest/1.0', hostDelayMs: 0, timeoutMs: 5000, retries: 0, insecureHosts: [] },
    fetchImpl,
  )
  return { http, calls }
}
