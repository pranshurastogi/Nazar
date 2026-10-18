import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApp, type NazarApp } from '../../src/api/app.ts'
import { confusionKey } from '../../src/domain/batch.ts'
import type { ProofClient } from '../../src/mcp/proof.ts'
import { resolveRows } from '../../src/resolve/index.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'

const PUB = '0x1111111111111111111111111111111111111111' as const
const KEY = `0x${'ab'.repeat(32)}`
const BASE = 'http://nazar.test'

function seeded() {
  const ledger = new Ledger(':memory:')
  const who = rawDoc({ title: 'WHO Medical Product Alert N°5/2025', sourceId: 'who-mpa', noticeYm: 202510, authority: 'WHO' })
  const tn = rawDoc({ title: 'TN NSQ list June 2026', sourceId: 'tn-dc', jurisdiction: 'IN-TN', noticeYm: 202606 })
  const all = [
    { doc: who, rows: [
      row(who, 1, { product: 'COLDRIF Syrup (paediatric)', batch: 'SR-13', reason: 'Diethylene glycol 48.6% w/v', manufacturer: 'Sresan Pharmaceutical, Kancheepuram-602106, Tamil Nadu', expYm: 202704 }),
      row(who, 2, { product: 'Respifresh TR syrup', batch: 'R01GL2523', reason: 'Diethylene glycol 1.34%', manufacturer: 'Rednex Pharmaceutical Pvt Ltd, Ahmedabad 382213 Gujarat' }),
    ] },
    { doc: tn, rows: [row(tn, 1, { batch: 'TN-77', reason: 'Dissolution', manufacturer: 'Example Labs Ltd, Chennai 600001' })] },
  ]
  for (const { doc, rows } of all) {
    ledger.upsertDocument(doc)
    const r = resolveRows(doc, rows)
    ledger.upsertAlerts([...r.alerts, ...r.curator], confusionKey)
    ledger.upsertNotice(r.notice)
  }
  return ledger
}

/** A fake Arkiv node with one official alert entity. */
const fakeArkiv: ProofClient = {
  getEntity: async (key) => {
    if (key.toLowerCase() !== KEY) throw Object.assign(new Error('no entity'), { name: 'NoEntityFoundError' })
    return {
      key: KEY,
      creator: PUB,
      owner: PUB,
      createdAt: 100n,
      expiresAt: 1100n,
      creationFlags: { readonly: true, permissionlessExtension: true },
      attributes: { project: { type: 'str', value: 'nazar-in-batch-alerts' }, t: { type: 'str', value: 'alert' }, batch: { type: 'str', value: 'sr13' }, sev: { type: 'i32', value: 5 } },
      payload: new TextEncoder().encode(JSON.stringify({ product: 'COLDRIF' })),
      toJson: () => ({ product: 'COLDRIF' }),
    } as never
  },
  getBlockTiming: async () => ({ currentBlock: 1000n, currentBlockTime: 0, blockDuration: 2 }) as never,
}

describe('MCP server (/mcp)', () => {
  let ledger: Ledger
  let app: NazarApp
  let client: Client

  const build = (limits?: { toolsPerMinute?: number; requestsPerMinute?: number }) =>
    createApp({
      ledger,
      reader: null,
      publisher: PUB,
      mode: 'dry-run',
      corsOrigins: ['http://localhost:3000'],
      explorerBase: 'https://explorer.test',
      now: () => new Date('2026-10-17T00:00:00Z'),
      sources: () => [{ id: 'tn-dc', authority: 'TN DCD', jurisdiction: 'IN-TN', homepage: 'https://drugscontrol.tn.gov.in', description: 'TN', schedule: '30 */3 * * *', enabled: true, lastRun: null }],
      mcp: { proofClient: fakeArkiv, ...(limits ? { limits } : {}) },
    })

  const connect = async (a: NazarApp) => {
    const c = new Client({ name: 'nazar-test', version: '1.0.0' })
    await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { fetch: async (url, init) => a.request(String(url), init as RequestInit) }))
    return c
  }

  beforeEach(async () => {
    ledger = seeded()
    app = build()
    client = await connect(app)
  })
  afterEach(async () => {
    await client.close()
  })

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args })
    const text = (r.content as { type: string; text: string }[])[0]!.text
    return { r, text, s: r.structuredContent as Record<string, any> }
  }

  it('identifies itself with the honesty rules', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'nazar' })
    const ins = client.getInstructions() ?? ''
    expect(ins).toMatch(/never say a medicine or batch is "safe"/i)
    expect(ins).toMatch(/not a safety certificate/i)
  })

  it('lists the six read-only tools and no medicine explainer', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['arkiv_proof', 'check_batch', 'get_case', 'list_sources', 'recent_alerts', 'search_alerts'])
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
    expect(tools.find((t) => t.name === 'check_batch')!.inputSchema.required).toEqual(['batch'])
  })

  it('check_batch: flagged with notice, severity, Child Shield and Arkiv fields', async () => {
    const { r, text, s } = await call('check_batch', { batch: 'sr 13' })
    expect(r.isError).toBeFalsy()
    expect(text).toMatch(/^FLAGGED: batch SR-13/)
    expect(text).not.toMatch(/\bsafe\b/i)
    expect(s.state).toBe('flagged')
    expect(s.alerts[0]).toMatchObject({ batch: 'SR-13', severity: 5, paediatric: true, childShield: true, regulator: { authority: 'WHO' }, notice: { title: 'WHO Medical Product Alert N°5/2025' }, arkiv: { entityKey: null } })
    expect(s.alerts[0].caseId).toMatch(/^[0-9a-f]+$/)
  })

  it('check_batch: no_alert always carries the not-a-certificate sentence; look-alikes are never flags', async () => {
    const none = await call('check_batch', { batch: 'AB1234' })
    expect(none.s.state).toBe('no_alert')
    expect(none.text).toMatch(/NO ALERT FOUND/)
    expect(none.text).toMatch(/not a safety certificate/)
    expect(none.s.notice).toMatch(/not a safety certificate/)
    const look = await call('check_batch', { batch: '5R-13' })
    expect(look.s).toMatchObject({ state: 'unreadable', suggestion: 'SR-13', alerts: [] })
    expect(look.text).toMatch(/NOT a flag/)
    expect((await call('check_batch', { batch: '!!' })).s.state).toBe('unreadable')
  })

  it('check_batch: retracted', async () => {
    ledger.markRetracted(ledger.alertsByBatchKey('sr13')[0]!.rid)
    const { s, text } = await call('check_batch', { batch: 'SR-13' })
    expect(s.state).toBe('retracted')
    expect(text).toMatch(/^RETRACTED/)
  })

  it('search_alerts, recent_alerts, get_case, list_sources', async () => {
    const search = await call('search_alerts', { query: 'coldrif' })
    expect(search.s.items.map((a: { batch: string }) => a.batch)).toEqual(['SR-13'])
    const recent = await call('recent_alerts', { limit: 5 })
    expect(recent.s.total).toBe(3)
    const shield = await call('recent_alerts', { childShield: true })
    expect(shield.s.items.map((a: { batch: string }) => a.batch)).toEqual(['SR-13'])
    expect((await call('recent_alerts', { state: 'IN-GJ' })).s.items.map((a: { batch: string }) => a.batch)).toEqual(['R01GL2523'])
    const caseId = ledger.alertsByBatchKey('sr13')[0]!.record.caseId
    const passport = await call('get_case', { caseId })
    expect(passport.s).toMatchObject({ caseId, batch: 'SR-13', count: 1 })
    expect((await call('get_case', { caseId: '0'.repeat(24) })).r.isError).toBe(true)
    expect((await call('list_sources')).s.items[0]).toMatchObject({ id: 'tn-dc', enabled: true })
  })

  it('rejects invalid input', async () => {
    const bad = await client.callTool({ name: 'recent_alerts', arguments: { minSeverity: 9 } })
    expect(bad.isError).toBe(true)
  })

  it('arkiv_proof reads the entity live and checks the publisher', async () => {
    const p = await call('arkiv_proof', { entityKey: KEY })
    expect(p.text).toMatch(/^OFFICIAL/)
    expect(p.s).toMatchObject({ found: true, nazarProject: true, officialPublisher: true, readAtBlock: '1000', entity: { type: 'alert', creator: PUB, flags: { readonly: true, permissionlessExtension: true }, expiresAtBlock: '1100' } })
    const missing = await call('arkiv_proof', { entityKey: `0x${'00'.repeat(32)}` })
    expect(missing.s).toMatchObject({ found: false })
    expect(missing.text).toMatch(/^NOT FOUND/)
  })

  it('serves resources and the check_my_medicine prompt', async () => {
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri).sort()).toEqual(['nazar://about', 'nazar://schema'])
    const about = await client.readResource({ uri: 'nazar://about' })
    expect((about.contents[0] as { text: string }).text).toMatch(/not a safety certificate/)
    const prompt = await client.getPrompt({ name: 'check_my_medicine', arguments: { medicine: 'Coldrif' } })
    expect((prompt.messages[0]!.content as { text: string }).text).toMatch(/B\. No\./)
  })

  it('limits tool calls per client', async () => {
    const limited = await connect(build({ toolsPerMinute: 2 }))
    const run = () => limited.callTool({ name: 'list_sources', arguments: {} })
    expect((await run()).isError).toBeFalsy()
    expect((await run()).isError).toBeFalsy()
    const third = await run()
    expect(third.isError).toBe(true)
    expect((third.content as { text: string }[])[0]!.text).toMatch(/Rate limited/)
    await limited.close()
  })
})

describe('MCP over raw stateless HTTP', () => {
  const app = createApp({ ledger: seeded(), reader: null, publisher: PUB, corsOrigins: ['http://localhost:3000'], mcp: { proofClient: null } })
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: 'https://claude.ai', ...headers },
      body: JSON.stringify(body),
    })

  it('initialize → tools/list → tools/call with no session', async () => {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curl', version: '1' } } })
    expect(init.status).toBe(200)
    expect(init.headers.get('content-type')).toMatch(/application\/json/)
    expect(init.headers.get('mcp-session-id')).toBeNull()
    expect(init.headers.get('access-control-allow-origin')).toBe('*')
    const initBody = await init.json()
    expect(initBody.result).toMatchObject({ serverInfo: { name: 'nazar' }, capabilities: { tools: {}, resources: {}, prompts: {} } })
    expect(initBody.result.instructions).toMatch(/four states/)

    const h = { 'Mcp-Protocol-Version': '2025-06-18' }
    const list = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, h)).json()
    expect(list.result.tools).toHaveLength(6)

    const res = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_batch', arguments: { batch: 'SR-13' } } }, h)).json()
    expect(res.result.structuredContent).toMatchObject({ state: 'flagged', batch: 'SR-13' })
    expect(res.result.content[0].text).toMatch(/^FLAGGED/)

    const proof = await (await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'arkiv_proof', arguments: { entityKey: KEY } } }, h)).json()
    expect(proof.result.isError).toBe(true)
  })

  it('accepts clients that only send Accept: application/json', async () => {
    const res = await post({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, { Accept: 'application/json' })
    expect(res.status).toBe(200)
    expect((await res.json()).result.tools).toHaveLength(6)
  })

  it('GET and DELETE are 405; CORS preflight is open; oversized bodies are 413', async () => {
    const get = await app.request('/mcp', { headers: { Accept: 'text/event-stream' } })
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toMatch(/POST/)
    expect((await app.request('/mcp', { method: 'DELETE' })).status).toBe(405)
    const pre = await app.request('/mcp', { method: 'OPTIONS', headers: { Origin: 'https://example.ai', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,mcp-protocol-version' } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('*')
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/Mcp-Protocol-Version/i)
    const big = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(70_000) } })
    expect(big.status).toBe(413)
    // The web API keeps its narrow CORS policy.
    expect((await app.request('/v1/alerts', { headers: { Origin: 'https://evil.example' } })).headers.get('access-control-allow-origin')).toBeNull()
  })
})
