import { createHash } from 'node:crypto'

import type { CreateEntityParameters, Entity, ExecuteBatchParameters } from '@arkiv-network/sdk'
import type { Expression } from '@arkiv-network/sdk/query'
import type { Hex } from 'viem'

/**
 * An in-memory stand-in for an Arkiv node, good enough for offline tests: it evaluates the real
 * query expressions the SDK combinators build (eq/gte/lte/or/and, $creator), paginates with
 * cursors, predicts entity keys from (nonce, index, salt) and creates entities on executeBatch.
 */

type Tagged = { type: string; value: unknown }
type Node =
  | { kind: 'comparison'; name: string; operator: string; value: Tagged }
  | { kind: 'and'; expressions: Node[] }
  | { kind: 'or'; expressions: Node[] }
  | { kind: 'not'; expression: Node }

export interface FakeEntity {
  key: Hex
  creator: Hex
  owner: Hex
  attributes: Record<string, Tagged>
  payload: Uint8Array
  contentType: string
  createdAt: bigint
  expiresAt: bigint
  creationFlags: { readonly: boolean; permissionlessExtension: boolean; raw: number }
  updatedAt: bigint
  attributeSchema: unknown
  toJson(): unknown
  toText(): string
}

const hex32 = (s: string) => `0x${createHash('sha256').update(s).digest('hex')}` as Hex

export class FakeArkiv {
  entities: FakeEntity[] = []
  nonce = 0n
  queries: string[] = []
  batches: ExecuteBatchParameters[] = []
  balance = 10n ** 18n
  /** Make the next executeBatch throw after (optionally) landing on chain. */
  failNext: { error: Error; land: boolean } | null = null

  constructor(readonly owner: Hex = '0x1111111111111111111111111111111111111111') {}

  keyFor(nonce: bigint, index: number, salt: bigint) {
    return hex32(`${this.owner}:${nonce}:${index}:${salt}`)
  }

  add(attrs: Record<string, Tagged>, payload: unknown = {}, creator: Hex = this.owner): FakeEntity {
    const params = { attributes: attrs, payload: new TextEncoder().encode(JSON.stringify(payload)), contentType: 'application/json' }
    return this.store(params as unknown as CreateEntityParameters, hex32(`manual:${this.entities.length}:${Math.random()}`), creator)
  }

  private store(p: CreateEntityParameters, key: Hex, creator: Hex): FakeEntity {
    const payload = p.payload
    const e: FakeEntity = {
      key,
      creator,
      owner: creator,
      attributes: { ...(p.attributes as Record<string, Tagged>) },
      payload,
      contentType: p.contentType,
      createdAt: 1n,
      updatedAt: 1n,
      expiresAt: 1_000_000n,
      creationFlags: { readonly: !!p.flags?.readonly, permissionlessExtension: !!p.flags?.permissionlessExtension, raw: 0 },
      attributeSchema: undefined,
      toJson: () => JSON.parse(new TextDecoder().decode(payload)),
      toText: () => new TextDecoder().decode(payload),
    }
    this.entities.push(e)
    return e
  }

  private matches(e: FakeEntity, n: Node): boolean {
    if (n.kind === 'and') return n.expressions.every((x) => this.matches(e, x))
    if (n.kind === 'or') return n.expressions.some((x) => this.matches(e, x))
    if (n.kind === 'not') return !this.matches(e, n.expression)
    const actual =
      n.name === '$creator' ? e.creator : n.name === '$owner' ? e.owner : (e.attributes[n.name]?.value as unknown)
    if (actual === undefined) return false
    const want = n.value.value
    const a = typeof actual === 'string' && typeof want === 'string' && n.value.type === 'addr' ? actual.toLowerCase() : actual
    const w = typeof want === 'string' && n.value.type === 'addr' ? want.toLowerCase() : want
    switch (n.operator) {
      case '=': return a === w
      case '!=': return a !== w
      case '>=': return Number(a) >= Number(w)
      case '<=': return Number(a) <= Number(w)
      case '>': return Number(a) > Number(w)
      case '<': return Number(a) < Number(w)
      default: return false
    }
  }

  private run(filters: Node[], limit: number, offset: number) {
    const all = this.entities.filter((e) => filters.every((f) => this.matches(e, f)))
    const page = all.slice(offset, offset + limit)
    const next = offset + limit < all.length ? `c:${offset + limit}` : undefined
    return { page, next }
  }

  /** The `select()` builder surface the reader and publisher use. */
  select(_sel?: unknown) {
    const filters: Node[] = []
    let limit = 50
    let cursor: string | undefined
    const self = this
    const result = (offset: number): unknown => {
      const { page, next } = self.run(filters, limit, offset)
      return {
        entities: page as unknown as Entity[],
        cursor: next,
        blockNumber: 42n,
        hasNextPage: () => next !== undefined,
        next: async () => result(Number(next!.slice(2))),
      }
    }
    const builder = {
      where(...exprs: (Expression | readonly Expression[])[]) {
        for (const x of exprs.flat()) filters.push(x as unknown as Node)
        return builder
      },
      createdBy(addr: Hex) {
        filters.push({ kind: 'comparison', name: '$creator', operator: '=', value: { type: 'addr', value: addr } })
        return builder
      },
      limit(n: number) {
        limit = n
        return builder
      },
      cursor(c: string) {
        cursor = c
        return builder
      },
      async fetch() {
        self.queries.push(filters.map((f) => String(f.kind === 'comparison' ? `${f.name}${f.operator}${String(f.value.value)}` : f.kind)).join(' & '))
        return result(cursor ? Number(cursor.slice(2)) : 0)
      },
    }
    return builder
  }

  async getBalance(_: { address: Hex }) {
    return this.balance
  }

  async predictEntityKeys({ count }: { owner: Hex; count?: number }) {
    return Array.from({ length: count ?? 1 }, (_, i) => {
      const salt = BigInt(1000 + i) * 7919n + this.nonce
      return { key: this.keyFor(this.nonce, i, salt), salt }
    })
  }

  async executeBatch(data: ExecuteBatchParameters) {
    this.batches.push(data)
    const fail = this.failNext
    this.failNext = null
    if (fail && !fail.land) throw fail.error
    const keys = (data.creates ?? []).map((c, i) => {
      const salt = c.salt === undefined ? BigInt(Math.floor(Math.random() * 1e9)) : BigInt(c.salt as bigint)
      const key = this.keyFor(this.nonce, i, salt)
      this.store(c, key, this.owner)
      return key
    })
    this.nonce++
    if (fail) throw fail.error
    const txHash = hex32(`tx:${this.nonce}`)
    return { txHash, createdEntities: keys, patchedEntities: [], deletedEntities: [], extendedEntities: [], ownershipChanges: [] }
  }

  async createEntity(p: CreateEntityParameters) {
    const key = this.keyFor(this.nonce, 0, 0n)
    this.store(p, key, this.owner)
    this.nonce++
    return { entityKey: key, txHash: hex32(`tx:${this.nonce}`), expiresAt: 1_000_000n }
  }

  async patchEntity(p: { entityKey: Hex }) {
    if (!this.entities.find((e) => e.key === p.entityKey)) throw new Error('no such entity')
    return { entityKey: p.entityKey, txHash: hex32(`patch:${this.nonce++}`) }
  }

  async extendEntity(p: { entityKey: Hex }) {
    return { entityKey: p.entityKey, txHash: hex32(`extend:${this.nonce++}`), expiresAt: 2_000_000n }
  }
}

// ---- shared fixtures for the resolve / publisher / api / run tests

import type { ExtractedRow, RawDoc } from '../../src/domain/types.ts'
import { stableId } from '../../src/lib/hash.ts'

export function rawDoc(over: Partial<RawDoc> = {}): RawDoc {
  const sha = over.sha256 ?? createHash('sha256').update(over.title ?? 'doc').digest('hex')
  return {
    sourceId: 'cdsco-pdf',
    url: 'https://cdsco.gov.in/opencms/alert.pdf',
    finalUrl: 'https://cdsco.gov.in/opencms/alert.pdf',
    title: 'List of NSQ drugs for the month of September 2025',
    authority: 'CDSCO',
    jurisdiction: 'IN',
    publishedAt: '2025-10-15',
    noticeYm: 202509,
    kind: 'pdf',
    hints: {},
    sha256: sha,
    path: `/tmp/${sha}.pdf`,
    contentType: 'application/pdf',
    size: 1000,
    fetchedAt: '2025-10-16T00:00:00.000Z',
    ...over,
  }
}

export function row(doc: RawDoc, rowNo: number, over: Partial<ExtractedRow> = {}): ExtractedRow {
  return {
    rid: stableId(doc.sha256, rowNo, 'test@1'),
    sourceSha: doc.sha256,
    rowNo,
    page: 1,
    product: 'Paracetamol Tablets IP 500 mg',
    batch: `PT${1000 + rowNo}`,
    mfgYm: 202501,
    expYm: 202712,
    manufacturer: 'M/s. Example Pharma Pvt. Ltd., Plot 5, Baddi, Solan (H.P.) 173205',
    reason: 'Dissolution',
    reportedBy: 'CDL Kolkata',
    method: 'text',
    parser: 'test@1',
    confidence: 0.95,
    issues: [],
    rawText: '',
    ...over,
  }
}
