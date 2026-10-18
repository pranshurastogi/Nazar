import { readFileSync } from 'node:fs'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import type { AlertDTO } from '../api/dto.ts'
import { CATEGORY_LABEL, FAILURE_LABEL, type Category, type Failure } from '../domain/vocab.ts'
import { errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import type { ArkivProof } from './proof.ts'

/**
 * Nazar as an MCP server: the same answers as the app (four result states, proof links), shaped
 * for AI assistants. The business rules live in the API (createApp's check, the ledger queries);
 * this file only adapts them into tools, resources and a prompt, and adds the honesty rules an
 * assistant must follow when it repeats an answer to a person.
 */

const log = child('mcp')

export const SITE = 'https://nazar-nu.vercel.app'
const REPO = 'https://github.com/pranshurastogi/Nazar'

export const MCP_VERSION: string = (() => {
  try {
    return String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
})()

export type McpCheckState = 'flagged' | 'retracted' | 'no_alert' | 'unreadable'

export interface McpCheck {
  state: McpCheckState
  batch: string
  asOf: string
  alerts: AlertDTO[]
  suggestion?: string
  source: 'ledger' | 'arkiv'
}

export interface McpSource {
  id: string
  authority: string
  jurisdiction: string
  homepage: string
  description: string
  schedule: string
  enabled: boolean
  disabledReason?: string | null
  lastRun: unknown
}

export interface McpDeps {
  check: (batch: string) => Promise<McpCheck>
  alerts: (q: { limit: number; minSeverity?: number; peds?: boolean; state?: string; source?: string }) => { items: AlertDTO[]; total: number }
  search: (q: string, limit: number) => AlertDTO[]
  caseItems: (caseId: string) => AlertDTO[]
  sources: () => Promise<McpSource[]>
  /** Live Arkiv read; null when this process has no Arkiv client wired. */
  proof: ((entityKey: string) => Promise<ArkivProof>) | null
  /** Called before each tool runs; returns seconds to wait when the caller is over its limit. */
  allowTool?: () => number
}

export const NOT_A_CERTIFICATE =
  'This is not a safety certificate: it only means no regulator alert that Nazar reads names this batch yet. Alerts can lag, and a fake pack can carry a clean batch number.'

export const INSTRUCTIONS = `Nazar checks Indian medicine batch numbers against official drug-regulator alerts (CDSCO, state drug controllers, WHO Medical Product Alerts) and publishes every alert as a verifiable entity on Arkiv (Tiramisu testnet).

Rules for repeating Nazar's answers to a person:
1. Every check has exactly one of four states: "flagged", "retracted", "no_alert" (say "No alert found") or "unreadable" (say "Can't tell"). Report the state as given; never upgrade or soften it.
2. Never say a medicine or batch is "safe", "genuine", "fine" or "approved". "No alert found" is NOT a safety certificate; always say so.
3. When a batch is flagged, name the regulator, the notice title and date, link the notice URL and the Arkiv entity (explorer link), and give the reason in the regulator's words. Advise: stop using it, keep the pack, return it to the chemist, and see a doctor if it was taken. Do not blame a company beyond what the notice says.
4. A "did you mean" suggestion is never a flag. Ask the person to re-read the batch number on the pack and check again.
5. The same batch number can be used by different manufacturers. Before concluding, confirm the brand and manufacturer on the pack match the alert.
6. Use arkiv_proof to show that an alert can be verified directly on Arkiv, without trusting Nazar.
7. Out of scope: general medicine information, dosing, interactions and medical advice. Point people to a pharmacist or doctor.

All tools are read-only. Limit: 60 tool calls per minute per client.`

// ---- shaping

const ym = (v: number | null | undefined) => (v ? `${Math.floor(v / 100)}-${String(v % 100).padStart(2, '0')}` : null)

/** Child Shield (the app's Q4): a paediatric product at severity 4 or above. */
const childShield = (a: Pick<AlertDTO, 'peds' | 'severity'>) => a.peds && a.severity >= 4

/** One alert, trimmed to what an assistant needs to cite it. */
export function alertOut(a: AlertDTO) {
  return {
    batch: a.batch,
    brand: a.brand,
    product: a.product,
    generic: a.generic,
    form: a.form,
    manufacturer: a.manufacturer,
    manufacturerNote: a.manufacturerRole === 'label_claim' ? 'Spurious: this is the maker named on the fake label, not the culprit.' : null,
    category: a.category,
    categoryLabel: CATEGORY_LABEL[a.category as Category] ?? a.category,
    failures: a.failures.map((f) => FAILURE_LABEL[f as Failure] ?? f),
    reason: a.reason,
    severity: a.severity,
    severityRules: a.severityRules,
    paediatric: a.peds,
    childShield: childShield(a),
    madeIn: a.state,
    mfg: ym(a.mfgYm),
    expiry: ym(a.expYm),
    alertMonth: ym(a.alertYm),
    retracted: a.retracted,
    regulator: { authority: a.authority, sourceId: a.sourceId, jurisdiction: a.jurisdiction },
    notice: { title: a.noticeTitle, date: a.noticeDate, url: a.noticeUrl || null, sha256: a.noticeSha || null },
    arkiv: a.entityKey
      ? { entityKey: a.entityKey, explorer: a.explorer.entity, tx: a.explorer.tx, creator: a.creator }
      : { entityKey: null, explorer: null, tx: null, creator: null, note: 'Not on Arkiv yet (queued for publishing).' },
    caseId: a.caseId,
    rid: a.rid,
    extraction: { method: a.method, confidence: a.confidence, tier: a.tier },
  }
}

function alertLine(a: AlertDTO): string {
  const bits = [
    `${a.product || a.brand} (batch ${a.batch})`,
    a.manufacturer ? `${a.manufacturerRole === 'label_claim' ? 'label claims ' : ''}${a.manufacturer}` : null,
    `${CATEGORY_LABEL[a.category as Category] ?? a.category}: ${a.reason || a.failures.join(', ')}`,
    `severity ${a.severity}/5${childShield(a) ? ', Child Shield' : a.peds ? ', paediatric' : ''}`,
    `${a.authority || a.sourceId}, "${a.noticeTitle}"${a.noticeDate ? ` (${a.noticeDate})` : ''}${a.noticeUrl ? ` ${a.noticeUrl}` : ''}`,
    a.explorer.entity ? `Arkiv ${a.explorer.entity}` : 'not on Arkiv yet',
    a.retracted ? 'RETRACTED' : null,
  ]
  return `- ${bits.filter(Boolean).join(' | ')}`
}

const lines = (items: AlertDTO[], max = 10) =>
  [...items.slice(0, max).map(alertLine), ...(items.length > max ? [`- …and ${items.length - max} more (see structured content)`] : [])].join('\n')

export function checkText(r: McpCheck): string {
  const when = r.asOf.slice(0, 16).replace('T', ' ') + ' UTC'
  switch (r.state) {
    case 'flagged':
      return [
        `FLAGGED: batch ${r.batch} is named in ${r.alerts.filter((a) => !a.retracted).length} official regulator alert(s) (as of ${when}).`,
        lines(r.alerts),
        'Confirm the brand and manufacturer on the pack match. If they do: stop using it, keep the pack, return it to the chemist, and see a doctor if it was taken.',
      ].join('\n')
    case 'retracted':
      return [`RETRACTED: an alert on batch ${r.batch} was withdrawn or corrected. The original stays on record (as of ${when}).`, lines(r.alerts)].join('\n')
    case 'no_alert':
      return `NO ALERT FOUND: no official alert for batch ${r.batch} in Nazar's records as of ${when}. ${NOT_A_CERTIFICATE} Check the batch number again on the pack, and ask a pharmacist if in doubt.`
    case 'unreadable':
      return r.suggestion
        ? `CAN'T TELL: no exact match for "${r.batch}", but an alerted batch looks similar: "${r.suggestion}" (0/O, 1/I/L, 5/S and 8/B are easy to misread). This is NOT a flag. Re-read the pack and check again with the exact characters.`
        : `CAN'T TELL: "${r.batch}" does not look like a batch number. Batch numbers are 2–24 letters and digits, printed near "B. No." or "Batch" with the expiry date.`
  }
}

// ---- tool plumbing

const ok = (text: string, structured: Record<string, unknown>): CallToolResult => ({ content: [{ type: 'text', text }], structuredContent: structured })
const fail = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true })

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const

/** Rate limit, timing and outcome-only logging around every tool (arguments are never logged). */
function guarded<A>(deps: McpDeps, name: string, fn: (args: A) => Promise<CallToolResult> | CallToolResult) {
  return async (args: A): Promise<CallToolResult> => {
    const wait = deps.allowTool?.() ?? 0
    if (wait > 0) {
      log.info({ tool: name, outcome: 'rate_limited' }, 'mcp tool')
      return fail(`Rate limited: Nazar allows 60 tool calls per minute per client. Try again in ${wait} s.`)
    }
    const t0 = performance.now()
    try {
      const res = await fn(args)
      const outcome = res.isError ? 'error' : String((res.structuredContent as { state?: string } | undefined)?.state ?? 'ok')
      log.info({ tool: name, outcome, ms: Math.round(performance.now() - t0) }, 'mcp tool')
      return res
    } catch (err) {
      log.warn({ tool: name, outcome: 'failed', err: errorMessage(err) }, 'mcp tool')
      return fail(`Nazar could not answer right now (${errorMessage(err)}). Try again shortly.`)
    }
  }
}

const hexId = z.string().regex(/^[0-9a-f]{8,64}$/, 'must be a hex id')
const sourceId = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, 'must be a source id like cdsco-online')

// ---- static resources

export const ABOUT_MD = `# Nazar

Nazar checks Indian medicine batch numbers against official drug-regulator alerts: CDSCO (national NSQ and spurious lists, PDF alerts), state drug controllers (Tamil Nadu, Maharashtra, …) and WHO Medical Product Alerts naming Indian products.

- Web app: ${SITE} (Check, Feed, Cabinet, Arkiv directory)
- Code and data contract: ${REPO}
- Every alert is a read-only entity on Arkiv (Tiramisu testnet, chain 7738577), created by the Nazar publisher wallet and linked to the regulator notice it came from.

## The four answers
- **Flagged**: a regulator named this exact batch as not of standard quality, spurious, adulterated or misbranded.
- **Retracted**: an alert on this batch was withdrawn or corrected; the original stays on record.
- **No alert found**: no regulator alert Nazar reads names this batch yet. ${NOT_A_CERTIFICATE}
- **Can't tell**: the batch number could not be read, or only a look-alike matched ("did you mean"). Never a flag.

## Severity (1–5)
A versioned rule table, not judgement: base score from the worst failure (spurious or toxic glycol 5; identification, sterility, endotoxin, particulate 4; assay, impurities, microbial 3; dissolution, disintegration, labelling 2), +1 for paediatric formulations, +1 for injectables, capped at 5. Every alert lists the rules that fired. Child Shield = paediatric product at severity 4 or above.

## Not covered
General medicine information, dosing and medical advice. Ask a pharmacist or doctor.
`

export const SCHEMA_MD = `# Nazar on Arkiv: data contract (summary)

Network: Arkiv Tiramisu testnet (chain 7738577). Every entity carries \`project = "nazar-in-batch-alerts"\`, \`t\` (type) and \`v\` (schema version). Only entities created by the Nazar publisher wallet are official; every read uses \`.createdBy(PUBLISHER)\`.

## Entity types
- **notice**: one regulator document. Attributes: src, juris, notice_ym, sha (SHA-256 of the downloaded bytes), rows, parser. Payload: title, authority, URL, date. Lifetime 5 years. Flag: readonly.
- **alert**: one batch named in a notice. Attributes: batch (normalised key, SR-13 → sr13), batch_raw, case, rid, brand, form, cat (nsq/spurious/adulterated/misbranded), fail, sev (1–5), peds, mfr, plant, state, mfg_ym, exp_ym, alert_ym, src, juris, notice (key of the parent notice), conf, method, tier. Payload: product, generic, manufacturer, reason as printed, severity rules, notice title/URL/date. Lifetime: batch expiry + 180 days. Flags: readonly + permissionlessExtension (anyone can keep it alive).
- **retraction**: a correction, never a silent edit. Attributes: alert (key), case, reason, src.
- **heartbeat**: pipeline liveness lease, renewed every 5 minutes, 20-minute lifetime.
- **snapshot**: daily offline pack of batch keys, 7 days.

## Queries
Q1 check a batch: eq(t,"alert"), eq(batch,"sr13"). Q3 feed: gte(alert_ym, YYYYMM) [+ eq(state)]. Q4 Child Shield: eq(peds,1), gte(sev,4). Q5 Batch Passport: eq(case, id). Q6 heartbeat. Q7 notices: eq(t,"notice").

Full contract: ${REPO}/blob/main/arkiv/schema.md
`

// ---- the server

export function createNazarMcp(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'nazar', version: MCP_VERSION, title: 'Nazar: Indian medicine batch alerts', websiteUrl: SITE }, { instructions: INSTRUCTIONS })

  server.registerTool(
    'check_batch',
    {
      title: 'Check a medicine batch',
      description:
        'Check one Indian medicine batch number (printed as "B. No." / "Batch" on the pack, e.g. "SR-13") against official regulator alerts. Returns state flagged | retracted | no_alert | unreadable, every matching alert with regulator notice and Arkiv proof links, and a "did you mean" suggestion for look-alikes. no_alert is not a safety certificate.',
      inputSchema: { batch: z.string().trim().min(1).max(64).describe('Batch number exactly as printed on the pack, e.g. "SR-13"') },
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    guarded(deps, 'check_batch', async ({ batch }: { batch: string }) => {
      const r = await deps.check(batch)
      return ok(checkText(r), {
        state: r.state,
        batch: r.batch,
        asOf: r.asOf,
        answeredFrom: r.source,
        alerts: r.alerts.map(alertOut),
        ...(r.suggestion ? { suggestion: r.suggestion, suggestionNote: 'A look-alike is never a flag: re-read the pack and check again.' } : {}),
        ...(r.state === 'no_alert' ? { notice: NOT_A_CERTIFICATE } : {}),
        links: { app: SITE, arkivDirectory: `${SITE}/arkiv?type=alert&batch=${encodeURIComponent(r.batch)}` },
      })
    }),
  )

  server.registerTool(
    'search_alerts',
    {
      title: 'Search alerts',
      description:
        'Full-text search over published alerts by brand, product, generic name, manufacturer or failure reason (e.g. "coldrif", "paracetamol", "diethylene glycol", "Sresan"). Use check_batch, not this, when the person has a batch number.',
      inputSchema: {
        query: z.string().trim().min(2).max(100).describe('Words to search for'),
        limit: z.number().int().min(1).max(50).default(10).describe('Maximum alerts to return (1–50, default 10)'),
      },
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    guarded(deps, 'search_alerts', ({ query, limit }: { query: string; limit: number }) => {
      const items = deps.search(query, limit)
      const text = items.length ? `${items.length} alert(s) matching "${query}":\n${lines(items)}` : `No alerts match "${query}". That is not evidence that any product is safe.`
      return ok(text, { query, count: items.length, items: items.map(alertOut) })
    }),
  )

  server.registerTool(
    'recent_alerts',
    {
      title: 'Recent alerts',
      description:
        'The newest batch alerts, newest month first. Filter by minimum severity (1–5), Child Shield (paediatric products at severity ≥ 4), manufacturing state (ISO code like IN-TN) or source regulator id (see list_sources).',
      inputSchema: {
        minSeverity: z.number().int().min(1).max(5).optional().describe('Only alerts at or above this severity'),
        childShield: z.boolean().optional().describe('Only paediatric products at severity 4 or above'),
        state: z.string().regex(/^IN-[A-Z]{2}$/, 'must be an ISO 3166-2:IN code like IN-TN').optional().describe('Manufacturing state, e.g. IN-TN, IN-GJ'),
        source: sourceId.optional().describe('Source id, e.g. cdsco-online, cdsco-pdf, tn-dc, mh-fda, who-mpa'),
        limit: z.number().int().min(1).max(50).default(10).describe('Maximum alerts to return (1–50, default 10)'),
      },
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    guarded(deps, 'recent_alerts', (a: { minSeverity?: number; childShield?: boolean; state?: string; source?: string; limit: number }) => {
      const minSeverity = a.childShield ? Math.max(4, a.minSeverity ?? 4) : a.minSeverity
      const { items, total } = deps.alerts({ limit: a.limit, minSeverity, peds: a.childShield ? true : undefined, state: a.state, source: a.source })
      const text = items.length ? `${items.length} of ${total} alert(s), newest first:\n${lines(items)}` : 'No alerts match these filters.'
      return ok(text, { total, count: items.length, filters: { minSeverity: minSeverity ?? null, childShield: !!a.childShield, state: a.state ?? null, source: a.source ?? null }, items: items.map(alertOut) })
    }),
  )

  server.registerTool(
    'get_case',
    {
      title: 'Batch Passport',
      description:
        'Batch Passport: every notice and regulator that named the same batch (one case), oldest first. Pass the caseId from a check_batch, search_alerts or recent_alerts result.',
      inputSchema: { caseId: hexId.describe('caseId from another Nazar result') },
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    guarded(deps, 'get_case', ({ caseId }: { caseId: string }) => {
      const items = deps.caseItems(caseId)
      if (!items.length) return fail(`No case ${caseId}. Use the caseId from a check_batch or search result.`)
      return ok(`Batch Passport for ${items[0]!.batch}: named in ${items.length} notice(s).\n${lines(items, 20)}`, { caseId, batch: items[0]!.batch, count: items.length, items: items.map(alertOut) })
    }),
  )

  server.registerTool(
    'list_sources',
    {
      title: 'Regulator sources',
      description: 'The drug regulators and alert lists Nazar reads, whether each is enabled (and why not), its schedule and when it was last checked.',
      inputSchema: {},
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    guarded(deps, 'list_sources', async () => {
      const items = await deps.sources()
      const checked = (s: McpSource) => {
        const ms = (s.lastRun as { lastCheckedMs?: number; ok?: boolean } | null)?.lastCheckedMs
        if (!ms) return 'not checked yet'
        return `last checked ${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC${(s.lastRun as { ok?: boolean }).ok === false ? ' (failed)' : ''}`
      }
      const text = items
        .map((s) => `- ${s.id}: ${s.authority} (${s.jurisdiction}), ${s.enabled ? `enabled, ${checked(s)}` : `disabled${s.disabledReason ? `: ${s.disabledReason}` : ''}`}, ${s.homepage}`)
        .join('\n')
      return ok(`${items.length} sources:\n${text}`, { count: items.length, items })
    }),
  )

  server.registerTool(
    'arkiv_proof',
    {
      title: 'Verify on Arkiv',
      description:
        'Reads one entity directly from the Arkiv blockchain by its entity key (the arkiv.entityKey in an alert), not from Nazar\'s database: attributes, payload, creator, whether the creator is the official Nazar publisher, flags (readonly, permissionless extension) and expiry. Use it to prove an alert is genuine and unaltered.',
      inputSchema: { entityKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte entity key (0x + 64 hex)').describe('Arkiv entity key, 0x + 64 hex') },
      annotations: { ...READ_ONLY, idempotentHint: false, openWorldHint: true },
    },
    guarded(deps, 'arkiv_proof', async ({ entityKey }: { entityKey: string }) => {
      if (!deps.proof) return fail('Arkiv reads are not available on this server right now.')
      const p = await deps.proof(entityKey)
      const text = [p.verdict, p.found ? `Explorer: ${p.explorer.entity}${p.entity?.expiresAtEstimate ? ` | expires about ${p.entity.expiresAtEstimate.slice(0, 10)}` : ''}` : null].filter(Boolean).join('\n')
      return ok(text, p as unknown as Record<string, unknown>)
    }),
  )

  server.registerResource('about', 'nazar://about', { title: 'About Nazar', description: 'What Nazar is, the four answers, severity and scope', mimeType: 'text/markdown' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: ABOUT_MD }],
  }))
  server.registerResource('schema', 'nazar://schema', { title: 'Arkiv data contract', description: 'Entity types, attributes, lifetimes and queries Nazar uses on Arkiv', mimeType: 'text/markdown' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: SCHEMA_MD }],
  }))

  server.registerPrompt(
    'check_my_medicine',
    {
      title: 'Check my medicine',
      description: 'Walks a person through finding the batch number on a medicine pack and checking it with Nazar.',
      argsSchema: { medicine: z.string().max(100).optional().describe('Medicine name, if known') },
    },
    ({ medicine }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I want to check whether my medicine${medicine ? ` (${medicine})` : ''} has been named in an official Indian drug-regulator alert.

Help me step by step:
1. Tell me where to find the batch number: on the strip, bottle label or carton, next to "B. No.", "Batch No." or "Lot", usually printed near the manufacturing and expiry dates. Ask me to type it exactly, letter by letter (0 vs O, 1 vs I, 5 vs S, 8 vs B matter).
2. Call check_batch with it and tell me the result state in plain words, with the regulator notice and the Arkiv proof link.
3. If it is flagged, ask me to confirm the brand and manufacturer printed on the pack match the alert, and tell me what to do next.
4. If it says "No alert found", say clearly that this is not a safety certificate.
5. If it says "Can't tell" with a suggestion, ask me to re-read the pack rather than assuming it is flagged.
Never tell me the medicine is safe.`,
          },
        },
      ],
    }),
  )

  return server
}
