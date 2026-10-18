import { errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'

const log = child('egress')

/**
 * Where this server's traffic leaves from, and whether CDSCO answers from there.
 *
 * CDSCO (cdsco.gov.in, cdscoonline.gov.in) refuses connections from some cloud regions:
 * from Railway's US regions every request times out within ~300 ms. Without this check a
 * mis-placed server keeps "working" while silently losing every national alert. So at
 * startup we look up our egress country, probe CDSCO, log loudly when it fails and surface
 * the result on /health and /v1/pipeline/status.
 */
export interface EgressStatus {
  checkedAt: string
  ip: string | null
  country: string | null
  city: string | null
  cdsco: 'ok' | 'unreachable' | 'unknown'
  cdscoError: string | null
  warning: string | null
}

export const CDSCO_PROBE_URL = 'https://cdscoonline.gov.in/CDSCO/reportingYears?tab=nsq'
const GEO_URL = 'https://ipinfo.io/json'

type FetchLike = (url: string, init: { signal: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export async function checkEgress(
  o: { fetchImpl?: FetchLike; timeoutMs?: number; now?: () => Date } = {},
): Promise<EgressStatus> {
  const f = o.fetchImpl ?? (fetch as unknown as FetchLike)
  const timeoutMs = o.timeoutMs ?? 15_000
  const now = o.now ?? (() => new Date())

  let ip: string | null = null
  let country: string | null = null
  let city: string | null = null
  try {
    const r = await f(GEO_URL, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
    if (r.ok) {
      const g = (await r.json()) as { ip?: string; country?: string; city?: string }
      ip = g.ip ?? null
      country = g.country ?? null
      city = g.city ?? null
    }
  } catch {
    // Geo lookup is informational only.
  }

  let cdsco: EgressStatus['cdsco'] = 'unknown'
  let cdscoError: string | null = null
  try {
    const r = await f(CDSCO_PROBE_URL, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://cdscoonline.gov.in/CDSCO/viewPublicNSQDrug' },
    })
    cdsco = r.ok ? 'ok' : 'unreachable'
    if (!r.ok) cdscoError = `HTTP ${r.status}`
  } catch (err) {
    cdsco = 'unreachable'
    const cause = (err as { cause?: { code?: string } }).cause?.code
    cdscoError = cause ?? errorMessage(err)
  }

  const where = [city, country].filter(Boolean).join(', ') || 'this region'
  const warning =
    cdsco === 'unreachable'
      ? `CDSCO is unreachable from ${where} (${cdscoError}). National alerts will not be harvested. ` +
        'Host the server in Asia (Railway: Singapore, asia-southeast1-eqsg3a; Fly.io: bom). See Nazar-backend/docs/deploy.md.'
      : null
  return { checkedAt: now().toISOString(), ip, country, city, cdsco, cdscoError, warning }
}

let latest: EgressStatus | null = null
export const egressStatus = () => latest

/** Runs the check once in the background (never blocks startup) and logs the outcome. */
export function startEgressCheck(o: Parameters<typeof checkEgress>[0] = {}): Promise<EgressStatus> {
  return checkEgress(o).then((s) => {
    latest = s
    if (s.warning) log.error({ egress: s }, s.warning)
    else log.info({ country: s.country, city: s.city, cdsco: s.cdsco }, 'egress check passed')
    return s
  })
}
