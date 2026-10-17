import path from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

loadDotenv({ quiet: true })

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())))

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined))

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  // Arkiv (Tiramisu testnet)
  ARKIV_RPC_URL: z.url().default('https://rpc.tiramisu.db-chain.testnet.arkiv.network'),
  ARKIV_WS_URL: z.string().default('wss://rpc.tiramisu.db-chain.testnet.arkiv.network'),
  ARKIV_API_KEY: optional,
  ARKIV_CHAIN_ID: z.coerce.number().int().default(7738577),
  ARKIV_EXPLORER_URL: z.url().default('https://tiramisu.explorer.arkiv.network'),

  // Wallets. The publisher key signs every write; the root address pins the roster.
  NAZAR_PUBLISHER_PRIVATE_KEY: optional.refine((v) => v === undefined || /^0x[0-9a-fA-F]{64}$/.test(v), {
    message: 'must be a 0x-prefixed 32-byte hex private key',
  }),
  NAZAR_ROOT_ADDRESS: optional,
  NAZAR_PUBLISH_MODE: z.enum(['dry-run', 'live']).default('dry-run'),
  NAZAR_APP_TAG: z.string().default('nazar'),

  // Local state
  NAZAR_DATA_DIR: z.string().default('./data'),

  // Harvesting
  NAZAR_USER_AGENT: z
    .string()
    .default('NazarBot/0.1 (+https://github.com/pranshurastogi/Nazar; public-health alert indexer)'),
  NAZAR_HOST_DELAY_MS: z.coerce.number().int().min(0).default(10_000),
  NAZAR_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
  NAZAR_HTTP_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  // Read-only public documents from hosts that serve incomplete or expired certificate chains.
  NAZAR_INSECURE_TLS_HOSTS: z
    .string()
    .default('drugscontrol.tn.gov.in,dc.kerala.gov.in')
    .transform((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
  /** Fallback IPs for hosts with flaky DNS, used only when normal resolution fails: "host=ip,host=ip". */
  NAZAR_HOST_FALLBACK_IPS: z
    .string()
    .default('fda.maharashtra.gov.in=164.100.51.41')
    .transform((v) =>
      Object.fromEntries(
        v.split(',').map((p) => p.trim().split('=').map((x) => x.trim().toLowerCase())).filter((p) => p.length === 2 && p[0] && p[1]),
      ) as Record<string, string>,
    ),
  NAZAR_ROBOTS_TIMEOUT_MS: z.coerce.number().int().min(500).default(10_000),
  NAZAR_SOURCES: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  NAZAR_MAX_DOCS_PER_RUN: z.coerce.number().int().min(1).default(6),
  // Watchdogs: a document or source that runs past these is marked failed and the run moves on.
  NAZAR_DOC_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300_000),
  NAZAR_SOURCE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(900_000),

  // Extraction
  NAZAR_OCR_ENABLED: bool(true),
  NAZAR_OCR_LANG: z.string().default('eng'),
  NAZAR_OCR_MAX_PAGES: z.coerce.number().int().min(1).default(40),
  ANTHROPIC_API_KEY: optional,
  NAZAR_LLM_MODEL: z.string().default('claude-haiku-5-5'),
  NAZAR_LLM_ENABLED: bool(true),

  // API
  PORT: z.coerce.number().int().default(8787),
  NAZAR_CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3123')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  // Scheduler
  NAZAR_CRON_CDSCO: z.string().default('0 */6 * * *'),
  NAZAR_CRON_STATES: z.string().default('30 */3 * * *'),
  NAZAR_CRON_HEARTBEAT: z.string().default('*/5 * * * *'),
})

export type Env = z.infer<typeof EnvSchema>

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid Nazar backend configuration:\n${issues}`)
  }
  return parsed.data
}

let cached: Env | undefined
export function env(): Env {
  cached ??= parseEnv()
  return cached
}

/** For tests: replace the cached config. */
export function setEnvForTests(overrides: Partial<Record<keyof Env, string>>): Env {
  cached = parseEnv({ ...process.env, ...overrides } as NodeJS.ProcessEnv)
  return cached
}

export const dataPath = (...parts: string[]) => path.resolve(env().NAZAR_DATA_DIR, ...parts)

/** RPC URL with the API key in the path, the form Arkiv documents for the JS SDK. */
export function arkivHttpUrl(e: Env = env()): string {
  return e.ARKIV_API_KEY ? `${e.ARKIV_RPC_URL.replace(/\/$/, '')}/${e.ARKIV_API_KEY}` : e.ARKIV_RPC_URL
}

export function arkivWsUrl(e: Env = env()): string {
  return e.ARKIV_API_KEY ? `${e.ARKIV_WS_URL.replace(/\/$/, '')}/${e.ARKIV_API_KEY}` : e.ARKIV_WS_URL
}
