import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApp, type NazarApp } from '../../src/api/app.ts'
import { DISCLAIMER, xmlEscape } from '../../src/api/feeds.ts'
import { setEnvForTests } from '../../src/config/env.ts'
import { confusionKey, matchKey } from '../../src/domain/batch.ts'
import type { AlertRecord } from '../../src/domain/types.ts'
import { resolveRows } from '../../src/resolve/index.ts'
import { Ledger } from '../../src/storage/ledger.ts'
import { rawDoc, row } from './reader-fake-arkiv.ts'

const ORIGIN = 'http://localhost:3000'
const SITE = 'https://nazar-nu.vercel.app'

// ---- a tiny strict XML parser: throws on anything not well-formed, returns a tree to query.
interface XNode {
  name: string
  attrs: Record<string, string>
  children: XNode[]
  text: string
}

const ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/
function decode(s: string): string {
  if (ENTITY.test(s)) throw new Error(`bare & in ${JSON.stringify(s.slice(0, 60))}`)
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e]!,
  )
}

function parseXml(xml: string): XNode {
  const NAME = '[A-Za-z_][\\w:.-]*'
  const decl = /^<\?xml version="1\.0" encoding="UTF-8"\?>\n/
  if (!decl.test(xml)) throw new Error('missing XML declaration')
  let i = xml.match(decl)![0].length
  const doc: XNode = { name: '#doc', attrs: {}, children: [], text: '' }
  const stack = [doc]
  const open = new RegExp(`<(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`, 'y')
  const close = new RegExp(`</(${NAME})\\s*>`, 'y')
  const attr = new RegExp(`(${NAME})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'g')
  while (i < xml.length) {
    const top = stack[stack.length - 1]!
    if (xml[i] !== '<') {
      const j = xml.indexOf('<', i)
      const end = j < 0 ? xml.length : j
      const text = decode(xml.slice(i, end))
      if (top === doc && text.trim()) throw new Error('text outside the root element')
      top.text += text
      i = end
      continue
    }
    close.lastIndex = i
    const c = close.exec(xml)
    if (c) {
      if (stack.length < 2 || top.name !== c[1]) throw new Error(`mismatched </${c[1]}> (open: ${top.name})`)
      stack.pop()
      i = close.lastIndex
      continue
    }
    open.lastIndex = i
    const o = open.exec(xml)
    if (!o) throw new Error(`malformed tag at ${i}: ${JSON.stringify(xml.slice(i, i + 40))}`)
    const attrs: Record<string, string> = {}
    for (const m of o[2]!.matchAll(attr)) {
      if (m[1]! in attrs) throw new Error(`duplicate attribute ${m[1]}`)
      attrs[m[1]!] = decode(m[2] ?? m[3] ?? '')
    }
    const node: XNode = { name: o[1]!, attrs, children: [], text: '' }
    if (top === doc && doc.children.length) throw new Error('more than one root element')
    top.children.push(node)
    if (!o[3]) stack.push(node)
    i = open.lastIndex
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1]!.name}>`)
  if (doc.children.length !== 1) throw new Error('no root element')
  return doc.children[0]!
}

const kids = (n: XNode, name: string) => n.children.filter((c) => c.name === name)
const kid = (n: XNode, name: string) => {
  const k = kids(n, name)[0]
  if (!k) throw new Error(`no <${name}> in <${n.name}>`)
  return k
}
const txt = (n: XNode, name: string) => kid(n, name).text

// ---- fixture: the same ledger as api.test.ts, plus helpers to add hand-made alerts.
function seeded() {
  const ledger = new Ledger(':memory:')
  const who = rawDoc({ title: 'WHO Medical Product Alert N°5/2025', sourceId: 'who-mpa', noticeYm: 202510, authority: 'WHO' })
  const tn = rawDoc({ title: 'TN NSQ list June 2026', sourceId: 'tn-dc', jurisdiction: 'IN-TN', noticeYm: 202606 })
  const all = [
    { doc: who, rows: [
      row(who, 1, { product: 'COLDRIF Syrup (paediatric)', batch: 'SR-13', reason: 'Diethylene glycol 48.6% w/v', manufacturer: 'Sresan Pharmaceutical, Kancheepuram-602106, Tamil Nadu', expYm: 202704 }),
      row(who, 2, { product: 'Respifresh TR syrup', batch: 'R01GL2523', reason: 'Diethylene glycol 1.34%', manufacturer: 'Rednex Pharmaceutical Pvt Ltd, Ahmedabad 382213 Gujarat' }),
    ] },
    { doc: tn, rows: [
      row(tn, 1, { batch: 'TN-77', reason: 'Dissolution', manufacturer: 'Example Labs Ltd, Chennai 600001' }),
      row(tn, 2, { batch: 'LOW-1', confidence: 0.3 }),
    ] },
  ]
  for (const { doc, rows } of all) {
    ledger.upsertDocument(doc)
    const r = resolveRows(doc, rows)
    ledger.upsertAlerts([...r.alerts, ...r.curator], confusionKey)
    ledger.upsertNotice(r.notice)
  }
  return ledger
}

function addAlert(ledger: Ledger, over: Partial<AlertRecord> & { rid: string }) {
  const base = ledger.alertsByBatchKey('tn77')[0]!.record
  const batch = over.batch ?? base.batch
  ledger.upsertAlerts([{ ...base, ...over, batch, batchKey: matchKey(batch) || over.rid }], confusionKey)
}

describe('alert feeds (/v1/alerts.rss, .atom, .json)', () => {
  let ledger: Ledger
  let app: NazarApp
  const make = (over: Partial<Parameters<typeof createApp>[0]> = {}) =>
    createApp({ ledger, reader: null, publisher: null, corsOrigins: [ORIGIN], explorerBase: 'https://explorer.test', now: () => new Date('2026-10-17T00:00:00Z'), ...over })
  beforeEach(() => {
    ledger = seeded()
    app = make({ siteUrl: SITE })
  })
  afterEach(() => setEnvForTests({}))

  const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })
  const rss = async (q = '') => {
    const res = await get(`/v1/alerts.rss${q}`)
    expect(res.status).toBe(200)
    const body = await res.text()
    return { res, body, root: parseXml(body) }
  }
  const items = (root: XNode) => kids(kid(root, 'channel'), 'item')

  it('the test parser rejects malformed XML', () => {
    const d = '<?xml version="1.0" encoding="UTF-8"?>\n'
    expect(() => parseXml(`${d}<a><b></a></b>`)).toThrow()
    expect(() => parseXml(`${d}<a>x & y</a>`)).toThrow()
    expect(() => parseXml(`${d}<a href="x"y="1"/>`)).toThrow()
    expect(() => parseXml(`${d}<a></a><b/>`)).toThrow()
    expect(parseXml(`${d}<a k="&lt;&amp;"><b>t&apos;</b></a>`).children[0]!.text).toBe("t'")
  })

  it('RSS 2.0: well-formed, channel metadata, publishable alerts only, newest first', async () => {
    const { res, body, root } = await rss()
    expect(res.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8')
    expect(root.name).toBe('rss')
    expect(root.attrs).toMatchObject({ version: '2.0', 'xmlns:atom': 'http://www.w3.org/2005/Atom' })
    const ch = kid(root, 'channel')
    expect(txt(ch, 'title')).toBe('Nazar · Indian medicine batch alerts')
    expect(txt(ch, 'link')).toBe(`${SITE}/feed`)
    expect(txt(ch, 'language')).toBe('en-IN')
    expect(txt(ch, 'ttl')).toBe('60')
    expect(txt(ch, 'description')).toContain(DISCLAIMER)
    expect(new Date(txt(ch, 'lastBuildDate')).getTime()).not.toBeNaN()
    expect(kid(ch, 'atom:link').attrs).toEqual({ href: 'http://localhost/v1/alerts.rss', rel: 'self', type: 'application/rss+xml' })
    // Same rows as /v1/alerts: the curator-tier LOW-1 is never in a feed.
    const json = await (await get('/v1/alerts')).json()
    const list = items(root)
    expect(list.map((i) => txt(i, 'link'))).toEqual(json.items.map((a: { batch: string }) => `${SITE}/b/${encodeURIComponent(a.batch)}`))
    expect(list).toHaveLength(3)
    expect(body).not.toContain('LOW-1')
  })

  it('each item: title, link, stable guid, notice date, categories and a description ending with the disclaimer', async () => {
    const { root } = await rss()
    const rid = ledger.alertsByBatchKey('sr13')[0]!.rid
    const item = items(root).find((i) => txt(i, 'link') === `${SITE}/b/SR-13`)!
    expect(txt(item, 'title')).toMatch(/^COLDRIF.* · batch SR-13 · flagged by WHO$/)
    expect(kid(item, 'guid').attrs.isPermaLink).toBe('false')
    expect(txt(item, 'guid')).toBe(`tag:nazar-nu.vercel.app,2026:alert:${rid}`)
    expect(txt(item, 'pubDate')).toBe('Wed, 15 Oct 2025 00:00:00 GMT') // the notice's own date
    expect(kids(item, 'category').map((c) => c.text)).toEqual(['Adulterated', 'Tamil Nadu', 'Severity 5', 'Child Shield'])
    const desc = txt(item, 'description')
    expect(desc).toContain('Diethylene glycol 48.6% w/v')
    expect(desc).toContain('Sresan Pharmaceutical')
    expect(desc).toMatch(/Exp Apr 2027/)
    expect(desc).toMatch(/Severity:<\/strong> 5 of 5 \(/)
    expect(desc).toContain('href="https://cdsco.gov.in/opencms/alert.pdf"')
    expect(desc).not.toContain('On Arkiv') // not published yet
    expect(desc.endsWith(`<p><em>${DISCLAIMER}</em></p>`)).toBe(true)
    // The guid is stable across requests.
    expect(txt(items((await rss()).root).find((i) => txt(i, 'link') === `${SITE}/b/SR-13`)!, 'guid')).toBe(txt(item, 'guid'))
  })

  it('uses the regulator notice date when known, marks undated alerts, and links published ones to Arkiv', async () => {
    const key = `0x${'ab'.repeat(32)}`
    const tn = ledger.alertsByBatchKey('tn77')[0]!.rid
    ledger.markAlertPublished(tn, key, `0x${'cd'.repeat(32)}`)
    addAlert(ledger, { rid: 'feedd0001', batch: 'DATED-1', noticeDate: '2026-06-12', alertYm: 202606 })
    addAlert(ledger, { rid: 'feedd0002', batch: 'UNDATED-1', dateKnown: false, alertYm: 202609, noticeDate: null })
    const { root } = await rss()
    const by = (b: string) => items(root).find((i) => txt(i, 'link') === `${SITE}/b/${b}`)!
    expect(txt(by('DATED-1'), 'pubDate')).toBe('Fri, 12 Jun 2026 00:00:00 GMT')
    expect(txt(by('DATED-1'), 'description')).toContain('Notice date 12 Jun 2026.')
    expect(txt(by('UNDATED-1'), 'pubDate')).toBe('Tue, 01 Sep 2026 00:00:00 GMT')
    expect(txt(by('UNDATED-1'), 'description')).toContain('Undated: the regulator gave no date. Sep 2026 is the month Nazar first saw this alert.')
    expect(txt(by('TN-77'), 'description')).toContain(`<a href="https://explorer.test/entity/${key}">`)
    // Undated alerts sort after dated ones (FEED_ORDER).
    expect(txt(items(root).at(-1)!, 'link')).toBe(`${SITE}/b/UNDATED-1`)
  })

  it('applies the /v1/alerts filters and names them in the channel title and links', async () => {
    const peds = await rss('?peds=true&state=IN-TN')
    const ch = kid(peds.root, 'channel')
    expect(txt(ch, 'title')).toBe('Nazar · Indian medicine batch alerts · Tamil Nadu · Child Shield')
    expect(txt(ch, 'link')).toBe(`${SITE}/feed?peds=1&state=IN-TN`)
    expect(kid(ch, 'atom:link').attrs.href).toBe('http://localhost/v1/alerts.rss?state=IN-TN&peds=true')
    expect(items(peds.root).map((i) => txt(i, 'link'))).toEqual([`${SITE}/b/SR-13`])

    const gj = await rss('?state=IN-GJ')
    expect(items(gj.root).map((i) => txt(i, 'link'))).toEqual([`${SITE}/b/R01GL2523`])
    expect(items((await rss('?minSeverity=5&sinceYm=202601')).root)).toHaveLength(0)
    expect(items((await rss('?source=tn-dc')).root).map((i) => txt(i, 'link'))).toEqual([`${SITE}/b/TN-77`])
    expect(txt(kid((await rss('?source=tn-dc&minSeverity=4&productClass=medicine')).root, 'channel'), 'title')).toBe(
      'Nazar · Indian medicine batch alerts · Tamil Nadu Drugs Control · Medicines · Severity 4+',
    )
    expect((await get('/v1/alerts.rss?state=Tamil')).status).toBe(400)
    expect((await get('/v1/alerts.atom?productClass=food')).status).toBe(400)
  })

  it('escapes <&>"\' and strips XML-invalid characters from regulator text; never emits non-http links', async () => {
    const evil = `Evil <script>alert("x")</script> & 'Co' ]]>`
    addAlert(ledger, {
      rid: 'feede0001',
      batch: 'EV<1>&"\'',
      brand: evil,
      product: evil,
      reason: `Bad\u0001 <b>bold</b> & "quoted" 'single'`,
      manufacturer: '<img src=x onerror=alert(1)>',
      noticeUrl: 'javascript:alert(1)',
      noticeTitle: '</description><injected/>',
      alertYm: 202612,
      noticeDate: null,
    })
    for (const format of ['rss', 'atom'] as const) {
      const res = await get(`/v1/alerts.${format}`)
      const body = await res.text()
      const root = parseXml(body) // well-formed despite the payload
      expect(body).not.toContain('<script>')
      expect(body).not.toContain('<injected')
      expect(body).not.toContain('<img')
      expect(body).not.toContain('javascript:')
      expect(body).not.toContain('\u0001')
      const entries = format === 'rss' ? items(root) : kids(root, 'entry')
      const e = entries[0]!
      expect(txt(e, 'title')).toBe(`${evil} · batch EV<1>&"' · flagged by WHO`.replace('WHO', ledger.alertsByBatchKey('tn77')[0]!.record.authority))
      const link = format === 'rss' ? txt(e, 'link') : kid(e, 'link').attrs.href
      expect(link).toBe(`${SITE}/b/${encodeURIComponent('EV<1>&"\'')}`)
      // Inside the (decoded) HTML, regulator text is HTML-escaped once more.
      const html = format === 'rss' ? txt(e, 'description') : txt(e, 'content')
      expect(html).toContain('Bad &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; &#39;single&#39;')
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
      expect(html).not.toContain('href="javascript')
    }
    const json = await (await get('/v1/alerts.json')).json()
    expect(json.items[0].title).toContain(evil)
    expect(json.items[0].external_url).toBeUndefined()
    expect(xmlEscape(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;')
  })

  it('never says "safe", except in the negated disclaimer', async () => {
    for (const format of ['rss', 'atom', 'json']) {
      for (const q of ['', '?peds=true', '?state=IN-TN&minSeverity=2']) {
        const body = await (await get(`/v1/alerts.${format}${q}`)).text()
        expect(body).toContain('never a safety certificate')
        expect(body.split(DISCLAIMER).join('')).not.toMatch(/safe/i)
      }
    }
  })

  it('content types, cache headers (browser + CDN) and ETag revalidation', async () => {
    const types = { rss: 'application/rss+xml; charset=utf-8', atom: 'application/atom+xml; charset=utf-8', json: 'application/feed+json; charset=utf-8' }
    for (const [format, type] of Object.entries(types)) {
      const res = await get(`/v1/alerts.${format}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe(type)
      expect(res.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=60, stale-while-revalidate=300')
      expect(res.headers.get('cdn-cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300')
      const tag = res.headers.get('etag')
      expect(tag).toBeTruthy()
      // Unchanged data → same body → 304 (the build date comes from the items, not the clock).
      expect((await get(`/v1/alerts.${format}`, { 'if-none-match': tag! })).status).toBe(304)
    }
  })

  it('default limit 50, max 200', async () => {
    for (let n = 0; n < 60; n++) addAlert(ledger, { rid: `feedl${String(n).padStart(4, '0')}`, batch: `LIM-${n}` })
    expect(items((await rss()).root)).toHaveLength(50)
    expect(items((await rss('?limit=200')).root)).toHaveLength(63)
    expect(items((await rss('?limit=2')).root)).toHaveLength(2)
    expect(kids((await parseXml(await (await get('/v1/alerts.atom?limit=5')).text())), 'entry')).toHaveLength(5)
    expect((await (await get('/v1/alerts.json?limit=7')).json()).items).toHaveLength(7)
    expect((await get('/v1/alerts.rss?limit=201')).status).toBe(400)
    expect((await get('/v1/alerts.rss?limit=0')).status).toBe(400)
  })

  it('retracted alerts are left out', async () => {
    ledger.markRetracted(ledger.alertsByBatchKey('sr13')[0]!.rid)
    for (const format of ['rss', 'atom', 'json']) {
      const body = await (await get(`/v1/alerts.${format}`)).text()
      expect(body).not.toContain('/b/SR-13')
      expect(body).toContain('/b/TN-77')
    }
  })

  it('Atom 1.0: well-formed with feed metadata and entries', async () => {
    const res = await get('/v1/alerts.atom?peds=true')
    expect(res.headers.get('content-type')).toBe('application/atom+xml; charset=utf-8')
    const root = parseXml(await res.text())
    expect(root.name).toBe('feed')
    expect(root.attrs).toEqual({ xmlns: 'http://www.w3.org/2005/Atom', 'xml:lang': 'en-IN' })
    expect(txt(root, 'title')).toBe('Nazar · Indian medicine batch alerts · Child Shield')
    const links = kids(root, 'link').map((l) => l.attrs)
    expect(links).toContainEqual({ rel: 'self', type: 'application/atom+xml', href: 'http://localhost/v1/alerts.atom?peds=true' })
    expect(links).toContainEqual({ rel: 'alternate', type: 'text/html', href: `${SITE}/feed?peds=1` })
    expect(txt(root, 'id')).toBe('tag:nazar-nu.vercel.app,2026:alerts?peds=true')
    expect(txt(root, 'updated')).toBe('2025-10-15T00:00:00.000Z')
    expect(txt(kid(root, 'author'), 'name')).toBe('Nazar')
    const [entry] = kids(root, 'entry')
    expect(txt(entry!, 'title')).toMatch(/ · batch SR-13 · flagged by WHO$/)
    expect(txt(entry!, 'id')).toMatch(/^tag:nazar-nu\.vercel\.app,2026:alert:[0-9a-f]+$/)
    expect(txt(entry!, 'updated')).toBe('2025-10-15T00:00:00.000Z')
    expect(kids(entry!, 'category').map((c) => c.attrs.term)).toContain('Child Shield')
    expect(kid(entry!, 'content').attrs.type).toBe('html')
    expect(txt(entry!, 'content')).toContain(DISCLAIMER)
  })

  it('JSON Feed 1.1', async () => {
    const res = await get('/v1/alerts.json?state=IN-TN')
    expect(res.headers.get('content-type')).toBe('application/feed+json; charset=utf-8')
    const feed = await res.json()
    expect(feed).toMatchObject({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Nazar · Indian medicine batch alerts · Tamil Nadu',
      home_page_url: `${SITE}/feed?state=IN-TN`,
      feed_url: 'http://localhost/v1/alerts.json?state=IN-TN',
      language: 'en-IN',
    })
    expect(feed.items.length).toBeGreaterThan(0)
    for (const item of feed.items) {
      expect(item.url).toMatch(new RegExp(`^${SITE}/b/`))
      expect(item.content_text.endsWith(DISCLAIMER)).toBe(true)
      expect(new Date(item.date_published).getTime()).not.toBeNaN()
    }
  })

  it('CORS: the public feeds are open to any origin (browser feed readers); readers without an Origin get 200', async () => {
    const web = await get('/v1/alerts.rss', { origin: ORIGIN })
    expect(web.status).toBe(200)
    expect(web.headers.get('access-control-allow-origin')).toBe('*')
    const other = await get('/v1/alerts.json', { origin: 'https://some-feed-reader.example' })
    expect(other.headers.get('access-control-allow-origin')).toBe('*')
    const pre = await app.request('/v1/alerts.atom', { method: 'OPTIONS', headers: { origin: 'https://some-feed-reader.example', 'access-control-request-method': 'GET' } })
    expect(pre.headers.get('access-control-allow-methods')).toContain('GET')
    const reader = await get('/v1/alerts.rss', { 'user-agent': 'Feedly/1.0' })
    expect(reader.status).toBe(200)
    // The rest of /v1 stays limited to the web origins.
    const api = await get('/v1/alerts', { origin: 'https://some-feed-reader.example' })
    expect(api.headers.get('access-control-allow-origin')).not.toBe('*')
  })

  it('self link follows the public host and X-Forwarded-Proto; site origin comes from NAZAR_SITE_URL', async () => {
    const res = await app.request('http://nazar-api.example/v1/alerts.rss?peds=1', { headers: { 'x-forwarded-proto': 'https' } })
    const ch = kid(parseXml(await res.text()), 'channel')
    expect(kid(ch, 'atom:link').attrs.href).toBe('https://nazar-api.example/v1/alerts.rss?peds=true')

    setEnvForTests({ NAZAR_SITE_URL: 'https://nazar.example.org/' })
    app = make()
    const { root } = await rss('?peds=true')
    expect(txt(kid(root, 'channel'), 'link')).toBe('https://nazar.example.org/feed?peds=1')
    expect(txt(items(root)[0]!, 'link')).toBe('https://nazar.example.org/b/SR-13')
  })

  it('feeds are not MCP tools', () => {
    const src = readFileSync(new URL('../../src/mcp/server.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/alerts\.(rss|atom|json)|renderFeed/)
  })
})
