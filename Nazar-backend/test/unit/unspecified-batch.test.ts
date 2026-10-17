import { describe, expect, it } from 'vitest'

import { createApp } from '../../src/api/app.ts'
import {
  BATCH_SHAPE,
  cleanBatch,
  confusionKey,
  isMissingBatch,
  isPlausibleBatch,
  isUnspecifiedBatch,
  matchKey,
  splitBatches,
  unspecifiedBatch,
} from '../../src/domain/batch.ts'
import { resolveRows } from '../../src/resolve/index.ts'
import { cdscoRows, type CdscoTable } from '../../src/sources/cdsco-online.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'

describe('parenthesised batches (CDSCO "(N)25567")', () => {
  it('fit the shared shape and survive cleaning, plausibility and splitting', () => {
    expect(BATCH_SHAPE.test('(N)25567')).toBe(true)
    expect(cleanBatch('(N)25567')).toBe('(N)25567')
    expect(isPlausibleBatch('(N)25567')).toBe(true)
    expect(splitBatches('(N)25567')).toEqual(['(N)25567'])
    expect(splitBatches('(N)25567, (N)25479')).toEqual(['(N)25567', '(N)25479'])
  })

  it('keep matchKey and confusionKey unchanged', () => {
    expect(matchKey('(N)25567')).toBe('n25567')
    expect(matchKey('N 25567')).toBe('n25567')
    expect(confusionKey('(N)25567')).toBe(confusionKey('n25567'))
  })

  it('allow up to 24 characters', () => {
    expect(BATCH_SHAPE.test('A'.repeat(24))).toBe(true)
    expect(BATCH_SHAPE.test('A'.repeat(25))).toBe(false)
    expect(BATCH_SHAPE.test('SR-13#')).toBe(false)
  })

  it('drop a trailing note in brackets but keep a bracketed prefix', () => {
    expect(cleanBatch('SR-13 (Syrup)')).toBe('SR-13')
    expect(cleanBatch('(N)25567 (Injection)')).toBe('(N)25567')
  })

  it('are no longer dropped from the cdscoonline table', () => {
    const table: CdscoTable = {
      aaData: [{ str_product_name: 'Sodium Chloride Injection IP', str_batch_no: '(N)25567', dt_manufacturing_date: 'Jan-2025', dt_expiry_date: 'Dec-2027', str_nsq_result: 'Sterility' }],
    }
    const rows = cdscoRows(table, { sha256: 'a'.repeat(64), hints: { tab: 'nsq', month: 'Mar-2025' } })
    expect(rows.map((r) => r.batch)).toEqual(['(N)25567'])
  })
})

describe('rows that state no batch', () => {
  it('recognises the notice wording for "no batch"', () => {
    for (const cell of ['Not Mentioned', 'NOT MENTIONED ON SAMPLE', 'Not Mention', 'NOT STATED', 'Not Mentioned//', 'N.A.', '', '  ']) {
      expect(isMissingBatch(cell), cell).toBe(true)
    }
    for (const cell of ['SR-13', '(N)25567', '2', 'ABCDEF']) expect(isMissingBatch(cell), cell).toBe(false)
  })

  it('cdscoRows keeps them under a placeholder and counts unreadable cells by reason', () => {
    const table: CdscoTable = {
      aaData: [
        { str_product_name: 'Paracetamol Tablets IP', str_batch_no: 'Not Mentioned', str_manufactured_by: 'Under Investigation', str_nsq_result: 'Spurious' },
        { str_product_name: 'Cough Syrup', str_batch_no: '2', str_nsq_result: 'Assay' },
        { str_product_name: '', str_batch_no: 'AB123' },
        { str_product_name: 'Amoxicillin Capsules', str_batch_no: 'AMX-1', str_nsq_result: 'Dissolution' },
      ],
    }
    const skipped: Record<string, number> = {}
    const doc = { sha256: 'a'.repeat(64), hints: { tab: 'spurious', month: 'Aug-2026' } }
    const rows = cdscoRows(table, doc, skipped)
    expect(rows.map((r) => r.batch)).toEqual([expect.stringMatching(/^UNSPECIFIED-[0-9A-F]{8}$/), 'AMX-1'])
    expect(rows[0]).toMatchObject({ confidence: 0.5, issues: expect.arrayContaining(['batch not stated on the notice']) })
    expect(skipped).toEqual({ 'implausible batch': 1, 'no product name': 1 })
    // stable across re-fetches, so the ledger row is updated rather than duplicated
    expect(cdscoRows(table, { ...doc, sha256: 'b'.repeat(64) }).map((r) => [r.rid, r.batch])).toEqual(rows.map((r) => [r.rid, r.batch]))
  })

  it('resolve files them as drug_level with a batch key no query can produce', () => {
    const doc = rawDoc({ title: 'CDSCO spurious drugs reported in Aug 2026', sourceId: 'cdsco-online', noticeYm: 202608 })
    const placeholder = unspecifiedBatch('spurious', 'Aug-2026', 'paracetamol tablets ip')
    expect(isUnspecifiedBatch(placeholder)).toBe(true)
    const { alerts, curator } = resolveRows(doc, [
      row(doc, 1, { batch: placeholder, confidence: 0.97, issues: ['batch not stated on the notice'] }),
      row(doc, 2, { batch: 'SR-13' }),
    ])
    expect(alerts.map((a) => a.batch)).toEqual(['SR-13'])
    expect(curator).toHaveLength(1)
    expect(curator[0]).toMatchObject({ batch: placeholder, tier: 'drug_level' })
    expect(curator[0]!.batchKey).toMatch(/^unspecified:/)
    expect(curator[0]!.batchKey).not.toBe(matchKey(placeholder))
  })

  it('stay visible in the ledger but never answer a batch check', async () => {
    const ledger = new Ledger(':memory:')
    const doc = rawDoc({ title: 'CDSCO spurious drugs reported in Aug 2026', sourceId: 'cdsco-online', noticeYm: 202608 })
    const placeholder = unspecifiedBatch('spurious', 'Aug-2026', 'paracetamol tablets ip')
    const r = resolveRows(doc, [row(doc, 1, { batch: placeholder, product: 'Paracetamol Tablets IP', confidence: 0.97 })])
    ledger.upsertDocument(doc)
    ledger.upsertAlerts([...r.alerts, ...r.curator], confusionKey)
    ledger.upsertNotice(r.notice)

    expect(ledger.stats().alerts).toBe(1)
    expect(ledger.alertsByCase(r.curator[0]!.caseId)).toHaveLength(1)
    expect(ledger.alertsByBatchKey(matchKey(placeholder))).toHaveLength(0)
    expect(ledger.unpublishedAlerts(doc.sha256).filter((a) => ['auto', 'machine_read'].includes(a.record.tier))).toHaveLength(0)

    const app = createApp({ ledger, reader: null, publisher: null, mode: 'dry-run', chainId: 1, corsOrigins: [], explorerBase: 'https://x.test', sources: () => [] })
    for (const q of [placeholder, placeholder.toLowerCase(), placeholder.replace('-', ' '), 'UNSPECIFIED']) {
      const body = (await (await app.request(`/v1/check?batch=${encodeURIComponent(q)}`)).json()) as { state: string; alerts: unknown[]; suggestion?: string }
      expect(body.state, q).toBe('no_alert')
      expect(body.alerts).toEqual([])
      expect(body.suggestion).toBeUndefined()
    }
    const feed = (await (await app.request('/v1/alerts')).json()) as { items: unknown[] }
    expect(feed.items).toEqual([])
  })
})
