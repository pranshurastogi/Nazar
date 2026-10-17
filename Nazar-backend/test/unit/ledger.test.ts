import { describe, expect, it } from 'vitest'

import { confusionKey } from '../../src/domain/batch.ts'
import type { AlertRecord } from '../../src/domain/types.ts'
import { Ledger } from '../../src/storage/ledger.ts'

const alert = (over: Partial<AlertRecord> = {}): AlertRecord => ({
  rid: 'r1', caseId: 'c1', batch: 'SR-13', batchKey: 'sr13', brand: 'Coldrif', product: 'Coldrif Syrup', generic: null,
  form: 'syrup', category: 'adulterated', failures: ['glycol'], reason: 'DEG 48.6% w/v', severity: 5, severityRules: [],
  ruleVersion: 'sev', peds: true, manufacturer: 'Sresan', manufacturerRole: 'maker', plantId: null, state: 'IN-TN',
  mfgYm: 202505, expYm: 202704, alertYm: 202510, sourceId: 'curated', authority: 'WHO', jurisdiction: 'IN',
  noticeSha: 'n1', noticeTitle: 'MPA 5/2025', noticeUrl: 'https://who.int', noticeDate: '2025-10-13', method: 'curated',
  confidence: 1, tier: 'auto', ...over,
})

describe('Ledger alerts', () => {
  it('keeps the first alert month when a refreshed page re-lists a row', () => {
    const l = new Ledger(':memory:')
    l.upsertAlerts([alert()], confusionKey)
    l.upsertAlerts([alert({ alertYm: 202612, severity: 4 })], confusionKey)
    const [row] = l.alertsByBatchKey('sr13')
    expect(row!.record.alertYm).toBe(202510)
    expect(row!.record.severity).toBe(4)
  })

  it('finds look-alikes by confusion key and full-text search', () => {
    const l = new Ledger(':memory:')
    l.upsertAlerts([alert()], confusionKey)
    expect(l.alertsByConfusionKey(confusionKey('5R-13'))).toHaveLength(1)
    expect(l.searchAlerts('coldrif')).toHaveLength(1)
    expect(l.searchAlerts('"; DROP')).toHaveLength(0)
  })

  it('tracks publish state and stats', () => {
    const l = new Ledger(':memory:')
    l.upsertAlerts([alert(), alert({ rid: 'r2', tier: 'curator_only' })], confusionKey)
    expect(l.unpublishedAlerts('n1').map((a) => a.rid)).toEqual(['r1'])
    l.markAlertPublished('r1', '0xabc', '0xtx')
    expect(l.stats()).toMatchObject({ alerts: 2, published: 1, pending: 0, curatorQueue: 1 })
  })
})
