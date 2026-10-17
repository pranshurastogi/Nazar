import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns'
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici'

import { env } from '../config/env.ts'
import { PermanentError, TransientError, errorMessage } from './errors.ts'
import { child } from './logger.ts'
import { sleep, withRetry } from './retry.ts'

const log = child('http')

export interface FetchResult {
  url: string
  finalUrl: string
  status: number
  contentType: string
  bytes: Uint8Array
  headers: Record<string, string>
  fetchedAt: string
}

export interface PoliteFetchOptions {
  accept?: string
  maxBytes?: number
  /** Skip the per-host delay (tests and robots.txt itself). */
  skipDelay?: boolean
  /** Skip the robots.txt check. */
  skipRobots?: boolean
  headers?: Record<string, string>
}

export interface PoliteHttpOptions {
  userAgent: string
  hostDelayMs: number
  timeoutMs: number
  retries: number
  insecureHosts: string[]
  fallbackIps?: Record<string, string>
  robotsTimeoutMs?: number
}

type FetchImpl = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; dispatcher?: Dispatcher; redirect: 'follow' }) => Promise<Response>

/**
 * A polite HTTP client for government sites:
 * - one request per host per NAZAR_HOST_DELAY_MS (default 10 s)
 * - honours robots.txt Disallow rules for our user agent and for *
 * - timeouts, bounded retries with jitter on 429/5xx/network errors, and a size cap
 * - optional relaxed TLS for hosts listed in NAZAR_INSECURE_TLS_HOSTS (some state sites serve broken chains)
 */
export class PoliteHttp {
  private nextSlot = new Map<string, number>()
  private robots = new Map<string, RobotsRules>()
  private readonly agent: Agent
  private readonly insecureAgent: Agent

  constructor(
    private readonly opts: PoliteHttpOptions = {
      userAgent: env().NAZAR_USER_AGENT,
      hostDelayMs: env().NAZAR_HOST_DELAY_MS,
      timeoutMs: env().NAZAR_HTTP_TIMEOUT_MS,
      retries: env().NAZAR_HTTP_RETRIES,
      insecureHosts: env().NAZAR_INSECURE_TLS_HOSTS,
      fallbackIps: env().NAZAR_HOST_FALLBACK_IPS,
      robotsTimeoutMs: env().NAZAR_ROBOTS_TIMEOUT_MS,
    },
    private readonly fetchImpl: FetchImpl = undiciFetch as unknown as FetchImpl,
    private readonly now = () => Date.now(),
    private readonly wait = sleep,
  ) {
    const lookup = fallbackLookup(opts.fallbackIps ?? {})
    this.agent = new Agent({ connect: { lookup } })
    this.insecureAgent = new Agent({ connect: { rejectUnauthorized: false, lookup } })
  }

  async get(url: string, o: PoliteFetchOptions = {}): Promise<FetchResult> {
    const u = new URL(url)
    if (!o.skipRobots && !(await this.allowed(u))) {
      throw new PermanentError(`robots.txt disallows ${u.pathname}`, { url })
    }
    return withRetry(
      async () => {
        if (!o.skipDelay) await this.throttle(u.host)
        return this.once(url, o)
      },
      {
        retries: this.opts.retries,
        baseMs: 2000,
        onRetry: (err, attempt, delay) => log.warn({ url, attempt, delay, err: errorMessage(err) }, 'retrying fetch'),
      },
    )
  }

  async getText(url: string, o: PoliteFetchOptions = {}) {
    const r = await this.get(url, { accept: 'text/html,application/xhtml+xml', ...o })
    return { ...r, text: decodeText(r.bytes, r.contentType) }
  }

  private async once(url: string, o: PoliteFetchOptions, timeoutMs = this.opts.timeoutMs): Promise<FetchResult> {
    const u = new URL(url)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        headers: {
          'user-agent': this.opts.userAgent,
          accept: o.accept ?? '*/*',
          'accept-language': 'en-IN,en;q=0.9',
          ...o.headers,
        },
        signal: controller.signal,
        redirect: 'follow',
        dispatcher: this.opts.insecureHosts.includes(u.hostname.toLowerCase()) ? this.insecureAgent : this.agent,
      })
    } catch (err) {
      clearTimeout(timer)
      throw new TransientError(`network error for ${url}: ${errorMessage(err)}`, { url }, { cause: err })
    }
    try {
      if (res.status === 429 || res.status >= 500) throw new TransientError(`HTTP ${res.status} for ${url}`, { url, status: res.status })
      if (res.status >= 400) throw new PermanentError(`HTTP ${res.status} for ${url}`, { url, status: res.status })
      const max = o.maxBytes ?? 80 * 1024 * 1024
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > max) throw new PermanentError(`response too large (${declared} bytes)`, { url })
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.byteLength > max) throw new PermanentError(`response too large (${buf.byteLength} bytes)`, { url })
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => (headers[k] = v))
      return {
        url,
        finalUrl: res.url || url,
        status: res.status,
        contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
        bytes: buf,
        headers,
        fetchedAt: new Date(this.now()).toISOString(),
      }
    } catch (err) {
      if (err instanceof PermanentError || err instanceof TransientError) throw err
      throw new TransientError(`failed reading body of ${url}: ${errorMessage(err)}`, { url }, { cause: err })
    } finally {
      clearTimeout(timer)
    }
  }

  /** Reserve the next request slot for a host and wait for it. */
  private async throttle(host: string) {
    const now = this.now()
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0)
    this.nextSlot.set(host, slot + this.opts.hostDelayMs)
    if (slot > now) await this.wait(slot - now)
  }

  private async allowed(u: URL): Promise<boolean> {
    let rules = this.robots.get(u.host)
    if (!rules) {
      try {
        // Hard deadline: a hung robots.txt (seen on state sites) must never stall discovery.
        const t = this.opts.robotsTimeoutMs ?? 10_000
        const r = await withDeadline(this.once(`${u.protocol}//${u.host}/robots.txt`, { accept: 'text/plain' }, t), t + 1000)
        rules = parseRobots(decodeText(r.bytes, r.contentType), this.opts.userAgent)
      } catch {
        rules = { disallow: [], allow: [] } // no robots.txt (or unreachable) means no restrictions
      }
      this.robots.set(u.host, rules)
    }
    return isAllowed(rules, u.pathname + u.search)
  }
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TransientError(`deadline of ${ms} ms exceeded`)), ms)
  })
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer))
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** DNS lookup that falls back to a pinned IP only when normal resolution fails (some state sites have flaky nameservers). */
export function fallbackLookup(fallbacks: Record<string, string>) {
  return (hostname: string, options: LookupOptions, cb: LookupCallback) => {
    dnsLookup(hostname, options, (err, address, family) => {
      const ip = fallbacks[hostname.toLowerCase()]
      if (err && ip) {
        if (options.all) cb(null, [{ address: ip, family: 4 }])
        else cb(null, ip, 4)
        return
      }
      cb(err, address as string | LookupAddress[], family)
    })
  }
}

export interface RobotsRules {
  disallow: string[]
  allow: string[]
}

/** Minimal robots.txt parser: groups for our agent token, falling back to `*`. */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const token = userAgent.split('/')[0]!.toLowerCase()
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = []
  let current: (typeof groups)[number] | undefined
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    const value = m[2]!.trim()
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], allow: [], disallow: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (key === 'disallow' && value) current.disallow.push(value)
    if (key === 'allow' && value) current.allow.push(value)
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a)))
  const star = groups.find((g) => g.agents.includes('*'))
  const g = mine ?? star
  return { disallow: g?.disallow ?? [], allow: g?.allow ?? [] }
}

const ruleMatches = (rule: string, path: string) => {
  const anchored = rule.endsWith('$')
  const pattern = rule.replace(/\$$/, '').split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path)
}

/** Longest matching rule wins; Allow wins ties. */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  const best = (list: string[]) => Math.max(-1, ...list.filter((r) => ruleMatches(r, path)).map((r) => r.length))
  const d = best(rules.disallow)
  const a = best(rules.allow)
  return d < 0 || a >= d
}

export function decodeText(bytes: Uint8Array, contentType = ''): string {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase()
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

let shared: PoliteHttp | undefined
export const http = () => (shared ??= new PoliteHttp())
