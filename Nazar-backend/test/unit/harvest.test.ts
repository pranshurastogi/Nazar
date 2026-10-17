import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DiscoveredDoc } from '../../src/domain/types.ts'
import { TransientError } from '../../src/lib/errors.ts'
import { harvest, validateContent } from '../../src/pipeline/harvest.ts'
import { curated } from '../../src/sources/curated.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { RawStore } from '../../src/storage/raw-store.ts'
import { fakeHttp, fixture, type Route } from './sources/fake-http.ts'

const PDF_URL = 'https://drugscontrol.tn.gov.in/pdfs/TN_nsq_list_august_2026.pdf'
const JSON_URL = 'https://cdscoonline.gov.in/CDSCO/filteredNsqDrugTable?month=Aug-2026&source=All&tab=nsq'
const pdfBytes = fixture('pdf', 'tn-2026-08-nsq.pdf')

const pdfDoc: DiscoveredDoc = {
  sourceId: 'tn-dc',
  url: PDF_URL,
  title: 'List of Drugs Reported to be NSQ for the Month of August 2026',
  authority: 'Drugs Control Department, Tamil Nadu',
  jurisdiction: 'IN-TN',
  publishedAt: null,
  noticeYm: 202608,
  kind: 'pdf',
  hints: { template: 'tn-nsq' },
}
const jsonDoc: DiscoveredDoc = {
  ...pdfDoc,
  sourceId: 'cdsco-online',
  url: JSON_URL,
  authority: 'CDSCO',
  jurisdiction: 'IN',
  kind: 'html',
  hints: { format: 'cdsco-json', tab: 'nsq', month: 'Aug-2026', refresh: 'always' },
}

let dir: string
let ledger: Ledger
let store: RawStore

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nazar-harvest-'))
  ledger = new Ledger(':memory:')
  store = new RawStore(dir)
})
afterEach(() => {
  ledger.close()
  rmSync(dir, { recursive: true, force: true })
})

const deps = (routes: Record<string, Route>) => {
  const f = fakeHttp(routes)
  return { ...f, deps: { http: f.http, store, ledger } }
}

describe('harvest', () => {
  it('stores a new PDF and records it in the ledger', async () => {
    const { deps: d } = deps({ [PDF_URL]: { body: pdfBytes, type: 'application/pdf' } })
    const out = await harvest(pdfDoc, d)
    expect(out?.isNew).toBe(true)
    expect(out!.raw).toMatchObject({ sourceId: 'tn-dc', contentType: 'application/pdf', size: pdfBytes.byteLength, finalUrl: PDF_URL })
    expect(out!.raw.path.startsWith(dir)).toBe(true)
    expect(await store.get(out!.raw.path)).toEqual(new Uint8Array(pdfBytes))
    expect(ledger.getDocument(out!.raw.sha256)?.status).toBe('harvested')
    expect(ledger.hasSeenUrl(PDF_URL)).toBe(true)
  })

  it('skips a URL it has already harvested without fetching', async () => {
    const { deps: d, calls } = deps({ [PDF_URL]: { body: pdfBytes, type: 'application/pdf' } })
    await harvest(pdfDoc, d)
    const before = calls.length
    expect(await harvest(pdfDoc, d)).toBeNull()
    expect(calls.length).toBe(before)
  })

  it('re-fetches refresh-always documents and reports unchanged bytes as not new', async () => {
    const body = fixture('json', 'cdscoonline-nsq-aug-2026.json')
    const { deps: d, calls } = deps({ [JSON_URL]: { body, type: 'text/html;charset=UTF-8' } })
    const first = await harvest(jsonDoc, d)
    const second = await harvest(jsonDoc, d)
    expect(first?.isNew).toBe(true)
    expect(second?.isNew).toBe(false)
    expect(second!.raw.sha256).toBe(first!.raw.sha256)
    expect(first!.raw.contentType).toBe('application/json')
    expect(first!.raw.path.endsWith('.json')).toBe(true)
    expect(ledger.stats().documents).toBe(1)
    const api = calls.filter((c) => c.url === JSON_URL)
    expect(api).toHaveLength(2)
    expect(api[0]!.headers['x-requested-with']).toBe('XMLHttpRequest')
  })

  it('rejects an HTML error page served where a PDF was promised', async () => {
    const { deps: d } = deps({ [PDF_URL]: { body: '<html>File not found</html>', type: 'application/pdf' } })
    expect(await harvest(pdfDoc, d)).toBeNull()
    expect(ledger.stats().documents).toBe(0)
    expect(ledger.hasSeenUrl(PDF_URL)).toBe(false)
  })

  it('rejects JSON documents that do not parse', async () => {
    const { deps: d } = deps({ [JSON_URL]: { body: '<html>Session expired</html>' } })
    expect(await harvest(jsonDoc, d)).toBeNull()
  })

  it('treats 404 as permanent and returns null', async () => {
    const { deps: d } = deps({})
    expect(await harvest(pdfDoc, d)).toBeNull()
  })

  it('lets transient failures propagate', async () => {
    const { deps: d } = deps({ [PDF_URL]: { status: 503, body: 'busy' } })
    await expect(harvest(pdfDoc, d)).rejects.toBeInstanceOf(TransientError)
  })

  it('harvests a curated seed from the repo, and its rows come straight from the stored bytes', async () => {
    const { deps: d, calls } = deps({})
    const [doc] = await curated.discover({ http: d.http, limit: 5 })
    const out = await harvest(doc!, d)
    expect(calls).toHaveLength(0)
    expect(out?.isNew).toBe(true)
    const rows = await curated.rows!(out!.raw, out!.bytes)
    expect(rows.map((r) => r.batch)).toEqual(['SR-13', 'R01GL2523', 'LSL25160'])
    expect(rows[0]!.sourceSha).toBe(out!.raw.sha256)
    expect((await harvest(doc!, d))?.isNew).toBe(false)
  })
})

describe('validateContent', () => {
  it('accepts a PDF with leading junk before the header', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x0a, ...new TextEncoder().encode('%PDF-1.4 ...')])
    expect(validateContent(pdfDoc, bytes, 'application/octet-stream')).toBe('application/pdf')
  })
  it('refuses a PDF where an HTML page was expected', () => {
    const htmlDoc = { ...pdfDoc, kind: 'html' as const, hints: {} }
    expect(() => validateContent(htmlDoc, new TextEncoder().encode('%PDF-1.7'), 'application/pdf')).toThrow(/expected HTML/)
    expect(validateContent(htmlDoc, new TextEncoder().encode('<html></html>'), 'text/html; charset=UTF-8')).toBe('text/html; charset=UTF-8')
  })
  it('requires an aaData table for cdscoonline JSON', () => {
    expect(() => validateContent(jsonDoc, new TextEncoder().encode('{"error":"x"}'), 'application/json')).toThrow(/aaData/)
  })
})
