import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Context } from 'hono'

import { errorMessage } from '../lib/errors.ts'
import { child } from '../lib/logger.ts'
import { clientIp, hashIp, randomSalt, TokenBuckets } from '../medicine/limits.ts'
import { createNazarMcp, type McpDeps } from './server.ts'

/**
 * POST /mcp: MCP Streamable HTTP in stateless mode. Every request gets a fresh server and
 * transport (no sessions, nothing to keep alive between requests, any replica can answer) and
 * JSON responses instead of SSE streams. GET and DELETE are 405, as the spec asks of a server
 * that offers no standalone stream or session.
 *
 * Abuse limits: a body cap, a per-client request ceiling, and 60 tool calls per minute per
 * client. Clients are known only by a salted hash of their IP, held in memory.
 */

const log = child('mcp')

export const MCP_MAX_BODY_BYTES = 64 * 1024

export interface McpHttpOptions {
  toolsPerMinute?: number
  requestsPerMinute?: number
  now?: () => number
}

const rpcError = (c: Context, status: 405 | 413 | 429, code: number, message: string, headers: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries(headers)) c.header(k, v)
  c.header('Cache-Control', 'no-store')
  return c.json({ jsonrpc: '2.0', error: { code, message }, id: null }, status)
}

/**
 * The transport insists on `Accept: application/json, text/event-stream`. Some connectors send only
 * one of them; we always answer JSON, so either is enough and the header is completed for them.
 */
function acceptBoth(req: Request): Request {
  const accept = req.headers.get('accept') ?? ''
  if (accept.includes('application/json') && accept.includes('text/event-stream')) return req
  const headers = new Headers(req.headers)
  headers.set('accept', 'application/json, text/event-stream')
  return new Request(req, { headers })
}

export function mcpHandler(deps: Omit<McpDeps, 'allowTool'>, o: McpHttpOptions = {}) {
  const salt = randomSalt()
  const now = o.now ?? Date.now
  const tools = new TokenBuckets(o.toolsPerMinute ?? 60, 60_000)
  const requests = new TokenBuckets(o.requestsPerMinute ?? 240, 60_000)

  return async (c: Context): Promise<Response> => {
    if (c.req.method === 'GET' || c.req.method === 'DELETE') {
      return rpcError(c, 405, -32000, 'Method not allowed: this MCP server is stateless; send JSON-RPC with POST.', { Allow: 'POST, OPTIONS' })
    }
    if (c.req.method !== 'POST') return rpcError(c, 405, -32000, 'Method not allowed', { Allow: 'POST, OPTIONS' })
    if (Number(c.req.header('content-length') ?? 0) > MCP_MAX_BODY_BYTES) return rpcError(c, 413, -32600, `Request body must be at most ${MCP_MAX_BODY_BYTES} bytes`)

    const socket = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress
    const who = hashIp(clientIp(c.req.header(), socket), salt)
    const wait = requests.wait(who, now())
    if (wait > 0) return rpcError(c, 429, -32000, `Too many requests; retry in ${wait} s`, { 'Retry-After': String(wait) })
    requests.take(who, now())

    const allowTool = () => {
      const w = tools.wait(who, now())
      if (w === 0) tools.take(who, now())
      return w
    }
    const server = createNazarMcp({ ...deps, allowTool })
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MCP_MAX_BODY_BYTES })
    try {
      await server.connect(transport)
      const res = await transport.handleRequest(acceptBoth(c.req.raw))
      // JSON mode resolves once the reply is written, so the per-request pair can go now.
      void transport.close().catch(() => {})
      void server.close().catch(() => {})
      return res
    } catch (err) {
      log.warn({ err: errorMessage(err) }, 'mcp request failed')
      void transport.close().catch(() => {})
      void server.close().catch(() => {})
      return c.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }, 500)
    }
  }
}
