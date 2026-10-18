// End-to-end check of the Nazar web app over the Chrome DevTools Protocol (no browser-automation dependency).
// Usage: node e2e.mjs <outDir> [fallback|mock|live]
//   fallback: Nazar API requests are refused (CDP Fetch), Arkiv has no data for the build's publisher, so demo data answers.
//   mock:     API responses are served by CDP Fetch interception (contract from the brief).
//   live:     the real backend on :8787 answers.
import fs from 'node:fs'
const OUT = process.argv[2]; const MODE = process.argv[3] || 'fallback'
const URL = process.env.E2E_URL || 'http://localhost:3124/'
fs.mkdirSync(OUT, { recursive: true })
const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9334}/json/list`)).json()
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
let id = 0; const pending = new Map(); const consoleErrors = []; const netFailures = []; const requests = []
const handlers = []
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) consoleErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '))
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') netFailures.push(m.params.entry.url || m.params.entry.text)
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url)
  for (const h of handlers) h(m)
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const js = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(expr + ' -> ' + JSON.stringify(r.result.exceptionDetails.exception?.description)); return r.result?.result?.value }
const results = []; const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]) }
const click = text => js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`)
const clickHas = text => js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
const body = () => js('document.body.innerText')
const waitFor = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expr)) return true; await wait(100) } return false }
/** A check is done when no loading card is on screen. */
const waitIdle = async () => { await wait(250); await waitFor(`!document.querySelector('section[aria-busy="true"]')`) ; await wait(150) }
const typeBatch = async v => { await js(`(() => { const i = document.getElementById('batch'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`); await waitIdle() }
const vp = (w, h, dark, reduced = false) => Promise.all([
  send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 600 }),
  send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] }),
])
const shot = async (name, delay = 400) => { await wait(delay); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const settle = () => waitFor(`!document.querySelector('[aria-label="High-severity alerts"][aria-busy="true"]') && !document.querySelector('[data-status="checking"]')`)
const fresh = async (dark = false) => { await send('Page.navigate', { url: URL }); await wait(1500); await js(`localStorage.clear(); localStorage.setItem('theme', '${dark ? 'dark' : 'light'}')`); await send('Page.reload'); await wait(1200); await settle() }
const feedIdle = async () => { await wait(200); return waitFor(`!!document.querySelector('[data-feed][aria-busy="false"]')`) }
const feedRows = () => js(`document.querySelectorAll('[data-alert-row]').length`)
const feedCount = () => js(`document.querySelector('[data-feed-count]')?.innerText || ''`)
const rowTexts = () => js(`[...document.querySelectorAll('[data-alert-row]')].map(b => b.innerText)`)
const pick = async (id, v) => { await js(`(() => { const s = document.getElementById(${JSON.stringify(id)}); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(v)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`); await feedIdle() }
const press = async label => { await js(`[...document.querySelectorAll('[data-feed], section[aria-label="Filter alerts"] button, button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && b.offsetParent)?.click()`); await feedIdle() }
/** Follows a visible nav link and reports whether the page stayed alive (client-side routing, no reload). */
const navTo = async label => { await js(`window.__spa = 1; [...document.querySelectorAll('nav a')].find(a => (a.dataset.label ?? a.textContent.trim()) === ${JSON.stringify(label)} && a.offsetParent)?.click()`); await wait(900); return js(`window.__spa === 1`) }
const openFeed = async () => { const spa = await navTo('Alerts'); await feedIdle(); return spa }
const ARKIV_RPC = 'https://rpc.tiramisu.db-chain.testnet.arkiv.network'
const proofText = () => js(`document.querySelector('[role="dialog"]')?.innerText || ''`)
const escape = async () => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(700) }

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable')
// The production build registers a service worker; tests talk to the network (and the mocks) directly.
await send('Network.setBypassServiceWorker', { bypass: true })

// ---- Mock API via Fetch interception
const KEY1 = '0x8b1c2a7e3f9d4c6b5a0e1f2d3c4b5a69788766554433221100ffeeddccbbaa99'
const KEY2 = '0x1f2e3d4c5b6a79881726354453627180a9b8c7d6e5f40312213243546576879a'
const WALLET = '0xd06d85Eb20f126f796E4a341b711B1a757c66bD2'
const TX = '0xabc0000000000000000000000000000000000000000000000000000000000def'
const NOTICE_KEY = '0x5e1f0000000000000000000000000000000000000000000000000000000c0ffe'
const BUILD_PUBLISHER = process.env.E2E_PUBLISHER || '0x000000000000000000000000000000000000dEaD'
const dto = (o) => ({ rid: 'r-' + o.entityKey.slice(2, 10), caseId: 'c1', batch: 'SR-13', batchKey: 'sr13', brand: 'COLDRIF', product: 'COLDRIF Syrup', generic: 'Paracetamol, Phenylephrine, Chlorpheniramine', form: 'syrup', category: 'adulterated', failures: ['glycol'], reason: 'Diethylene glycol 48.6% w/v', severity: 5, severityRules: ['Toxic glycol: base 5'], ruleVersion: 'sev@1', peds: true, manufacturer: 'Sresan Pharmaceutical, Kancheepuram', manufacturerRole: 'maker', plantId: null, state: 'IN-TN', mfgYm: 202505, expYm: 202704, alertYm: 202510, sourceId: 'x', jurisdiction: 'IN', noticeSha: 'a'.repeat(64), noticeTitle: 'Notice', noticeUrl: 'https://example.org/notice.pdf', noticeDate: '2025-10-13', method: 'text', confidence: 0.97, tier: 'auto', creator: WALLET, txHash: TX, publishedAt: '2025-10-14T00:00:00Z', retracted: false, explorer: { entity: 'https://tiramisu.explorer.arkiv.network/entity/' + o.entityKey, tx: 'https://tiramisu.explorer.arkiv.network/tx/' + TX }, ...o })
const MOCK_ALERTS = [
  dto({ entityKey: KEY1, authority: 'World Health Organization', noticeTitle: 'Medical Product Alert N°5/2025', noticeDate: '2025-10-13', tier: 'auto', noticeEntityKey: NOTICE_KEY }),
  // Signed by the build's publisher (CI builds with the dEaD address), so it is marked official.
  dto({ entityKey: KEY2, authority: 'Tamil Nadu Drugs Control', noticeTitle: 'NSQ list, October 2025', noticeDate: '2025-10-04', alertYm: 202510, tier: 'machine_read', method: 'ocr', confidence: 0.82, creator: BUILD_PUBLISHER }),
]
const FEED_TOP = [MOCK_ALERTS[0], { ...MOCK_ALERTS[0], rid: 'r-other', batch: 'AX-77', batchKey: 'ax77', brand: 'Example Tabs', peds: false, severity: 4, entityKey: KEY2 }, { ...MOCK_ALERTS[0], rid: 'r-low', batch: 'LW-1', batchKey: 'lw1', brand: 'Low Severity Tabs', peds: false, severity: 2, entityKey: KEY2 }]
/** 40 lower-severity alerts for paging; every 7th is a Maharashtra FDA row, which has no notice date. */
const FEED_EXTRA = Array.from({ length: 40 }, (_, i) => {
  const mh = i % 7 === 3
  return { ...MOCK_ALERTS[0], rid: 'r-x' + String(i).padStart(3, '0'), caseId: 'cx' + i, batch: 'FX-' + (100 + i), batchKey: 'fx' + (100 + i), brand: (mh ? 'Mahacef 200 ' : 'Feed Item ') + i, product: null, peds: false, severity: 1 + (i % 3), state: mh ? 'IN-MH' : 'IN-GJ', alertYm: i < 20 ? 202509 : 202508, sourceId: mh ? 'mh-fda' : 'cdsco-online', authority: mh ? 'Food and Drug Administration, Maharashtra' : 'CDSCO', noticeDate: mh ? null : '2025-09-01', noticeTitle: mh ? 'NSQ alerts' : 'CDSCO NSQ list', entityKey: KEY2 }
})
const MH_ROWS = FEED_EXTRA.filter(a => a.sourceId === 'mh-fda').length

/** The on-device snapshot (format: Nazar-backend/src/api/snapshot.ts) mirroring MOCK_ALERTS for SR-13. */
const SNAPSHOT_FIXTURE = {
  v: 1, version: 'e2e0000000000001', generatedAt: new Date(Date.now() - 10 * 60_000).toISOString(), count: 3,
  notices: [['World Health Organization', 'Medical Product Alert N°5/2025', 'https://example.org/notice.pdf', '2025-10-13', 'x'], ['Tamil Nadu Drugs Control', 'NSQ list, October 2025', 'https://example.org/notice.pdf', '2025-10-04', 'x']],
  alerts: {
    sr13: [
      ['SR-13', 0, 'COLDRIF', 'COLDRIF Syrup', 'Paracetamol, Phenylephrine, Chlorpheniramine', 'syrup', 'adulterated', 'glycol', 'Diethylene glycol 48.6% w/v', 5, 1, 'Sresan Pharmaceutical, Kancheepuram', 0, 'IN-TN', 202505, 202704, 202510, 0, 1, 0],
      ['SR-13', 1, 'COLDRIF', 'COLDRIF Syrup', 'Paracetamol, Phenylephrine, Chlorpheniramine', 'syrup', 'adulterated', 'glycol', 'Diethylene glycol 48.6% w/v', 5, 1, 'Sresan Pharmaceutical, Kancheepuram', 0, 'IN-TN', 202505, 202704, 202510, 1, 1, 0],
    ],
    ax77: [['AX-77', 0, 'Example Tabs', null, null, 'tablet', 'nsq', 'assay', 'Assay', 4, 0, null, 0, 'IN-GJ', null, null, 202510, 0, 1, 0]],
  },
}

let mockResponse = function mockResponse(url) {
  const u = new globalThis.URL(url)
  if (u.pathname === '/v1/pipeline/status') return { heartbeat: { lastOkMs: Date.now() - 4 * 60_000, entityKey: KEY1 }, runs: [], stats: {}, publisher: { address: WALLET, balanceGlm: 0.4 }, mode: 'live' }
  if (u.pathname === '/v1/alerts') {
    // Honours limit/offset/state/minSeverity/peds like the real server, and ignores `source` like the current one.
    const q = u.searchParams; const peds = q.get('peds'); const min = Number(q.get('minSeverity') || 0); const state = q.get('state')
    const limit = Number(q.get('limit') || 50); const offset = Number(q.get('offset') || 0)
    const all = [...FEED_TOP, ...FEED_EXTRA].filter(a => (!peds || a.peds) && a.severity >= min && (!state || a.state === state))
    return { items: all.slice(offset, offset + limit), total: all.length }
  }
  if (u.pathname === '/v1/sources') {
    return { items: [
      { id: 'cdsco-online', authority: 'CDSCO', jurisdiction: 'IN', homepage: 'https://cdscoonline.gov.in/CDSCO/viewPublicNSQDrug', description: 'CDSCO NSQ portal', schedule: '0 */6 * * *', enabled: true, disabledReason: null, lastRun: { lastCheckedMs: Date.now() - 5 * 60_000, ok: true, docs: 3 } },
      { id: 'tg-dca', authority: 'Drugs Control Administration, Telangana', jurisdiction: 'IN-TG', homepage: 'https://dca.telangana.gov.in/', description: 'Telangana DCA', schedule: '0 */6 * * *', enabled: false, disabledReason: 'refuses connections from outside India', lastRun: null },
    ] }
  }
  if (u.pathname === '/v1/snapshot') return mock.snapshot ? SNAPSHOT_FIXTURE : null
  if (u.pathname === '/v1/notices') return { items: [{ sha: 'a'.repeat(64), entityKey: NOTICE_KEY, title: 'Notice' }] }
  if (u.pathname === '/v1/search') {
    // Like the real server (FTS5 over batch, brand, product, manufacturer, reason): every word must start a word; { items }, at most `limit`.
    const words = (v) => String(v ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    const terms = words(u.searchParams.get('q')); const limit = Math.min(100, Number(u.searchParams.get('limit') || 25))
    const hits = [...(mock.feedNew || []), ...FEED_TOP, ...FEED_EXTRA].filter(a => terms.length && terms.every(t => [a.batch, a.brand, a.product, a.manufacturer, a.reason].flatMap(words).some(w => w.startsWith(t))))
    return { items: hits.slice(0, limit) }
  }
  if (u.pathname === '/v1/check') {
    const b = (u.searchParams.get('batch') || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const asOf = new Date().toISOString()
    if (b === 'sr13') return { state: 'flagged', batch: 'SR-13', asOf, alerts: MOCK_ALERTS, source: 'ledger' }
    if (b === '5r13') return { state: 'unreadable', batch: '5R-13', asOf, alerts: [], suggestion: 'SR-13', source: 'ledger' }
    return { state: 'no_alert', batch: u.searchParams.get('batch'), asOf, alerts: [], source: 'ledger' }
  }
  return null
}
/** Fallback-mode switches: serve the site's saved copy, and how long its 404 takes otherwise. */
const fb = { savedCopy: false, staticDelayMs: 700 }
const mock = { apiDown: false, arkiv429: false, arkivHits: 0, medicine: 'ok', medicineBodies: [], snapshot: false, checkDelayMs: 0, identify: 'ok', identifyBodies: [] }
const MEDICINE_FIXTURE = JSON.parse(fs.readFileSync(new globalThis.URL('./fixtures/medicine-explain.json', import.meta.url), 'utf8'))
const IDENTIFY_FIXTURE = JSON.parse(fs.readFileSync(new globalThis.URL('./fixtures/medicine-identify.json', import.meta.url), 'utf8'))
/** POST /v1/medicine/identify answers by mode: ok, limited (429 + Retry-After), failed (502), disabled (503). */
const IDENTIFY_REPLY = {
  ok: [200, IDENTIFY_FIXTURE, []],
  limited: [429, { error: { code: 'RATE_LIMITED', message: 'Too many requests', retryAfterSec: 180 } }, [{ name: 'Retry-After', value: '180' }]],
  failed: [502, { error: { code: 'LLM_FAILED', message: 'The model did not answer' } }, []],
  disabled: [503, { error: { code: 'LLM_DISABLED', message: 'AI is not configured on this server' } }, []],
}
const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: 'content-type' }, { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' }, { name: 'Access-Control-Expose-Headers', value: 'Retry-After' }]
if (MODE === 'mock') {
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:8787/*' }, { urlPattern: ARKIV_RPC + '*' }] })
  handlers.push(async m => {
    if (m.method !== 'Fetch.requestPaused') return
    const { requestId, request } = m.params
    if (request.url.startsWith(ARKIV_RPC)) {
      if (request.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS })
      mock.arkivHits++
      if (!mock.arkiv429) return send('Fetch.continueRequest', { requestId })
      return send('Fetch.fulfillRequest', { requestId, responseCode: 429, responseHeaders: [...CORS, { name: 'Retry-After', value: '120' }, { name: 'Content-Type', value: 'text/plain' }], body: Buffer.from('rate limited').toString('base64') })
    }
    if (mock.apiDown) return send('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' })
    if (request.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS })
    if (new globalThis.URL(request.url).pathname === '/v1/medicine/explain') {
      mock.medicineBodies.push(request.postData || '')
      const [code, data] = mock.medicine === 'disabled' ? [503, { error: { code: 'LLM_DISABLED', message: 'Medicine information is not available on this server.' } }] : [200, MEDICINE_FIXTURE]
      return send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...CORS], body: Buffer.from(JSON.stringify(data)).toString('base64') })
    }
    if (new globalThis.URL(request.url).pathname === '/v1/medicine/identify') {
      mock.identifyBodies.push(request.postData || '')
      const [code, data, extra] = IDENTIFY_REPLY[mock.identify]
      return send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...CORS, ...extra], body: Buffer.from(JSON.stringify(data)).toString('base64') })
    }
    if (mock.checkDelayMs && new globalThis.URL(request.url).pathname === '/v1/check') await wait(mock.checkDelayMs)
    const data = mockResponse(m.params.request.url)
    await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: data ? 200 : 404, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(data ?? { error: 'not found' })).toString('base64') })
  })
}

if (MODE === 'fallback') {
  // Refuse the Nazar API even if one is running locally, so answers are deterministic. The site's
  // own saved copy (/data/snapshot.json) answers 404 after a short wait, so this flow exercises the
  // last resort (demo data) and the loading card has a dependable window whatever Arkiv is doing;
  // the "Saved copy" block at the end serves the real file.
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:8787/*' }, { urlPattern: '*/data/snapshot.json*' }] })
  handlers.push(async m => {
    if (m.method !== 'Fetch.requestPaused') return
    const { requestId, request } = m.params
    if (!request.url.includes('/data/snapshot.json')) return send('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' })
    if (fb.savedCopy) return send('Fetch.continueRequest', { requestId })
    await wait(fb.staticDelayMs)
    send('Fetch.fulfillRequest', { requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: Buffer.from('not here').toString('base64') })
  })

  // ---- Mobile, light: onboarding flow
  await vp(390, 844, false); await fresh()
  ok('onboarding opens on first visit', (await body()).includes('An eye on every batch'))
  await shot('mobile-onboarding')
  await click('Show me how'); await wait(400); ok('step 2: find the batch number', (await body()).includes('Find the batch number'))
  await click('Next'); await wait(400); ok('step 3: four honest answers', (await body()).includes('Four honest answers'))
  await click('Next'); await wait(400); ok('step 4: proof and privacy', (await body()).includes('Proof you can check'))
  await click('Try SR-13'); await waitIdle(); await wait(600)
  ok('Try SR-13 closes guide and flags batch', !(await body()).includes('Proof you can check') && (await body()).includes('This batch failed a government quality test'))
  ok('onboarded flag saved', (await js(`localStorage.getItem('nazar:onboarded')`)) === '1')
  ok('Child Shield banner on SR-13', (await body()).includes('This is a children'))
  ok('severity pips 5/5', await js(`!!document.querySelector('[aria-label="Severity 5 of 5"]')`))
  ok('SR-13 shows corrected WHO data (COLDRIF, Sresan, Kancheepuram)', /COLDRIF · Sresan Pharmaceutical, Kancheepuram, Tamil Nadu/.test(await body()))
  ok('result names its source: Demo data', (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'demo' && (await js(`document.querySelector('section[data-state] [data-source]').innerText`)) === 'Demo data')
  ok('Arkiv was queried before falling back to demo', requests.some(u => u.startsWith('https://rpc.tiramisu.db-chain.testnet.arkiv.network')))
  ok('API was tried once at load (shared probe)', requests.filter(u => u.startsWith('http://localhost:8787/')).length >= 1 && requests.filter(u => u.startsWith('http://localhost:8787/')).length <= 2, String(requests.filter(u => u.startsWith('http://localhost:8787/')).length))
  await js(`document.querySelector('[aria-live="polite"]').scrollIntoView({block:'start'}); window.scrollBy(0,-90)`); await shot('mobile-flagged')
  await clickHas('How do we know'); await wait(900)
  ok('proof drawer opens', (await body()).includes('Source SHA-256'))
  const p = await proofText()
  ok('proof: authority + WHO notice + date', p.includes('World Health Organization') && p.includes('Medical Product Alert N°5/2025') && p.includes('13 Oct 2025'), p.slice(0, 200))
  ok('proof: batch dates Mfg May 2025 · Exp Apr 2027', p.includes('Mfg May 2025 · Exp Apr 2027'))
  ok('proof: demo record shows no fake entity key', p.includes('Not published (demo record)') && p.includes('Demo record:') && !/0x[0-9a-f]{4}…/i.test(p))
  ok('proof: source document link to who.int', (await js(`[...document.querySelectorAll('[role="dialog"] a')].find(a => a.textContent.includes('View source notice'))?.href || ''`)).startsWith('https://www.who.int/news/item/13-10-2025-medical-product-alert-n-5-2025'))
  ok('proof: source SHA has copy button', (await js(`!!document.querySelector('[role="dialog"] [aria-label="Copy source SHA-256"]')`)))
  ok('proof drawer fits 390 without horizontal scroll', (await js(`(() => { const d = document.querySelector('[role="dialog"]'); return d.scrollWidth <= d.clientWidth + 1 })()`)))
  await shot('mobile-proof')
  await escape()
  ok('proof drawer closes on Escape', !(await body()).includes('Source SHA-256'))
  // Phones show the on-chain proof as one line that opens the proof sheet, not the full chain again.
  ok('mobile: on-chain proof is one line ("Not yet on Arkiv · View proof"), not the full chain', (await js(`document.querySelector('section[data-state="flagged"] [data-proof-line]')?.dataset.proofLine`)) === 'unpublished' && !(await js(`!!document.querySelector('section[data-state="flagged"] [data-onchain-proof]')`)) && /Not yet on Arkiv\s*View proof/.test(await js(`document.querySelector('[data-proof-line]').innerText`)))
  await js(`document.querySelector('[data-proof-line] button').click()`); await wait(900)
  ok('mobile: the proof line opens the proof sheet', (await proofText()).includes('Source SHA-256'))
  await escape()

  // Loading state: slow the network so the in-flight card is visible.
  await send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 })
  await js(`window.__busy = null; window.__mo = new MutationObserver(() => { const s = document.querySelector('section[aria-busy="true"]'); if (s && !window.__busy) window.__busy = { text: s.innerText, label: s.getAttribute('aria-label'), btn: document.querySelector('button[aria-busy="true"]')?.innerText || '' } }); window.__mo.observe(document.body, { subtree: true, childList: true })`)
  await js(`(() => { const i = document.getElementById('batch'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'R01GL2523'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
  await waitFor(`!!window.__busy`, 4000); await js(`document.querySelector('section[aria-busy="true"]')?.scrollIntoView({block:'center'})`); await shot('mobile-loading', 0)
  await waitIdle()
  const busy = await js(`window.__busy`)
  ok('loading card shows with aria-busy while checking', !!busy && busy.label === 'Checking batch R01GL2523' && /Checking batch R01GL2523/.test(busy.text), JSON.stringify(busy))
  ok("loading card names the stage (Arkiv, or Nazar's saved copy while Arkiv is rate limiting)", !!busy && /Arkiv|saved copy/.test(busy.text), busy?.text?.slice(0, 120))
  ok('check button shows Checking while busy', !!busy && busy.btn.includes('Checking'))
  ok('R01GL2523 lands as flagged (Respifresh TR, Rednex)', (await body()).includes('Respifresh TR · Rednex Pharmaceutical Pvt Ltd, Ahmedabad, Gujarat'))
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await typeBatch('LSL25160'); ok('LSL25160 flagged (ReLife, Shape Pharma)', (await body()).includes('ReLife · Shape Pharma Pvt Ltd, Surendranagar, Gujarat'))

  await typeBatch('demo-rt1'); ok('retracted state', (await body()).includes('An alert on this batch was withdrawn'))
  await typeBatch('!!'); ok("can't tell state for bad input", (await body()).includes("We couldn't read the batch number clearly"))
  ok('bad input is answered on the device', (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'local')
  await typeBatch('(N)25567'); ok('CDSCO-style batch (N)25567 is readable, not "can\'t tell"', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'no_alert' && !(await body()).includes("We couldn't read the batch number clearly"))
  await typeBatch('5R-13'); ok('look-alike suggests SR-13, not flagged', (await body()).includes('Did you mean') && !(await body()).includes('This batch failed'))
  {
    const sec = `document.querySelector('section[data-state]')`
    const text = await js(`${sec}?.innerText || ''`)
    ok('look-alike: asks "Did you mean SR-13?" in the amber Can\'t tell card, never "couldn\'t read" or a flag', (await js(`${sec}.dataset.state`)) === 'unreadable' && (await js(`${sec}.querySelector('[data-verdict-headline]')?.innerText`)) === 'Did you mean SR-13?' && !text.includes("couldn't read") && !/flagged/i.test(text) && /can.t tell/i.test(text), text.slice(0, 160))
    ok('look-alike: says 5R-13 has no alert and is one character from SR-13', text.includes('5R-13 has no alert, but it is one character away from SR-13') && text.includes('Check the batch number on the pack again.'))
  }
  ok('look-alike: Check SR-13 button is a 44px target', (await js(`(() => { const b = document.querySelector('[data-lookalike-check]'); return !!b && b.textContent.trim() === 'Check SR-13' && b.getBoundingClientRect().height >= 44 })()`)))
  await click('Check SR-13'); await waitIdle(); ok('suggestion click checks SR-13', (await body()).includes('This batch failed a government quality test'))
  await typeBatch('B.No. SR-13'); ok('the pack label typed with the batch ("B.No. SR-13") still flags SR-13', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'flagged')
  await typeBatch('Batch No: SR-13'); ok('"Batch No: SR-13" also flags SR-13', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'flagged')
  await typeBatch('AB1234'); const b = await body()
  ok('no alert state + not a safety certificate', b.includes('No official alert for this batch as of') && b.includes('This is not a safety certificate'))
  const green = await js(`(() => { const el = document.querySelector('[aria-live="polite"]'); const all = [el, ...el.querySelectorAll('*')]; return all.some(n => { const c = getComputedStyle(n); return [c.color, c.backgroundColor, c.borderColor].some(v => { const m = v.match(/\\d+(\\.\\d+)?/g); if (!m) return false; const [r,g,bl] = m.map(Number); return g > r + 40 && g > bl + 40 }) }) })()`)
  ok('no-alert card uses no green', green === false)
  ok('sentinel eye: slate for no alert (never green), decorative to screen readers', (await js(`(() => { const e = document.querySelector('main [data-sentinel]'); return e?.dataset.state + ':' + e?.getAttribute('aria-hidden') })()`)) === 'no_alert:true')
  await typeBatch('SR-13'); ok('sentinel eye: turns to the flagged state for SR-13', (await js(`document.querySelector('main [data-sentinel]')?.dataset.state`)) === 'flagged')
  await typeBatch('5R-13'); ok("sentinel eye: Can't tell for a look-alike, not flagged", (await js(`document.querySelector('main [data-sentinel]')?.dataset.state`)) === 'unreadable')
  await typeBatch('AB1234')
  ok('never says safe', !/\bsafe\b/i.test((await body()).replace(/not a safety certificate|never certifies a medicine as safe/gi, '')))

  ok('no horizontal overflow at 390', (await js(`document.documentElement.scrollWidth`)) <= 390)
  ok('Try chips are 44px tap targets', (await js(`(() => { const c = [...document.querySelectorAll('[data-try-chip]')]; return c.length === 4 && c.every(b => b.getBoundingClientRect().height >= 44) })()`)), String(await js(`[...document.querySelectorAll('[data-try-chip]')].map(b => Math.round(b.getBoundingClientRect().height)).join()`)))
  ok('check: the hero headline is the page h1, visible at 390', await js(`(() => { const h = document.querySelector('h1[data-check-hero]'); return !!h && !!h.offsetParent && h.innerText.replace(/\\s+/g, ' ').trim() === 'Check the batch, not just the brand.' })()`))
  {
    const ratio = await js(`(() => { const lum = c => { const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }; const i = document.getElementById('batch'); const fg = getComputedStyle(i, '::placeholder').color; const bg = getComputedStyle(i.parentElement).backgroundColor; if (!/^rgb\\(/.test(fg) || !/^rgb\\(/.test(bg)) return 0; const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return Math.round((a + 0.05) / (b + 0.05) * 100) / 100 })()`)
    ok('check: batch placeholder contrast is at least 4.5:1', ratio >= 4.5, String(ratio))
  }
  await js(`(() => { const i = document.getElementById('batch'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur() })()`); await wait(150)
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Check batch'))?.click()`); await wait(300)
  ok('check: empty submit says what to enter (polite status) and focuses the box', (await js(`document.querySelector('[data-empty-hint]')?.innerText || ''`)) === 'Enter the batch number from the pack (B.No.)' && (await js(`document.activeElement?.id`)) === 'batch' && (await js(`document.querySelector('[data-empty-hint]').getAttribute('role')`)) === 'status')
  await typeBatch('AB1234')
  ok('check: the empty-box message clears once a batch is entered', !(await js(`document.querySelector('[data-empty-hint]')?.innerText`)))

  // ---- Live wiring on the home page (fallback)
  ok('status pill: offline · demo data (compact on mobile)', (await js(`document.querySelector('[data-status]')?.dataset.status`)) === 'offline' && (await js(`document.querySelector('[data-status]').getAttribute('aria-label')`)) === 'Status: Offline · demo data')
  ok('active alerts list falls back to 3 demo alerts', (await body()).includes('3 active') && (await js(`document.querySelectorAll('[aria-label="High-severity alerts"] li button').length`)) === 3)
  ok('Child Shield count from feed', /3 active right now\./.test(await body()))

  // ---- Persistence, shortcuts, theme
  await send('Page.reload'); await wait(1500); await settle()
  ok('guide does not reopen after onboarding', !(await body()).includes('An eye on every batch'))
  const recent = await js(`JSON.parse(localStorage.getItem('nazar:recent')).map(r => r.batch + ':' + r.state).join(',')`)
  ok('recent checks persisted on device', recent.startsWith('AB1234:no_alert') && recent.includes('SR-13:flagged') && recent.includes('DEMO-RT1:retracted'), recent)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', text: '/' }); await wait(200)
  ok('"/" focuses the batch input', (await js(`document.activeElement?.id`)) === 'batch')
  await js(`document.activeElement.blur()`)
  const before = await js(`document.documentElement.classList.contains('dark')`)
  await js(`document.querySelector('[aria-label="Toggle dark mode"]').click()`); await wait(400)
  ok('theme toggle switches dark mode', (await js(`document.documentElement.classList.contains('dark')`)) !== before)
  await js(`document.querySelector('[aria-label="Toggle dark mode"]').click()`); await wait(300)
  await js(`[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Clear')?.click()`); await wait(300)
  ok('clear recent checks shows empty state', (await body()).includes('No checks yet'))
  await clickHas('Guide') || await js(`document.querySelector('header button:nth-last-child(2)').click()`); await wait(800)
  ok('Guide button reopens onboarding', (await body()).includes('An eye on every batch'))

  // ---- Mobile, dark: no-alert
  await vp(390, 844, true); await fresh(true); await click('Skip'); await wait(600)
  await typeBatch('AB1234'); await js(`window.scrollTo(0, 0)`); await shot('mobile-dark-no-alert')
  ok('dark theme applied', await js(`document.documentElement.classList.contains('dark')`))
  await vp(360, 800, false); await send('Page.reload'); await wait(1500); await settle()
  ok('no horizontal overflow at 360', (await js(`document.documentElement.scrollWidth`)) <= 360)
  await typeBatch('SR-13')
  ok('share row fits on one line at 360 (Share and WhatsApp as named icon buttons)', await js(`(() => { const r = document.querySelector('section[data-state] [data-share-actions]'); if (!r) return false; const kids = [...r.children].filter(c => c.offsetParent); const tops = new Set(kids.map(c => Math.round(c.getBoundingClientRect().top))); return tops.size === 1 && kids.length >= 3 && !!r.querySelector('[data-whatsapp][aria-label="Share on WhatsApp"]') && kids.every(k => k.getBoundingClientRect().height >= 44) && r.getBoundingClientRect().right <= innerWidth })()`))
  await js(`document.querySelector('[data-share-actions]').scrollIntoView({ block: 'center' })`); await shot('mobile-360-share-row')
  await typeBatch('AB1234')
  ok('360: no-alert action bar is one toolbar on one line (Save, Share, WhatsApp), every action named and 44px', await js(`(() => { const r = document.querySelector('section[data-state="no_alert"] [data-share-actions]'); if (!r || r.getAttribute('role') !== 'group') return false; const kids = [...r.children].filter(c => c.offsetParent); const tops = new Set(kids.map(c => Math.round(c.getBoundingClientRect().top))); return tops.size === 1 && kids.length === 3 && kids.every(k => k.getBoundingClientRect().height >= 44 && (k.getAttribute('aria-label') || k.textContent.trim())) && r.getBoundingClientRect().right <= innerWidth - 16 && document.documentElement.scrollWidth <= 360 })()`))
  await typeBatch('SR-13')
  await clickHas('How do we know'); await wait(900)
  ok('proof drawer fits 360 without horizontal scroll', (await js(`(() => { const d = document.querySelector('[role="dialog"]'); return !!d && d.scrollWidth <= d.clientWidth + 1 })()`)))
  await shot('mobile-360-proof'); await escape()
  await vp(430, 932, false); await send('Page.reload'); await wait(1500); await settle()
  ok('no horizontal overflow at 430', (await js(`document.documentElement.scrollWidth`)) <= 430)

  // ---- Reduced motion: loading card animations are off
  await vp(390, 844, false, true); await send('Page.reload'); await wait(1500); await settle()
  await send('Network.emulateNetworkConditions', { offline: false, latency: 600, downloadThroughput: -1, uploadThroughput: -1 })
  await js(`window.__anim = null; new MutationObserver(() => { const s = document.querySelector('section[aria-busy="true"] [data-spinner]'); const m = document.querySelector('section[aria-busy="true"] [data-loader-mark]'); if (s && window.__anim === null) window.__anim = [getComputedStyle(s).animationName, m ? getComputedStyle(m).animationName : 'none'].every((a) => a === 'none') ? 'none' : 'running' }).observe(document.body, { subtree: true, childList: true })`)
  await js(`(() => { const i = document.getElementById('batch'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'XY-9'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
  await waitIdle()
  ok('reduced motion: spinner animation disabled', (await js(`window.__anim`)) === 'none', String(await js(`window.__anim`)))
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })

  // ---- Arkiv request budget: a page load must not flood the public RPC (it rate-limits with 429).
  await vp(1440, 1000, false); await fresh()
  const rpcBefore = requests.filter(u => u.startsWith(ARKIV_RPC)).length
  await send('Page.reload'); await wait(6000)
  const rpcLoad = requests.filter(u => u.startsWith(ARKIV_RPC)).length - rpcBefore
  ok('page load sends at most 4 requests to the Arkiv RPC', rpcLoad >= 1 && rpcLoad <= 4, String(rpcLoad))

  // ---- Desktop
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  ok('status pill desktop text: Offline · demo data', (await js(`document.querySelector('[data-status]')?.innerText`)) === 'Offline · demo data')
  await shot('desktop-home')
  await typeBatch('SR-13'); await js(`window.scrollTo(0, 330)`); await shot('desktop-flagged')
  await vp(1440, 1000, true); await fresh(true); await click('Skip'); await wait(600); await shot('desktop-dark-home')

  // ---- Feed (fallback: demo data)
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  ok('feed: nav link routes client-side (no reload)', await openFeed())
  ok('feed: URL is /feed and nav marks Alerts current', (await js(`location.pathname`)) === '/feed' && (await js(`[...document.querySelectorAll('nav a[aria-current="page"]')].some(a => a.dataset.label === 'Alerts')`)))
  ok('feed: loads demo alerts, labelled Demo data', (await feedRows()) === 3 && (await js(`document.querySelector('[data-feed]').dataset.feedSource`)) === 'demo' && (await feedCount()).startsWith('3 alerts') && (await body()).includes('Demo data: the Nazar API and Arkiv could not answer'))
  ok('feed: retracted demo alert is not in the feed', !(await rowTexts()).some(t => t.includes('DEMO-RT1')))
  ok('feed: no Load more at the end of demo data', (await body()).includes('End of the feed') && !(await body()).includes('Load more alerts'))
  await waitFor(`!document.querySelector('[data-feed-pulse-loading]')`, 8000)
  ok('feed pulse: with no snapshot it is left out quietly (no empty chart)', !(await js(`!!document.querySelector('[data-feed-pulse], [data-feed-pulse-loading]')`)))
  await shot('feed-desktop')
  await pick('feed-state', 'IN-TN')
  ok('feed: Made in Tamil Nadu narrows to COLDRIF', (await feedRows()) === 1 && (await rowTexts())[0].includes('COLDRIF') && (await rowTexts())[0].includes('Made in Tamil Nadu') && (await js(`location.search`)) === '?state=IN-TN')
  await pick('feed-source', 'mh-fda')
  ok('feed: no match shows an empty state, not "no alert"', (await feedRows()) === 0 && (await body()).includes('No alerts match these filters'))
  await press('Reset filters')
  ok('feed: reset filters restores all alerts', (await feedRows()) === 3 && (await js(`location.search`)) === '')
  await press('Child Shield only')
  ok('feed: Child Shield toggle is pressed and keeps the paediatric syrups', (await js(`[...document.querySelectorAll('button[aria-pressed="true"]')].some(b => b.textContent.includes('Child Shield only'))`)) && (await feedRows()) === 3 && (await js(`location.search`)) === '?peds=1')
  await press('Child Shield only')
  await js(`document.querySelector('[data-alert-row]').click()`); await wait(700)
  ok('feed: opening an alert shows the result card inline', (await js(`document.querySelector('[data-alert-row]').getAttribute('aria-expanded')`)) === 'true' && (await js(`document.querySelector('[data-feed] section[data-state="flagged"] [data-source]')?.dataset.source`)) === 'demo')
  await shot('feed-desktop-open')
  await js(`[...document.querySelectorAll('[data-feed] button')].find(b => b.textContent.includes('How do we know'))?.click()`); await wait(900)
  let fp = await proofText()
  ok('feed: proof sheet opens from a feed alert', fp.includes('Source SHA-256') && fp.includes('World Health Organization') && fp.includes('Medical Product Alert N°5/2025'))
  await escape()
  ok('feed: no horizontal overflow at 1440', (await js(`document.documentElement.scrollWidth`)) <= 1440)
  await vp(1440, 1000, true); await fresh(true); await click('Skip'); await openFeed(); await shot('feed-desktop-dark')
  await vp(360, 800, false); await js(`localStorage.setItem('theme', 'light')`); await send('Page.navigate', { url: URL + 'feed?state=IN-GJ' }); await wait(1500); await feedIdle()
  ok('feed: deep link /feed?state=IN-GJ applies the filter', (await feedRows()) === 2 && (await js(`document.getElementById('feed-state').value`)) === 'IN-GJ')
  ok('feed: no horizontal overflow at 360', (await js(`document.documentElement.scrollWidth`)) <= 360)
  const minTarget = await js(`Math.min(...[...document.querySelectorAll('[data-alert-row], section[aria-label="Filter alerts"] button, section[aria-label="Filter alerts"] select')].map(b => Math.round(b.getBoundingClientRect().height)))`)
  ok('feed: rows and filters are at least 44px tall at 360', minTarget >= 44, String(minTarget))
  await press('Reset filters'); await shot('feed-360')
  await js(`document.querySelector('[data-alert-row]').click()`); await wait(700)
  ok('feed: open alert fits 360', (await js(`document.documentElement.scrollWidth`)) <= 360)
  await js(`document.querySelector('[data-feed] section[data-state]').scrollIntoView({block:'start'}); window.scrollBy(0,-12)`); await shot('feed-360-open')
  await vp(360, 800, true); await js(`localStorage.setItem('theme', 'dark')`); await send('Page.reload'); await wait(1500); await feedIdle(); await shot('feed-360-dark')
  const backSpa = await navTo('Check')
  ok('feed: Check tab link returns to the checker', backSpa && (await js(`location.pathname`)) === '/' && (await js(`!!document.getElementById('batch')`)), `${backSpa} ${await js('location.pathname')}`)
}

// ==== Cabinet, More and navigation (fallback: demo data answers every check) ====
if (MODE === 'fallback') {
  const PUB = process.env.E2E_PUBLISHER || '0x000000000000000000000000000000000000dEaD'
  const items = () => js(`[...document.querySelectorAll('[data-cabinet-item]')].map(li => li.dataset.batch)`)
  const stored = () => js(`JSON.parse(localStorage.getItem('nazar:cabinet') || '[]')`)
  const itemState = b => js(`document.querySelector('[data-cabinet-item][data-batch="${b}"] [data-cabinet-state]')?.dataset.cabinetState || ''`)
  const itemText = b => js(`document.querySelector('[data-cabinet-item][data-batch="${b}"]')?.textContent || ''`)
  const cabinetIdle = () => waitFor(`!document.querySelector('[data-cabinet-state="pending"]') && ![...document.querySelectorAll('button')].some(b => b.getAttribute('aria-busy') === 'true' && b.textContent.includes('Checking'))`, 30000)
  const formOpen = () => js(`!!document.querySelector('[data-cabinet-form]')`)
  /** "Add a medicine" opens a chooser (photo, upload, type) first; the typed-form tests take "Type it in". */
  const typeIt = async () => { if (await js(`!!document.querySelector('[data-add-type]')`)) { await js(`document.querySelector('[data-add-type]').click()`); await wait(300) } }
  const fill = async (f) => { await typeIt(); await js(`(() => { const ins = [...document.querySelectorAll('[data-cabinet-form] input')]; const v = ${JSON.stringify(f)}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; [['name',0],['batch',1],['expiry',2],['note',3]].forEach(([k,i]) => { if (v[k] === undefined) return; set.call(ins[i], v[k]); ins[i].dispatchEvent(new Event('input', { bubbles: true })) }) })()`); await wait(100) }
  const submit = async () => { await typeIt(); await js(`document.querySelector('[data-cabinet-form] button[type="submit"]').click()`); await wait(500) }
  const ym = (offsetMonths) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offsetMonths); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
  /** Toasts sit over the header; screenshots wait for them to leave. */
  const noToasts = () => waitFor(`!document.querySelector('[data-sonner-toast]')`, 8000)

  // ---- Navigation: Cabinet and More are real routes (desktop)
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  ok('nav: My cabinet link routes client-side', await navTo('My cabinet'))
  ok('nav: /cabinet with My cabinet marked current', (await js(`location.pathname`)) === '/cabinet' && (await js(`[...document.querySelectorAll('nav[aria-label="Main navigation"] a[aria-current="page"]')].map(a => a.dataset.label).join()`)) === 'My cabinet')
  ok('nav: no "coming soon" toast any more', !(await body()).includes('coming in the next build'))

  // ---- Cabinet: empty state, validation, add
  ok('cabinet: empty state with ring motif and SR-13 hint', await js(`!!document.querySelector('[data-cabinet-empty] svg circle')`) && (await body()).includes('Your cabinet is empty') && (await js(`[...document.querySelectorAll('[data-cabinet-empty] button')].some(b => b.textContent.replace(/\\s+/g, ' ').trim() === 'Try adding SR-13')`)))
  ok('cabinet: says it is private and never sent to a server', (await body()).includes('never sent to any server'))
  await click('Add a medicine'); await wait(500)
  ok('cabinet: Add offers a photo, an upload or typing; "Type it in" opens the form', (await js(`[...document.querySelectorAll('[data-cabinet-choose] button')].map(b => b.textContent.trim()).join('|')`)) === 'Take a photo of the packNazar reads the name, batch and expiry for you|Upload a photo|Type it in' && !(await formOpen()) && (await typeIt(), await formOpen()) && (await js(`document.activeElement?.closest('[data-field]')?.dataset.field`)) === 'name')
  await submit()
  ok('cabinet: empty form shows name and batch errors', (await js(`document.querySelectorAll('[data-cabinet-form] [aria-invalid="true"]').length`)) === 2 && await formOpen())
  await fill({ name: 'Bad batch', batch: 'AB#12' }); await submit()
  ok('cabinet: batch shape is validated like Check', (await js(`document.querySelector('[data-cabinet-form]')?.innerText || ''`)).includes('letters, digits and - / . ( ) only') && (await stored()).length === 0)
  await escape()
  await clickHas('Try adding'); await wait(500)
  ok('cabinet: "Try adding SR-13" pre-fills the form', (await js(`[...document.querySelectorAll('[data-cabinet-form] input')].slice(0, 2).map(i => i.value).join('|')`)) === 'COLDRIF syrup|SR-13')
  await submit(); await cabinetIdle(); await wait(300)
  ok('cabinet: SR-13 saved and re-checked as Flagged', (await items()).join() === 'SR-13' && (await itemState('SR-13')) === 'flagged')
  ok('cabinet: item shows last checked + answering source', /Last checked just now/.test(await itemText('SR-13')) && (await js(`document.querySelector('[data-cabinet-item] [data-source]')?.dataset.source`)) === 'demo')
  await click('Add a medicine'); await wait(400); await fill({ name: "Dad's BP tablets", batch: 'ab1234', expiry: ym(-3), note: 'for Dad' }); await submit(); await cabinetIdle()
  await click('Add a medicine'); await wait(400); await fill({ name: 'Kids syrup', batch: 'XY-9', expiry: ym(1), note: "kids' syrup" }); await submit(); await cabinetIdle()
  await click('Add a medicine'); await wait(400); await fill({ name: 'Duplicate', batch: 'sr 13' }); await submit()
  ok('cabinet: duplicate batch is refused', (await js(`document.querySelector('[data-cabinet-form]')?.innerText || ''`)).includes('already in your cabinet'))
  await escape()
  ok('cabinet: three items, flagged floats to the top', (await items()).join() === 'SR-13,XY-9,AB1234', (await items()).join())
  ok('cabinet: batch normalised to upper case', (await stored()).some(i => i.batch === 'AB1234' && i.note === 'for Dad'))
  ok('cabinet: no-alert item uses the slate badge', (await itemState('AB1234')) === 'no_alert' && (await itemText('AB1234')).includes('No alert found'))
  ok("cabinet: past expiry shows \"Expired – don't use\"", (await js(`document.querySelector('[data-batch="AB1234"] [data-expiry]')?.dataset.expiry`)) === 'expired' && (await itemText('AB1234')).includes("Expired – don't use"))
  ok('cabinet: expiry within 60 days shows "Expires soon"', (await js(`document.querySelector('[data-batch="XY-9"] [data-expiry]')?.dataset.expiry`)) === 'soon' && (await itemText('XY-9')).includes('Expires soon'))
  ok('cabinet: SR-13 has no expiry label', !(await js(`!!document.querySelector('[data-batch="SR-13"] [data-expiry]')`)))
  ok('cabinet: red banner summarises the flagged medicine', (await js(`document.querySelector('[data-cabinet-banner]')?.innerText || ''`)).includes('1 medicine in your cabinet has an official alert'))
  const greenCab = await js(`[...document.querySelectorAll('[data-batch="AB1234"], [data-batch="AB1234"] *')].some(n => { const c = getComputedStyle(n); return [c.color, c.backgroundColor].some(v => { const m = v.match(/\\d+(\\.\\d+)?/g); if (!m) return false; const [r,g,b] = m.map(Number); return g > r + 40 && g > b + 40 }) })`)
  ok('cabinet: no-alert item uses no green', greenCab === false)
  await vp(1440, 1000, false); await js(`window.scrollTo(0, 0)`); await noToasts(); await shot('cabinet-desktop')
  await click('Review alert'); await wait(800)
  ok('cabinet: Review opens the full flagged result card', (await js(`document.querySelector('[data-batch="SR-13"] section[data-state="flagged"]')?.innerText || ''`)).includes('This batch failed a government quality test'))
  ok('cabinet: result card inside the cabinet has no Save button', !(await js(`!!document.querySelector('[data-batch="SR-13"] [data-save-cabinet]')`)))
  await js(`[...document.querySelectorAll('[data-batch="SR-13"] button')].find(b => b.textContent.includes('How do we know'))?.click()`); await wait(900)
  ok('cabinet: proof sheet opens from a cabinet item', (await proofText()).includes('Source SHA-256') && (await proofText()).includes('World Health Organization'))
  await escape()

  // Re-check all: sequential, updates every item's last-checked time.
  const before = (await stored()).map(i => i.last?.at || 0)
  await wait(1100)
  await click('Re-check all'); await wait(150)
  const busyRe = await js(`[...document.querySelectorAll('button')].some(b => b.getAttribute('aria-busy') === 'true' && b.textContent.includes('Checking'))`)
  await cabinetIdle(); await waitFor(`![...document.querySelectorAll('button')].some(b => b.getAttribute('aria-busy') === 'true')`, 20000); await wait(300)
  const after = (await stored()).map(i => i.last?.at || 0)
  ok('cabinet: Re-check all runs (busy) and refreshes every item', busyRe && after.length === 3 && after.every((t, i) => t > before[i]), `${busyRe} ${before} → ${after}`)
  ok('cabinet: Re-check all confirms with a toast', (await body()).includes('Re-checked 3 medicines'))

  // Persist across reload, then export.
  await send('Page.reload'); await wait(1500); await cabinetIdle(); await wait(400)
  ok('cabinet: persists across reload', (await items()).join() === 'SR-13,XY-9,AB1234' && (await itemState('SR-13')) === 'flagged')
  { // fcfix: the shelf, the flagged alert and the list replace one fixed placeholder, so reading localStorage moves nothing already painted.
    const cabCls = await js(`new Promise(r => { let v = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) v += e.value }).observe({ type: 'layout-shift', buffered: true }); setTimeout(() => r(v), 400) })`)
    ok('cabinet: hard reload with saved medicines has CLS < 0.05 at 1440', cabCls < 0.05, cabCls.toFixed(4))
  }
  await js(`window.__blobs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { window.__blobs.push(b); return o(b) }`)
  await click('Export'); await wait(400)
  const exported = await js(`window.__blobs[0]?.text()`)
  let parsed = null; try { parsed = JSON.parse(exported) } catch {}
  ok('cabinet: export downloads a JSON file with every item', !!parsed && parsed.kind === 'cabinet' && parsed.items.length === 3 && parsed.items.some(i => i.name === "Dad's BP tablets" && i.expiry === ym(-3)))

  // Remove with undo, then remove for real.
  await js(`document.querySelector('[data-batch="XY-9"] button[aria-expanded]').click()`); await wait(500)
  await js(`[...document.querySelectorAll('[data-batch="XY-9"] button')].find(b => b.textContent.trim() === 'Remove').click()`); await wait(600)
  ok('cabinet: Remove takes the item out', (await items()).join() === 'SR-13,AB1234')
  await js(`[...document.querySelectorAll('[data-sonner-toast] button')].find(b => b.textContent.trim() === 'Undo')?.click()`); await wait(600)
  ok('cabinet: Undo puts it back', (await items()).length === 3 && (await stored()).length === 3)
  await js(`document.querySelector('[data-batch="XY-9"] button[aria-expanded]').click()`); await wait(400)
  await js(`[...document.querySelectorAll('[data-batch="XY-9"] button')].find(b => b.textContent.trim() === 'Edit').click()`); await wait(500)
  ok('cabinet: Edit pre-fills the item', (await js(`[...document.querySelectorAll('[data-cabinet-form] input')].map(i => i.value).join('|')`)) === `Kids syrup|XY-9|${ym(1)}|kids' syrup`)
  await fill({ name: 'Kids cough syrup' }); await submit(); await cabinetIdle()
  ok('cabinet: Edit saves the change', (await stored()).some(i => i.name === 'Kids cough syrup' && i.batch === 'XY-9'))

  // Import round trip: empty the cabinet, import the exported file.
  const file = `${OUT}/cabinet-export.json`; fs.writeFileSync(file, exported)
  await js(`localStorage.setItem('nazar:cabinet', '[]')`); await send('Page.reload'); await wait(1500)
  ok('cabinet: emptied before import', (await body()).includes('Your cabinet is empty'))
  const doc = await send('DOM.getDocument', { depth: -1 })
  const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '[data-cabinet-import]' })
  await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [file] }); await wait(800); await cabinetIdle(); await wait(300)
  ok('cabinet: import restores every item (round trip)', (await items()).join() === 'SR-13,XY-9,AB1234' && (await stored()).some(i => i.note === 'for Dad') && (await body()).includes('3 medicines added'))
  ok('cabinet: flagged state is re-checked after import', (await itemState('SR-13')) === 'flagged')
  ok('cabinet: no horizontal overflow at 1440', (await js(`document.documentElement.scrollWidth`)) <= 1440)

  // ---- Save to cabinet from Check and Feed
  await navTo('Check'); await wait(300)
  await typeBatch('LSL25160')
  ok('check: result card offers Save to cabinet', await js(`!!document.querySelector('section[data-state="flagged"] [data-save-cabinet]')`))
  await js(`document.querySelector('[data-save-cabinet]').click()`); await wait(500)
  ok('check: Save pre-fills batch + product name', (await js(`[...document.querySelectorAll('[data-cabinet-form] input')].slice(0, 2).map(i => i.value).join('|')`)) === 'ReLife|LSL25160')
  await submit()
  ok('check: saved item appears in the cabinet store', (await stored()).some(i => i.batch === 'LSL25160' && i.name === 'ReLife'))
  ok('check: card now says it is in the cabinet', await js(`!!document.querySelector('section[data-state] a[href="/cabinet"]')`))
  await typeBatch('!!')
  ok("check: no Save action on a can't-tell result", !(await js(`!!document.querySelector('[data-save-cabinet]')`)))
  await openFeed()
  await js(`[...document.querySelectorAll('[data-alert-row]')].find(b => b.innerText.includes('R01GL2523'))?.click()`); await wait(800)
  ok('feed: open alert offers Save to cabinet', await js(`!!document.querySelector('[data-feed] section[data-state] [data-save-cabinet]')`))
  await js(`document.querySelector('[data-feed] [data-save-cabinet]').click()`); await wait(500)
  ok('feed: Save pre-fills the feed alert', (await js(`[...document.querySelectorAll('[data-cabinet-form] input')].slice(0, 2).map(i => i.value).join('|')`)) === 'Respifresh TR|R01GL2523')
  await escape()
  ok('fallback: demo result shows "Not yet on Arkiv" instead of fake proof', (await js(`document.querySelector('[data-feed] [data-onchain-proof]')?.dataset.onchainProof`)) === 'unpublished' && (await js(`document.querySelector('[data-feed] [data-onchain-proof]').innerText`)).includes('Not yet on Arkiv'))
  ok('feed: demo rows carry no Live on Arkiv badge', (await js(`document.querySelectorAll('[data-live-arkiv]').length`)) === 0)

  // ---- More
  ok('nav: How it works link routes client-side', await navTo('How it works'))
  ok('more: /more with How it works marked current', (await js(`location.pathname`)) === '/more' && (await js(`[...document.querySelectorAll('nav[aria-label="Main navigation"] a[aria-current="page"]')].map(a => a.dataset.label).join()`)) === 'How it works')
  ok('more: renders every section', (await js(`[...document.querySelectorAll('[data-more-section]')].map(s => s.id).join()`)) === 'how,sources,proof,mcp,privacy,settings,about')
  const mb = await body()
  ok('more: How it works tells one alert in six chapters, in order', (await js(`[...document.querySelectorAll('#how [data-chapter-title]')].map(h => h.textContent.trim()).join('|')`)) === 'A regulator publishes a notice|Nazar reads it|It becomes a case|It is written to Arkiv|You check your batch|Anyone can verify')
  ok('more: the story is COLDRIF SR-13 from WHO N°5/2025, with the four answers', ['COLDRIF', 'SR-13', 'Sresan Pharmaceutical', 'Medical Product Alert N°5/2025', '48.6%', 'Four honest answers', 'Flagged', 'Retracted', 'No alert found', "Can't tell"].every(t => mb.includes(t)))
  ok('more: desktop TOC links to every section', (await js(`[...document.querySelectorAll('nav[data-toc="rail"] a')].map(a => a.getAttribute('href')).join()`)) === '#how,#sources,#proof,#mcp,#privacy,#settings,#about' && (await js(`[...document.querySelectorAll('nav[data-toc="rail"] a')].every(a => !!document.getElementById(a.getAttribute('href').slice(1)))`)) && (await js(`!!document.querySelector('nav[data-toc="rail"]').offsetParent`)))
  await js(`(() => { const el = document.querySelector('[data-chapter="3"]'); const r = el.getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - innerHeight / 2) })()`); await wait(900)
  ok('more: the sticky stage follows the chapter on screen', (await js(`document.querySelector('[data-stage]')?.dataset.active`)) === '3' && (await js(`document.querySelectorAll('[data-stage] [data-lit="true"]').length`)) === 4)
  await js(`document.getElementById('sources').scrollIntoView({ block: 'start' })`); await wait(400)
  ok('more: TOC marks the section being read', (await js(`document.querySelector('nav[data-toc="rail"] a[aria-current]')?.getAttribute('href')`)) === '#sources')
  await waitFor(`document.querySelector('[data-sources-from]')?.dataset.sourcesFrom !== 'loading'`)
  ok('more: sources fall back to the built-in list', (await js(`document.querySelector('[data-sources-from]').dataset.sourcesFrom`)) === 'static' && (await js(`document.querySelectorAll('[data-source-row]').length`)) === 9)
  ok("more: About links to Pranshu's X (@pranshurastogii), GitHub, LinkedIn, YouTube, Medium and site, each opening in a new tab", await js(`(() => { const a = [...document.querySelectorAll('[data-about-author] a[data-social]')]; const x = a.find((e) => e.dataset.social === 'X'); return a.length === 6 && !!x && x.href === 'https://x.com/pranshurastogii' && x.innerText.includes('@pranshurastogii') && a.every((e) => e.target === '_blank' && e.rel.includes('noopener')) })()`))
  ok('more: hero counts sources it can read and invents no alert count offline', (await js(`document.querySelector('[data-stat="sources"] [data-stat-value]').innerText`)) === String(await js(`document.querySelectorAll('[data-source-row][data-enabled="true"]:not([data-source-row="curated"])').length`)) && !/\d/.test(await js(`document.querySelector('[data-stat="alerts"] [data-stat-value]').innerText`)))
  ok('more: disabled sources say why (Telangana, Karnataka, Kerala)', (await js(`['tg-dca','ka-dc','kl-dc'].every(id => { const r = document.querySelector('[data-source-row="' + id + '"]'); return r && r.dataset.enabled === 'false' && r.innerText.includes('Off') })`)) && (await js(`document.querySelector('[data-source-row="tg-dca"]').innerText`)).includes('outside India'))
  ok('more: each source links to its regulator', (await js(`document.querySelector('[data-source-row="tn-dc"] a').href`)) === 'https://drugscontrol.tn.gov.in/list_nsq_drugs.html')
  ok('more: publisher wallet shown with explorer link', (await js(`document.querySelector('[data-publisher]').innerText`)) === PUB && (await js(`document.querySelector('a[aria-label="Open publisher wallet in the Arkiv explorer"]').href`)) === `https://tiramisu.explorer.arkiv.network/address/${PUB}`)
  ok('more: project tag, entity lifetimes and schema link', mb.includes('nazar-in-batch-alerts') && mb.includes('20 minutes, renewed every 5') && mb.includes('5 years') && (await js(`[...document.querySelectorAll('a')].some(a => a.href === 'https://github.com/pranshurastogi/Nazar/blob/main/arkiv/schema.md')`)))
  await js(`window.__copied = []; navigator.clipboard.writeText = async t => { window.__copied.push(t) }`)
  await js(`document.querySelector('[aria-label="Copy publisher wallet"]').click()`); await wait(300)
  ok('more: copy wallet button copies the publisher', (await js(`window.__copied[0]`)) === PUB && (await body()).includes('Publisher wallet copied'))
  await js(`document.querySelector('[aria-label="Copy SDK query"]').click()`); await wait(200)
  ok('more: SDK snippet is copyable and pinned to project + publisher', (await js(`window.__copied[1] || ''`)).includes("eq('project', str('nazar-in-batch-alerts'))") && (await js(`window.__copied[1] || ''`)).includes(`.createdBy('${PUB}')`))
  ok('more: privacy says what stays and what is never collected', mb.includes('Stays on this device') && mb.includes('Never collected') && mb.includes('medicine cabinet'))
  ok('more: about credits, licence, GitHub and disclaimer', mb.includes('Pranshu Rastogi') && mb.includes('MIT licence') && (await js(`[...document.querySelectorAll('a')].some(a => a.href === 'https://github.com/pranshurastogi/Nazar')`)) && mb.includes('Nazar repeats what regulators publish. It does not test medicines and is not medical advice. If a medicine has harmed someone, contact a doctor.'))
  ok('more: never says safe', !/\bsafe\b/i.test(mb.replace(/not a safety certificate|never certifies a medicine as safe/gi, '')))
  await js(`document.querySelector('[data-theme-option="dark"]').click()`); await wait(400)
  ok('more: theme Dark applies dark mode', (await js(`document.documentElement.classList.contains('dark')`)) && (await js(`document.querySelector('[data-theme-option="dark"]').getAttribute('aria-checked')`)) === 'true')
  await js(`document.querySelector('[data-theme-option="light"]').click()`); await wait(400)
  ok('more: theme Light removes dark mode', !(await js(`document.documentElement.classList.contains('dark')`)))
  await js(`document.querySelector('[data-theme-option="system"]').click()`); await wait(300)
  ok('more: theme System is saved', (await js(`localStorage.getItem('theme')`)) === 'system')
  await js(`document.querySelector('[data-theme-option="light"]').click()`); await wait(300)
  await click('Replay the guide'); await wait(800)
  ok('more: Replay the guide opens onboarding at step 1', (await body()).includes('An eye on every batch'))
  await click('Skip'); await wait(600)
  ok('more: Clear recent checks is enabled when checks exist', await js(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Clear recent checks') && !b.disabled)`))
  await clickHas('Clear recent checks'); await wait(300)
  ok('more: Clear recent checks empties them', (await js(`localStorage.getItem('nazar:recent')`)) === null)
  const n = (await stored()).length
  await clickHas('Clear cabinet'); await wait(300)
  ok('more: Clear cabinet asks to confirm in the page', (await js(`!!document.querySelector('[role="group"][aria-label="Confirm clearing the cabinet"]')`)) && (await stored()).length === n && n > 0)
  await js(`[...document.querySelectorAll('[data-clear-cabinet] button')].find(b => b.textContent.trim() === 'Cancel').click()`); await wait(300)
  ok('more: Cancel keeps the cabinet', !(await js(`!!document.querySelector('[aria-label="Confirm clearing the cabinet"]')`)) && (await stored()).length === n)
  await clickHas('Clear cabinet'); await wait(300); await click('Yes, clear it'); await wait(400)
  ok('more: confirming clears the cabinet', (await stored()).length === 0 && (await js(`document.querySelector('[data-clear-cabinet]').innerText`)).includes('Empty.'))
  await noToasts(); await js(`window.scrollTo(0, 0)`); await shot('more-desktop')
  await js(`document.getElementById('proof').scrollIntoView({ block: 'start' })`); await shot('more-desktop-proof')

  // ---- AI assistant: /more#mcp is a short teaser now, the full guide lives at /ai
  const MCP = 'https://nazar-api-production.up.railway.app/mcp'
  const AI_FX = Object.fromEntries(['sr-13', '5r-13', 'ab1234'].map(k => [k, JSON.parse(fs.readFileSync(new globalThis.URL(`../components/nazar/ai/fixtures/check-${k}.json`, import.meta.url), 'utf8'))]))
  ok('shell: "Skip to content" is the first focusable element and targets main#content', (await js(`(() => { const a = document.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'); return a?.textContent.trim() + '|' + a?.getAttribute('href') + '|' + document.getElementById('content')?.tagName })()`)) === 'Skip to content|#content|MAIN')
  ok('more: the hero headline is the only h1 (the shell title is not a heading)', (await js(`[...document.querySelectorAll('h1')].map(h => h.id).join()`)) === 'more-hero-title')
  ok('ai nav: footer links to /ai', (await js(`document.querySelector('footer a[data-mcp-link]')?.getAttribute('href')`)) === '/ai')
  ok('ai nav: the desktop rail has AI assistant right after On-chain', (await js(`[...document.querySelectorAll('nav[aria-label="Main navigation"] a')].map(a => a.dataset.label).join()`)) === 'Check,Alerts,Shelf sweep,My cabinet,On-chain,AI assistant,How it works')
  ok('ai nav: no link still points at /more#mcp', !(await js(`[...document.querySelectorAll('a')].some(a => a.getAttribute('href') === '/more#mcp')`)))
  await send('Page.navigate', { url: new globalThis.URL('/more#mcp', URL).href }); await wait(1500)
  await waitFor(`!!document.getElementById('mcp-title')`)
  ok('more: an old /more#mcp link lands on the teaser, which points to /ai', (await js(`document.getElementById('mcp-title')?.innerText`)) === 'Use Nazar in your AI assistant' && (await js(`(() => { const r = document.getElementById('mcp').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 })()`)) && (await js(`document.querySelector('#mcp [data-mcp-endpoint]')?.innerText`)) === MCP && (await js(`document.querySelector('#mcp a[data-mcp-teaser-link]')?.getAttribute('href')`)) === '/ai')
  ok('more: the teaser is short (no setup tabs, code or tool list)', !(await js(`!!document.querySelector('#mcp [data-mcp-tab], #mcp pre, #mcp [data-mcp-tool]')`)))
  await js(`window.__spa = 1; document.querySelector('#mcp a[data-mcp-teaser-link]').click()`); await waitFor(`location.pathname === '/ai' && !!document.querySelector('[data-chat-demo]')`)
  ok('ai: the teaser opens /ai client-side, with AI assistant marked current', (await js(`location.pathname`)) === '/ai' && (await js(`window.__spa`)) === 1 && (await js(`[...document.querySelectorAll('nav[aria-label="Main navigation"] a[aria-current="page"]')].map(a => a.dataset.label).join()`)) === 'AI assistant')
  await send('Page.navigate', { url: new globalThis.URL('/ai', URL).href }); await wait(1500)
  ok('ai: titled "Nazar for AI assistants", one h1 with the serif accent', (await js(`document.title`)) === 'Nazar for AI assistants' && (await js(`[...document.querySelectorAll('h1')].map(h => h.textContent).join('|')`)) === 'Ask your AI about a batch, and get the regulator’s answer.')
  ok('ai: hero shows the endpoint and a Set it up link', (await js(`document.querySelector('[data-ai-hero] [data-mcp-endpoint]')?.innerText`)) === MCP && (await js(`document.querySelector('[data-ai-setup-cta]')?.getAttribute('href')`)) === '#setup' && (await js(`document.querySelector('[data-ai-lede]').innerText`)).includes('Claude, ChatGPT, Cursor, VS Code and other MCP clients'))
  ok('ai: sections in story order', (await js(`[...document.querySelectorAll('[data-ai-section]')].map(s => s.id).join()`)) === 'connect,setup,tools,rules,limits')
  // The chat demo: plays once it is on screen, from an empty chat to the answer, built from the real fixtures.
  const demo = sel => `document.querySelector('[data-chat-demo] ${sel}')`
  const demoDone = () => waitFor(`document.querySelector('[data-chat-demo]')?.dataset.phase === 'done'`, 20000)
  const reply = () => js(`${demo('[data-chat-reply]')}.innerText.trim()`)
  await js(`document.querySelector('[data-chat-demo]').scrollIntoView({ block: 'center' })`)
  const phases = new Set(); { const t = Date.now(); while (Date.now() - t < 20000) { const p = await js(`document.querySelector('[data-chat-demo]').dataset.phase`); phases.add(p); if (p === 'done') break; if (p === 'calling') phases.add('eye:' + await js(`${demo('[data-sentinel]')}.dataset.state`)); await wait(60) } }
  ok('ai demo: plays question → tool call (eye scanning) → reply', ['typing', 'calling', 'reply', 'done'].every(p => phases.has(p)) && phases.has('eye:scanning'), [...phases].join())
  const sr = AI_FX['sr-13'].structuredContent
  ok('ai demo: the person asks about SR-13 of Coldrif for their child', (await js(`${demo('[data-chat-question]')}.innerText`)) === 'Is batch SR-13 of Coldrif safe for my child?')
  ok('ai demo: tool-call chip shows check_batch with its arguments and the state', (await js(`${demo('[data-tool-call]')}.dataset.tool`)) === 'check_batch' && (await js(`${demo('[data-tool-args]')}.innerText`)) === '{ "batch": "SR-13" }' && (await js(`${demo('[data-tool-state]')}.innerText`)) === 'flagged')
  ok('ai demo: the tool result is the real server text', (await js(`${demo('[data-tool-result]')}.textContent`)) === AI_FX['sr-13'].content[0].text)
  const r1 = await reply(); const l1 = await js(`[...document.querySelectorAll('[data-chat-demo] [data-reply-link]')].map(a => a.href)`)
  ok('ai demo: reply opens "Flagged.", cites the regulator words, says not medical advice, never "safe"', r1.startsWith('Flagged. Batch SR-13 of COLDRIF is named in 2 official regulator alerts.') && r1.includes('Contaminated with diethylene glycol (DEG): 48.6% w/v') && r1.includes('Sresan Pharmaceutical') && r1.includes('not medical advice') && !/\bsafe\b/i.test(r1), r1.slice(0, 120))
  ok('ai demo: reply links the WHO notice and the Arkiv entity from the fixture', l1.length === 2 && sr.alerts.some(a => a.notice.url === l1[0] && /who\.int/.test(l1[0]) && a.arkiv.explorer === l1[1]) && (await js(`[...document.querySelectorAll('[data-chat-demo] [data-reply-link]')].every(a => a.target === '_blank' && a.rel.includes('noopener') && a.tabIndex === 0)`)))
  ok('ai demo: the sentinel eye turns red', (await js(`${demo('[data-sentinel]')}.dataset.state`)) === 'flagged')
  await js(`document.querySelector('[data-chat-tab="unreadable"]').click()`); await wait(150); await demoDone()
  const r2 = await reply()
  ok("ai demo: the look-alike 5R-13 is Can't tell, never a flag (amber eye, real text)", (await js(`document.querySelector('[data-chat-tab="unreadable"]').getAttribute('aria-selected')`)) === 'true' && (await js(`${demo('[data-tool-state]')}.innerText`)) === 'unreadable' && (await js(`${demo('[data-tool-result]')}.textContent`)) === AI_FX['5r-13'].content[0].text && r2.startsWith('Can’t tell.') && r2.includes('SR-13') && r2.includes('never a flag') && !/\bflagged\b/i.test(r2) && (await js(`${demo('[data-sentinel]')}.dataset.state`)) === 'unreadable' && !/\bsafe\b/i.test(r2), r2.slice(0, 100))
  await js(`document.querySelector('[data-chat-tab="unreadable"]').focus()`); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await wait(150)
  ok('ai demo: arrow keys move between the example tabs', (await js(`document.activeElement?.dataset.chatTab`)) === 'no_alert' && (await js(`document.querySelector('[data-chat-demo]').dataset.scenario`)) === 'no_alert')
  await demoDone()
  const r3 = await reply()
  const demoGreen = await js(`(() => { const x = document.createElement('canvas').getContext('2d'); const rgb = v => { x.clearRect(0, 0, 1, 1); x.fillStyle = '#000'; x.fillStyle = v; x.fillRect(0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data }; const el = document.querySelector('[data-chat-demo]'); return [el, ...el.querySelectorAll('*')].some(n => { const c = getComputedStyle(n); return [c.color, c.backgroundColor, c.borderTopColor].some(v => { const [r, g, b, a] = rgb(v); return a > 0 && g > r + 40 && g > b + 40 }) }) })()`)
  ok('ai demo: AB1234 is No alert found in slate, "not a safety certificate", nothing green', (await js(`${demo('[data-tool-state]')}.innerText`)) === 'no_alert' && (await js(`${demo('[data-tool-result]')}.textContent`)) === AI_FX['ab1234'].content[0].text && r3.startsWith('No alert found.') && r3.includes('not a safety certificate') && r3.includes('IST') && (await js(`${demo('[data-sentinel]')}.dataset.state`)) === 'no_alert' && demoGreen === false && !/\bsafe\b/i.test(r3.replace(/not a safety certificate/gi, '')), r3.slice(0, 100))
  await js(`document.querySelector('[data-demo-replay]').click()`); await wait(250)
  ok('ai demo: Replay starts the conversation again', (await js(`document.querySelector('[data-chat-demo]').dataset.phase`)) !== 'done' && (await demoDone()))
  // Setup: tabs copy the right strings.
  await js(`window.__copied = []; navigator.clipboard.writeText = async t => { window.__copied.push(t) }`)
  const copyBtn = async label => { await js(`document.querySelector('[aria-label="Copy ${label}"]').click()`); await wait(150); return js(`window.__copied.at(-1) || ''`) }
  ok('ai setup: the hero copies the endpoint', (await copyBtn('MCP endpoint')) === MCP)
  ok('ai setup: Claude Code tab copies the command', (await copyBtn('Claude Code command')) === `claude mcp add --transport http nazar ${MCP}`)
  const tabTo = async id => { await js(`document.querySelector('[data-mcp-tab="${id}"]').click()`); await wait(150); return js(`[...document.querySelectorAll('[data-mcp-panel]')].filter(p => !p.hidden).map(p => p.dataset.mcpPanel).join()`) }
  ok('ai setup: .mcp.json tab copies a project file with an http server', (await tabTo('mcp-json')) === 'mcp-json' && (j => j.mcpServers?.nazar?.type === 'http' && j.mcpServers.nazar.url === MCP)(JSON.parse(await copyBtn('.mcp.json config'))))
  ok('ai setup: Cursor tab copies its config', (await tabTo('cursor')) === 'cursor' && JSON.parse(await copyBtn('Cursor config')).mcpServers?.nazar?.url === MCP)
  ok('ai setup: VS Code tab copies its config', (await tabTo('vscode')) === 'vscode' && (j => j.servers?.nazar?.type === 'http' && j.servers.nazar.url === MCP)(JSON.parse(await copyBtn('VS Code config'))))
  ok('ai setup: Claude & ChatGPT tab gives connector steps with no auth', (await tabTo('apps')) === 'apps' && (await js(`document.getElementById('mcp-panel-apps').innerText`)).includes('Add custom connector') && (await js(`document.getElementById('mcp-panel-apps').innerText`)).includes('no authentication'))
  ok('ai setup: the curl test is copyable and asks check_batch for SR-13', (c => c.startsWith(`curl -s ${MCP}`) && c.includes('"name":"check_batch"') && c.includes('"batch":"SR-13"'))(await copyBtn('curl test command')))
  const ts = await js(`document.querySelector('[data-mcp-troubleshooting]').innerText`)
  ok('ai setup: troubleshooting explains the 405 on GET and the rate limit', ts.includes('405') && ts.includes('60 tool calls a minute'))
  await tabTo('claude-code')
  // Tools, rules and limits.
  const toolCards = await js(`[...document.querySelectorAll('[data-mcp-tool]')].map(c => ({ name: c.dataset.mcpTool, q: c.querySelector('[data-tool-answers]')?.innerText || '', sample: c.querySelector('[data-tool-sample]')?.textContent || '' }))`)
  ok('ai tools: six cards in order, each with its question and a real example', toolCards.map(c => c.name).join() === 'check_batch,search_alerts,recent_alerts,get_case,list_sources,arkiv_proof' && toolCards.every(c => c.q.length > 10 && c.sample.length > 20) && toolCards[0].sample.startsWith('FLAGGED: batch SR-13') && toolCards[5].sample.startsWith('OFFICIAL:'))
  ok('ai tools: resources and the prompt', (await js(`[...document.querySelectorAll('[data-mcp-resource]')].map(r => r.dataset.mcpResource).join()`)) === 'nazar://about,nazar://schema' && (await js(`document.querySelector('[data-mcp-prompt]').innerText`)).includes('check_my_medicine'))
  const tp = await js(`document.querySelector('[data-trust-panel]').innerText`)
  ok('ai rules: trust panel with the four rules and the exact instructions', (await js(`document.querySelectorAll('[data-trust-rule]').length`)) === 4 && ['Four answers, reported as given', 'Never “safe”', 'A look-alike is never a flag', 'Cite the notice'].every(t => tp.includes(t)) && (await js(`document.querySelector('[data-instructions]').textContent`)).includes('never upgrade or soften it'))
  const lim = await js(`document.querySelector('[data-ai-limits]').innerText`)
  ok('ai limits: read-only, no personal data, salted IP hash, 60 a minute, no explainer', ['Read-only', 'No personal data', 'Batch numbers only', 'salted hash', '60 tool calls a minute', 'medicine explainer'].every(t => lim.includes(t)))
  await noToasts(); await js(`window.scrollTo(0, 0)`); await shot('ai-desktop')
  await js(`document.querySelector('[data-chat-demo]').scrollIntoView({ block: 'start' })`); await shot('ai-desktop-demo')

  // ---- 360px dark: nav reaches each route, no overflow; screenshots with flagged + expired + no-alert items
  await vp(360, 800, true); await js(`localStorage.setItem('theme', 'dark'); localStorage.setItem('nazar:cabinet', JSON.stringify(${JSON.stringify(parsed?.items ?? [])}))`)
  await send('Page.navigate', { url: URL }); await wait(1500); await settle()
  ok('360: Cabinet tab in the bottom nav', await navTo('Cabinet') && (await js(`location.pathname`)) === '/cabinet' && (await js(`[...document.querySelectorAll('nav[aria-label="Mobile navigation"] a[aria-current="page"]')].map(a => a.textContent.trim()).join()`)) === 'Cabinet')
  await cabinetIdle(); await wait(400)
  ok('360: cabinet fits without horizontal scroll', (await js(`document.documentElement.scrollWidth`)) <= 360)
  const minCab = await js(`Math.min(...[...document.querySelectorAll('[data-cabinet-item] button[aria-expanded], main > div button')].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().height)))`)
  ok('360: cabinet buttons are at least 44px tall', minCab >= 44, String(minCab))
  { // fcfix: on a phone the shelf is the index; the list keeps only what needs a look, plus "Show all".
    const shownCards = () => js(`[...document.querySelectorAll('[data-cabinet-item]')].filter(li => li.offsetParent).map(li => li.dataset.batch).join()`)
    const showAll = () => js(`[...document.querySelectorAll('[data-cabinet-showall] button')].find(b => b.offsetParent)?.textContent.trim() || ''`)
    ok('360: cabinet list collapses to the flagged card with "Show all 3 medicines"', (await js(`document.querySelector('[data-cabinet-list]')?.dataset.cabinetList`)) === 'short' && (await shownCards()) === 'SR-13' && (await showAll()) === 'Show all 3 medicines', `${await shownCards()} · ${await showAll()}`)
    await js(`[...document.querySelectorAll('[data-cabinet-showall] button')].find(b => b.offsetParent).click()`); await wait(400)
    ok('360: "Show all" lists every medicine', (await shownCards()) === 'SR-13,XY-9,AB1234' && (await js(`document.querySelector('[data-cabinet-showall] button').getAttribute('aria-expanded')`)) === 'true')
    await js(`document.querySelector('[data-cabinet-showall] button').click()`); await wait(300)
    await js(`document.querySelector('[data-shelf-batch="AB1234"] button').click()`); await wait(700)
    ok('360: tapping a hidden capsule opens its card in the short list', (await shownCards()) === 'SR-13,AB1234' && (await js(`document.querySelector('[data-batch="AB1234"] button[aria-expanded]')?.getAttribute('aria-expanded')`)) === 'true')
    await js(`document.querySelector('[data-batch="AB1234"] button[aria-expanded]').click()`); await wait(300)
  }
  await js(`window.scrollTo(0, 0)`); await shot('cabinet-360-dark')
  await js(`document.querySelector('[data-cabinet-banner]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -12)`); await shot('cabinet-360-dark-list')
  await click('Review alert'); await wait(900)
  ok('360: open flagged item fits', (await js(`document.documentElement.scrollWidth`)) <= 360)
  await shot('cabinet-360-dark-open')
  ok('360: More tab in the bottom nav', await navTo('More') && (await js(`location.pathname`)) === '/more')
  ok('360: More fits without horizontal scroll', (await js(`document.documentElement.scrollWidth`)) <= 360)
  ok('360: How it works is a stepper with each picture inline, and the TOC is a chip row', (await js(`[...document.querySelectorAll('[data-inline-scene]')].filter(e => e.offsetParent).length`)) === 6 && !(await js(`document.querySelector('[data-stage]')?.offsetParent ?? null`)) && (await js(`!!document.querySelector('nav[data-toc="chips"]').offsetParent && !document.querySelector('nav[data-toc="rail"]').offsetParent`)))
  await js(`window.scrollTo(0, 0)`); await shot('more-360-dark')
  await js(`document.getElementById('proof').scrollIntoView({ block: 'start' })`); await shot('more-360-dark-proof')
  await js(`document.getElementById('settings').scrollIntoView({ block: 'start' })`); await shot('more-360-dark-settings')
  await js(`document.getElementById('mcp').scrollIntoView({ block: 'start' })`); await shot('more-360-dark-mcp')
  ok('360: the AI assistant teaser fits', (await js(`document.documentElement.scrollWidth`)) <= 360 && (await js(`document.querySelector('[data-mcp-teaser]').getBoundingClientRect().right`)) <= 360)
  // /ai on a phone: AI is the fourth of five bottom-nav items; the page fits 360 and the demo still plays.
  const mobileNav = await js(`[...document.querySelectorAll('nav[aria-label="Mobile navigation"] a')].filter(a => a.offsetParent).map(a => { const r = a.getBoundingClientRect(); return a.textContent.trim() + ':' + Math.round(r.width) + 'x' + Math.round(r.height) })`)
  ok('360: bottom nav has five items, AI fourth, each at least 44px with a visible label', mobileNav.map(s => s.split(':')[0]).join() === 'Check,Alerts,Cabinet,AI,More' && mobileNav.every(s => s.split(':')[1].split('x').every(n => Number(n) >= 44)), mobileNav.join(' '))
  ok('360: AI tab in the bottom nav opens /ai', await navTo('AI') && (await js(`location.pathname`)) === '/ai' && (await js(`[...document.querySelectorAll('nav[aria-label="Mobile navigation"] a[aria-current="page"]')].map(a => a.textContent.trim()).join()`)) === 'AI')
  await wait(600)
  ok('360: /ai fits without horizontal scroll, code scrolls inside its box', (await js(`document.documentElement.scrollWidth`)) <= 360 && (await js(`[...document.querySelectorAll('[data-ai-page] pre')].filter(p => p.offsetParent).every(p => p.getBoundingClientRect().right <= 360)`)))
  await js(`window.scrollTo(0, 0)`); await shot('ai-360-dark')
  await js(`document.querySelector('[data-chat-demo]').scrollIntoView({ block: 'start' })`)
  ok('360: the chat demo plays to the answer and fits', (await waitFor(`document.querySelector('[data-chat-demo]')?.dataset.phase === 'done'`, 20000)) && (await js(`document.documentElement.scrollWidth`)) <= 360 && (await js(`(() => { const d = document.querySelector('[data-chat-demo]'); return d.scrollWidth <= d.clientWidth + 1 })()`)))
  await shot('ai-360-dark-demo')
  const aiTargets = await js(`Math.min(...[...document.querySelectorAll('[data-chat-tab], [data-demo-replay], [data-mcp-tab], [data-mcp-copy], [data-reply-link]')].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().height)))`)
  ok('360: /ai tabs, copy buttons and links are at least 44px tall', aiTargets >= 44, String(aiTargets))
  await js(`document.getElementById('setup').scrollIntoView({ block: 'start' })`); await shot('ai-360-dark-setup')
  ok('360: More tab returns to More, whose teaser still fits', await navTo('More') && (await js(`location.pathname`)) === '/more' && (await js(`document.documentElement.scrollWidth`)) <= 360)
  // Reduced motion: the finished conversation, still, with nothing left to reveal.
  await vp(360, 800, false, true); await send('Page.navigate', { url: new globalThis.URL('/ai', URL).href }); await wait(1500)
  ok('reduced motion: /ai shows the finished chat at once, every word visible, no moving parts', (await js(`document.querySelector('[data-chat-demo]')?.dataset.phase`)) === 'done' && (await js(`[...document.querySelectorAll('[data-chat-demo] .ai-word')].every(w => getComputedStyle(w).opacity === '1')`)) && !(await js(`!!document.querySelector('[data-chat-demo] .ai-caret, [data-chat-demo] .ai-dots')`)) && (await js(`[...document.querySelectorAll('.ai-link-dot')].every(d => getComputedStyle(d).display === 'none')`)) && (await js(`document.querySelector('[data-chat-demo] [data-sentinel]').dataset.state`)) === 'flagged')
  ok('reduced motion: /ai fits 360', (await js(`document.documentElement.scrollWidth`)) <= 360)
  await vp(360, 800, true)
  ok('360: Check tab returns home', await navTo('Check') && (await js(`location.pathname`)) === '/')
  await vp(360, 800, false, true); await js(`localStorage.setItem('theme', 'light')`); await send('Page.navigate', { url: URL + 'cabinet' }); await wait(1500); await cabinetIdle()
  ok('reduced motion: cabinet renders and settles', (await items()).length === 3)
  // ---- Cabinet shelf ("Your shelf, watched"): capsules mirror the list in honest colours, under the sentinel eye
  const shelf = () => js(`[...document.querySelectorAll('[data-shelf-item]')].map(li => li.dataset.shelfBatch + ':' + li.dataset.shelfState).join()`)
  const shelfGreen = () => js(`[...document.querySelectorAll('[data-shelf], [data-shelf] *')].some(n => { const c = getComputedStyle(n); return [c.color, c.backgroundColor, c.borderTopColor].some(v => { const m = v.match(/\\d+(\\.\\d+)?/g); if (!m || (m[3] !== undefined && Number(m[3]) === 0)) return false; const [r,g,b] = m.map(Number); return g > r + 40 && g > b + 40 }) })`)
  ok('shelf: reduced motion still shows every capsule with its state', (await shelf()) === 'SR-13:flagged,XY-9:no_alert,AB1234:no_alert', await shelf())
  await click('Re-check all'); await wait(200)
  ok('shelf: reduced motion runs a re-check with no beam and no glow pulse', (await js(`(() => { const b = document.querySelector('[data-shelf-beam]'); return !b || getComputedStyle(b).display === 'none' })()`)) && (await js(`getComputedStyle(document.querySelector('[data-shelf-state="flagged"] .cab-pill')).animationName`)) === 'none')
  await cabinetIdle(); await wait(300)
  ok('shelf: each capsule is a button labelled with name, batch and state', await js(`(() => { const f = document.querySelector('[data-shelf-batch="SR-13"] button')?.getAttribute('aria-label') || ''; const q = document.querySelector('[data-shelf-batch="AB1234"] button')?.getAttribute('aria-label') || ''; return f.startsWith('COLDRIF syrup, batch SR-13. Flagged') && /batch AB1234\\. No alert found\\. Expired/.test(q) })()`))
  ok('shelf: expired and expires-soon markers sit on their capsules', (await js(`document.querySelector('[data-shelf-batch="AB1234"] [data-shelf-expiry]')?.dataset.shelfExpiry`)) === 'expired' && (await js(`document.querySelector('[data-shelf-batch="XY-9"] [data-shelf-expiry]')?.dataset.shelfExpiry`)) === 'soon' && !(await js(`!!document.querySelector('[data-shelf-batch="SR-13"] [data-shelf-expiry]')`)))
  // A full shelf at 360 dark, normal motion: 13 items (two flagged), the page re-checks on load.
  const shelfItems = [['COLDRIF syrup', 'SR-13'], ['Respifresh TR', 'R01GL2523'], ['Sample tabs', 'DEMO-RT1'], ["Dad's BP tablets", 'AB1234'], ['Kids syrup', 'XY-9'], ['Vitamin D3', 'VD-2210'], ['Cetirizine 10', 'CTZ-88'], ['Pantoprazole 40', 'PNT40-77'], ['Metformin 500 SR', 'MF5-0921'], ['ORS sachets', 'ORS-117'], ['Azithromycin 250', 'AZ-2501'], ['Ibuprofen 400', 'IBU-4400'], ['Paracetamol 650', 'PCM-650']].map(([name, batch]) => ({ id: 'shelf-' + batch, name, batch, expiry: null, note: '', addedAt: 1, last: null }))
  await vp(360, 800, true); await js(`localStorage.setItem('theme', 'dark'); localStorage.setItem('nazar:cabinet', ${JSON.stringify(JSON.stringify(shelfItems))})`); await send('Page.reload')
  ok('shelf: a scan beam sweeps the shelf while the page re-checks', await waitFor(`(() => { const b = document.querySelector('[data-shelf-beam]'); return !!b && getComputedStyle(b).animationName === 'cab-sweep' })()`, 8000) && (await js(`document.querySelector('[data-shelf] [data-sentinel]')?.dataset.state`)) === 'scanning')
  await waitFor(`!document.querySelector('[data-shelf-beam]') && !document.querySelector('[data-shelf-state="pending"]')`, 60000); await wait(500)
  const shelfRows = await js(`new Set([...document.querySelectorAll('[data-shelf-item]')].map(li => Math.round(li.getBoundingClientRect().top))).size`)
  ok('shelf: 13 medicines sit as 13 capsules on rows of shelves', (await js(`document.querySelectorAll('[data-shelf-item]').length`)) === 13 && shelfRows >= 4, String(shelfRows))
  ok('shelf: flagged batches show the flagged state, first on the shelf', (await shelf()).startsWith('SR-13:flagged,R01GL2523:flagged,DEMO-RT1:retracted') && (await js(`document.querySelector('[data-shelf-summary]')?.dataset.shelfSummary`)) === 'flagged' && (await js(`document.querySelector('[data-shelf-counts]')?.innerText || ''`)).includes('2 flagged') && (await js(`document.querySelector('[data-shelf] [data-sentinel]')?.dataset.state`)) === 'flagged', await shelf())
  ok('shelf: no green anywhere on the shelf', (await shelfGreen()) === false)
  { // fcfix: idle cost. The eye pauses off-screen; flagged capsules glow three times, then rest.
    await js(`window.scrollTo(0, document.documentElement.scrollHeight)`); await wait(600)
    const off = await js(`(() => { const e = document.querySelector('[data-shelf] [data-sentinel]'); return e.hasAttribute('data-paused') + ':' + getComputedStyle(e.querySelector('.s-ring')).animationPlayState + ':' + getComputedStyle(e, '::before').animationPlayState })()`)
    await js(`window.scrollTo(0, 0)`); await wait(600)
    const on = await js(`document.querySelector('[data-shelf] [data-sentinel]').hasAttribute('data-paused')`)
    ok('sentinel: paused (data-paused, animations held) while off-screen, running again on screen', off === 'true:paused:paused' && on === false, `${off} → ${on}`)
    ok('shelf: the flagged glow runs 3 cycles, not forever', (await js(`getComputedStyle(document.querySelector('[data-shelf-state="flagged"] .cab-pill')).animationIterationCount`)) === '3')
  }
  ok('shelf: fits 360 with no horizontal scroll', (await js(`document.documentElement.scrollWidth`)) <= 360 && (await js(`(() => { const u = document.querySelector('[data-shelf] ul'); return u.scrollWidth <= u.clientWidth + 1 })()`)))
  await js(`document.querySelector('[data-shelf]').scrollIntoView({ block: 'start' }); window.scrollBy(0, -12)`); await shot('cabinet-360-dark-shelf')
  await js(`document.querySelector('[data-shelf-batch="R01GL2523"] button').click()`); await wait(900)
  ok('shelf: tapping a capsule opens its row in the list and moves focus there', (await js(`document.querySelector('[data-batch="R01GL2523"] button[aria-expanded]')?.getAttribute('aria-expanded')`)) === 'true' && (await js(`document.activeElement?.closest('[data-cabinet-item]')?.dataset.batch`)) === 'R01GL2523')
  // Every batch with no alert: a neutral slate line with the time, never "safe" or "all clear".
  await js(`localStorage.setItem('nazar:cabinet', ${JSON.stringify(JSON.stringify(shelfItems.slice(3, 5)))})`); await send('Page.reload'); await wait(800)
  await waitFor(`!!document.querySelector('[data-shelf]') && !document.querySelector('[data-shelf-beam]') && !document.querySelector('[data-shelf-state="pending"]')`, 20000); await wait(300)
  const quietText = await js(`document.querySelector('[data-shelf]')?.innerText || ''`)
  ok('shelf: all no-alert says "No alerts for these batches as of <time>", in slate, never safe', (await js(`document.querySelector('[data-shelf-summary]')?.dataset.shelfSummary`)) === 'no_alert' && /No alerts for these batches as of \d{1,2}:\d{2}\s?[ap]m/i.test(quietText) && quietText.includes('not a safety certificate') && !/\b(safe|genuine|approved|all clear)\b/i.test(quietText.replace(/not a safety (certificate|check)/gi, '')) && (await js(`document.querySelector('[data-shelf] [data-sentinel]')?.dataset.state`)) === 'no_alert' && (await shelfGreen()) === false, quietText.slice(0, 160))
  // Empty cabinet: an inviting empty shelf with one clear action and the privacy promise.
  await js(`localStorage.setItem('nazar:cabinet', '[]')`); await send('Page.reload'); await wait(1200)
  ok('shelf: empty cabinet shows an empty shelf, "Add your first medicine" and the on-device promise', (await js(`!!document.querySelector('[data-shelf-empty] [data-sentinel]')`)) && (await js(`!!document.querySelector('[data-shelf-add]')`)) && (await js(`document.querySelector('[data-shelf-privacy]')?.innerText || ''`)).includes('Saved only on this phone'))
  await js(`document.querySelector('[data-shelf-add]').click()`); await wait(500)
  ok('shelf: "Add your first medicine" opens the add chooser, photo first', (await js(`document.querySelector('[data-cabinet-choose] button')?.hasAttribute('data-add-camera-btn')`)) === true && (await typeIt(), await formOpen()))
  await escape()
  ok('shelf: empty shelf fits 360', (await js(`document.documentElement.scrollWidth`)) <= 360)
  await vp(1440, 900, false, true); await send('Page.navigate', { url: URL + 'more' }); await wait(1500)
  await js(`document.querySelector('[data-chapter="5"]').scrollIntoView({ block: 'center' })`); await wait(500)
  ok('reduced motion: How it works is static, with every chapter picture shown and nothing hidden', !(await js(`!!document.querySelector('[data-stage]')`)) && (await js(`[...document.querySelectorAll('[data-inline-scene]')].filter(e => e.offsetParent && getComputedStyle(e).opacity === '1').length`)) === 6 && (await js(`[...document.querySelectorAll('#how [data-chapter-title]')].filter(h => h.offsetParent).length`)) === 6)
  ok('reduced motion: More fits at 1440', (await js(`document.documentElement.scrollWidth`)) <= 1440)
  await vp(360, 800, false, true)
}
// ==== end Cabinet / More ====

if (MODE === 'mock' || MODE === 'live') {
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  const pill = await js(`document.querySelector('[data-status]')?.innerText`)
  ok('status pill reads the API heartbeat', (await js(`document.querySelector('[data-status]')?.dataset.status`)) === 'api' && (MODE === 'live' || /^Pipeline live · checked 4 min ago$/.test(pill)), pill)
  ok('active alerts come from the API', (await js(`document.querySelector('[aria-label="High-severity alerts"]')?.parentElement.querySelector('[data-source]')?.dataset.source`)) === 'api')
  if (MODE === 'mock') {
    ok('high-severity list shows API items, severity 4+ only', (await body()).includes('2 active') && (await body()).includes('Example Tabs') && !(await body()).includes('Low Severity Tabs'))
    ok('Child Shield uses peds filter', /1 active right now\./.test(await body()))
    globalThis.__noticesFrom = requests.length
  }
  await shot(`${MODE}-desktop-home`)
  await typeBatch('SR-13')
  ok('API answer labelled Live · Nazar API', (await js(`document.querySelector('section[data-state] [data-source]')?.innerText`)) === 'Live · Nazar API')
  if (MODE === 'mock') {
    ok('flagged from API', (await body()).includes('This batch failed a government quality test'))
    const proofCard = `document.querySelector('section[data-state="flagged"] [data-onchain-proof]')`
    ok('on-chain proof: card shows the chain of custody, live on Arkiv', (await js(`${proofCard}?.dataset.onchainProof`)) === 'published' && (await js(`[...${proofCard}.querySelectorAll('[data-chain-node]')].map(n => n.dataset.chainNode).join()`)) === 'document,sha,notice,alert' && (await js(`${proofCard}.innerText`)).includes('Live on Arkiv'))
    ok('on-chain proof: notice and alert entities link to the explorer', (await js(`${proofCard}.querySelector('a[aria-label="Open notice entity in the Arkiv explorer"]')?.href`)) === 'https://tiramisu.explorer.arkiv.network/entity/' + NOTICE_KEY && (await js(`${proofCard}.querySelector('a[aria-label="Open entity key in the Arkiv explorer"]')?.href`)) === 'https://tiramisu.explorer.arkiv.network/entity/' + KEY1)
    ok('on-chain proof: prominent transaction link', (await js(`${proofCard}.querySelector('[data-tx-link]')?.href`)) === 'https://tiramisu.explorer.arkiv.network/tx/' + TX && (await js(`${proofCard}.querySelector('[data-tx-link]').innerText`)).includes('View transaction on Arkiv explorer'))
    ok('on-chain proof: creator not equal to the configured publisher is not marked official', (await js(`${proofCard}.querySelector('[data-publisher-check]')?.dataset.publisherCheck`)) === 'unlisted' && (await js(`${proofCard}.innerText`)).includes('Not from a listed publisher'))
    ok('on-chain proof: entity flags shown as chips', (await js(`[...${proofCard}.querySelectorAll('[data-flag]')].map(f => f.innerText.trim()).join('|')`)) === 'Read-only|Anyone can keep alive')
    ok('on-chain proof: card shows no "Source SHA-256" label (sheet only)', !(await js(`${proofCard}.innerText`)).includes('Source SHA-256'))
    ok('timeline lists both notices, newest first', /2 notices name this batch/i.test(await body()) && (await js(`[...document.querySelectorAll('[aria-label="Notice timeline"] li')].map(l => l.innerText.split('\\n')[0]).join('|')`)) === 'World Health Organization|Tamil Nadu Drugs Control')
    await js(`document.querySelector('section[data-state]').scrollIntoView({block:'start'})`); await shot('mock-flagged-timeline')
    await clickHas('How do we know'); await wait(900)
    let p = await proofText()
    ok('proof: real entity key, shortened, with copy + explorer link', p.includes('0x8b1c…aa99') && (await js(`!!document.querySelector('[role="dialog"] [aria-label="Copy entity key"]')`)) && (await js(`document.querySelector('[role="dialog"] a[aria-label="Open entity key in the Arkiv explorer"]')?.href`)) === 'https://tiramisu.explorer.arkiv.network/entity/' + KEY1)
    ok('proof: creator wallet + tx explorer links', (await js(`document.querySelector('[role="dialog"] a[aria-label="Open creator wallet in the Arkiv explorer"]')?.href`)) === 'https://tiramisu.explorer.arkiv.network/address/' + WALLET && (await js(`document.querySelector('[role="dialog"] a[aria-label="Open transaction hash in the Arkiv explorer"]')?.href`)) === 'https://tiramisu.explorer.arkiv.network/tx/' + TX)
    ok('proof: extraction method + confidence', p.includes('PDF text layer · 97% confidence'))
    ok('proof: source document link + no demo note', (await js(`[...document.querySelectorAll('[role="dialog"] a')].find(a => a.textContent.includes('View source notice'))?.href`)) === 'https://example.org/notice.pdf' && !p.includes('Demo record'))
    await shot('mock-proof'); await escape()
    await js(`[...document.querySelectorAll('[aria-label="Notice timeline"] button')][1].click()`); await wait(900)
    p = await proofText()
    ok('timeline opens proof for the machine-read notice', p.includes('Tamil Nadu Drugs Control') && p.includes('Machine-read, awaiting pharmacist confirmation') && p.includes('OCR of a scanned page · 82% confidence'))
    await waitFor(`!!document.querySelector('[role="dialog"] [data-notice-key]')`, 5000)
    ok('proof sheet: notice entity key looked up by SHA (GET /v1/notices) when the alert DTO lacks it, shortened with an explorer link', (await js(`document.querySelector('[role="dialog"] [data-notice-key]')?.innerText || ''`)) === '0x5e1f…0ffe' && (await js(`document.querySelector('[role="dialog"] a[aria-label="Open notice entity in the Arkiv explorer"]')?.href`)) === 'https://tiramisu.explorer.arkiv.network/entity/' + NOTICE_KEY && !(await proofText()).includes('Linked inside the alert'))
    ok('proof sheet: creator equal to the configured publisher is "Official Nazar publisher"', (await js(`document.querySelector('[role="dialog"] [data-publisher-check]')?.dataset.publisherCheck`)) === 'official' && p.includes('Official Nazar publisher'))
    await shot('mock-proof-machine-read'); await escape()
    // ---- About this medicine: opt-in AI card, kept apart from (and after) the official verdict.
    const med = `document.querySelector('[data-medicine]')`
    ok('medicine: opt-in prompt below the verdict, nothing fetched until asked', (await js(`${med}?.dataset.medicine`)) === 'idle' && /general information/i.test(await js(`${med}.querySelector('[data-medicine-prompt]')?.innerText || ''`)) && (await js(`${med}.querySelector('[data-medicine-name]')?.innerText`)) === 'About COLDRIF' && mock.medicineBodies.length === 0, String(mock.medicineBodies.length))
    ok('medicine: verdict is labelled official and sits before the AI card, which is outside it', (await js(`document.querySelector('section[data-state] [data-official-label]')?.innerText || ''`)).toLowerCase().includes('official · from regulator notices, verified on arkiv') && (await js(`!!(document.querySelector('section[data-state]').compareDocumentPosition(${med}) & Node.DOCUMENT_POSITION_FOLLOWING) && !document.querySelector('section[data-state]').contains(${med})`)))
    ok('medicine: flagged result leads with the official alert before any info', (await js(`${med}.innerText`)).startsWith("This batch has an official alert – don't use it."))
    ok('medicine: AI label at the top of the card: an "AI-generated" badge and "Not from a regulator · may be wrong"', /AI-generated/i.test(await js(`${med}.querySelector('[data-medicine-ai-label]')?.innerText || ''`)) && (await js(`${med}.querySelector('[data-medicine-ai-label]')?.innerText || ''`)).includes('Not from a regulator · may be wrong') && /general information/i.test(await js(`${med}.getAttribute('aria-label') || ''`)))
    await js(`${med}.querySelector('[aria-label="Why this is marked AI-generated"]').click()`); await wait(200)
    ok('medicine: info button explains where the text comes from', (await js(`${med}.querySelector('[aria-label="Why this is marked AI-generated"]').getAttribute('aria-expanded')`)) === 'true' && (await js(`${med}.querySelector('[role="note"]')?.innerText || ''`)).includes('not part of any regulator notice'))
    await js(`${med}.querySelector('[aria-label="Why this is marked AI-generated"]').click()`)
    await js(`[...${med}.querySelectorAll('button')].find(b => b.textContent.includes('Show general information')).click()`)
    await waitFor(`!!document.querySelector('[data-medicine-card]')`, 8000); await wait(500)
    ok('medicine: opens with a height animation and ends fully open (wrapper fits the story cards, content opaque)', await js(`(() => { const a = document.querySelector('[data-medicine] [data-auto-height]'); const c = document.querySelector('[data-medicine-card]'); return !!a && a.dataset.autoHeight === 'rest' && Math.abs(a.getBoundingClientRect().height - a.firstElementChild.offsetHeight) <= 1 && getComputedStyle(c.parentElement).opacity === '1' && c.getBoundingClientRect().bottom <= document.querySelector('[data-medicine-footer]').getBoundingClientRect().top + 1 })()`))
    const medText = await js(`${med}.innerText`)
    const sent = JSON.parse(mock.medicineBodies[0] || '{}')
    ok('medicine: one request with the name and ingredients only', mock.medicineBodies.length === 1 && sent.product === 'COLDRIF' && Object.keys(sent).every(k => ['product', 'brand', 'composition', 'form', 'manufacturer', 'batch'].includes(k)), mock.medicineBodies[0])
    const storyIds = await js(`[...document.querySelectorAll('[data-medicine-stories] > li')].map(l => l.dataset.story).join()`)
    ok('medicine: 4–6 story cards, each with 1–4 bullets', storyIds === 'for,how,side,help,careful,store' && (await js(`[...document.querySelectorAll('[data-medicine-stories] > li')].every(l => { const n = l.querySelector(':scope > ul').children.length; return n >= 1 && n <= 4 })`)), storyIds)
    ok('medicine: header with generic names and Rx chip', medText.includes('COLDRIF syrup') && medText.includes('Paracetamol, Phenylephrine, Chlorpheniramine') && (await js(`document.querySelector('[data-medicine-rx]')?.innerText || ''`)).includes('Schedule H'))
    const nazarText = await js(`document.querySelector('[data-medicine-nazar]')?.innerText || ''`)
    ok('medicine: brand alert count is for the brand and links to the Feed', nazarText.includes('Nazar has 2 regulator alerts for COLDRIF') && (await js(`document.querySelector('[data-medicine-nazar] a')?.getAttribute('href')`)) === '/feed')
    ok('medicine: ingredient matches are counted apart and labelled as other products', /116 other alerts are for different products/.test(nazarText) && nazarText.includes('They are not about COLDRIF') && !/116 regulator alerts/.test(nazarText))
    ok('medicine: footer says not medical advice and AI-written', medText.includes('Not medical advice. Ask your doctor or pharmacist.') && medText.includes('Written by AI from general medical knowledge – may be incomplete.'))
    ok('medicine: card never says "safe"', !/\bsafe\b/i.test(medText))
    ok('medicine: story list is keyboard-focusable', (await js(`document.querySelector('[data-medicine-stories]').tabIndex`)) === 0)
    await js(`window.scrollTo(0, document.querySelector('[data-medicine]').getBoundingClientRect().top + scrollY - 260)`); await shot('medicine-desktop-light')
    await typeBatch('5R-13'); ok('API look-alike → Did you mean, not flagged', (await body()).includes('Did you mean') && !(await body()).includes('This batch failed'))
    await typeBatch('(N)25567'); ok('API: (N)25567 is sent to the API, not rejected as unreadable', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'no_alert' && requests.some(u => u.includes('/v1/check?batch=(N)25567') || u.includes('/v1/check?batch=%28N%2925567')))
    await typeBatch('ZZ-404'); ok('API no-alert labelled + not a safety certificate', (await body()).includes('This is not a safety certificate') && (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'api')
    { const n = requests.slice(globalThis.__noticesFrom).filter(u => u.includes('/v1/notices')).length; ok('network: GET /v1/notices is read once for a run of checks (session cache)', n === 1, String(n)) }
    await vp(360, 800, true); await fresh(true); await click('Skip'); await wait(600); await typeBatch('SR-13'); await js(`document.querySelector('section[data-state]').scrollIntoView({block:'start'})`)
    ok('mock: no horizontal overflow at 360 with timeline', (await js(`document.documentElement.scrollWidth`)) <= 360)
    ok('mock 360: on-chain proof is one line, "Live on Arkiv · View proof"', (await js(`document.querySelector('section[data-state] [data-proof-line]')?.dataset.proofLine`)) === 'published' && /Live on Arkiv\s*View proof/.test(await js(`document.querySelector('[data-proof-line]')?.innerText || ''`)))
    await shot('mock-mobile-dark-timeline')
    await clickHas('How do we know'); await wait(900)
    ok('mock: proof drawer fits 360', (await js(`(() => { const d = document.querySelector('[role="dialog"]'); return !!d && d.scrollWidth <= d.clientWidth + 1 })()`)))
    await shot('mock-mobile-dark-proof'); await escape()
    // About this medicine at 360, dark: swipeable stories, then the LLM_DISABLED path.
    await js(`[...document.querySelectorAll('[data-medicine] button')].find(b => b.textContent.includes('Show general information')).click()`)
    await waitFor(`!!document.querySelector('[data-medicine-card]')`, 8000); await wait(500)
    ok('medicine 360: no horizontal page overflow; stories scroll sideways', (await js(`document.documentElement.scrollWidth`)) <= 360 && (await js(`(() => { const l = document.querySelector('[data-medicine-stories]'); return l.scrollWidth > l.clientWidth })()`)))
    await js(`window.scrollTo(0, document.querySelector('[data-medicine]').getBoundingClientRect().top + scrollY - 16)`); await shot('medicine-360-dark')
    await js(`document.querySelector('[data-medicine-stories]').scrollBy({ left: 600 })`); await shot('medicine-360-dark-swiped')
    mock.medicine = 'disabled'
    await fresh(true); await click('Skip'); await wait(600); await typeBatch('SR-13')
    await js(`[...document.querySelectorAll('[data-medicine] button')].find(b => b.textContent.includes('Show general information')).click()`)
    await waitFor(`document.querySelector('[data-medicine]')?.dataset.medicine === 'disabled'`, 8000); await wait(300)
    ok('medicine: LLM_DISABLED hides the card and leaves one quiet note', (await js(`document.querySelectorAll('[data-medicine-card], [data-medicine-stories]').length`)) === 0 && (await js(`document.querySelector('[data-medicine="disabled"]')?.innerText || ''`)).includes("isn't available right now") && (await body()).includes('This batch failed a government quality test'))
    await js(`window.scrollTo(0, document.querySelector('[data-medicine]').getBoundingClientRect().top + scrollY - 420)`); await shot('medicine-360-dark-disabled')
    mock.medicine = 'ok'

    // Reduced motion: "Show general information" shows the story cards at once, with no height or fade animation.
    await vp(390, 844, false, true); await fresh(); await click('Skip'); await wait(600); await typeBatch('SR-13')
    await js(`[...document.querySelectorAll('[data-medicine] button')].find(b => b.textContent.includes('Show general information')).click()`)
    await waitFor(`!!document.querySelector('[data-medicine-card]')`, 8000)
    const rm = await js(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => { const a = document.querySelector('[data-medicine] [data-auto-height]'); const c = document.querySelector('[data-medicine-card]'); r({ state: a?.dataset.autoHeight, fit: Math.abs(a.getBoundingClientRect().height - a.firstElementChild.offsetHeight) <= 1, opacity: getComputedStyle(c.parentElement).opacity, transform: getComputedStyle(c.parentElement).transform }) })))`)
    ok('reduced motion: general information shows immediately (full height, opaque, no slide)', rm.fit && rm.opacity === '1' && (rm.transform === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(rm.transform)), JSON.stringify(rm))
    await vp(390, 844, false)
  }
}

// ---- Pack Reader (mock): a whole printed label is read on the device into fields; "About this medicine" is opt-in there too.
if (MODE === 'mock') {
  const scanText = () => js(`document.querySelector('[data-scanner]')?.innerText || ''`)
  const setScanFile = async file => {
    const doc = await send('DOM.getDocument', { depth: -1, pierce: true })
    const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[data-scan-upload]' })
    return send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] })
  }
  await vp(360, 800, true); await fresh(true); await click('Skip'); await wait(600)
  const lines = [['bold 56px Arial', 'DOLO-650'], ['38px Arial', 'Paracetamol Tablets IP 650 mg'], ['34px Arial', 'Each uncoated tablet contains:'], ['34px Arial', 'Paracetamol IP 650 mg'], ['34px Arial', '15 Tablets'], ['32px Arial', 'Mfd. by: Micro Labs Limited, Hosur 635126,'], ['32px Arial', 'Tamil Nadu'], ['32px Arial', 'Mfg. Lic. No.: 28/MD/AP/2010'], ['34px Arial', 'B.No.: DOBS3975   Exp: 05/2028'], ['34px Arial', 'M.R.P. Rs. 33.60']]
  const packPng = await js(`(() => { const c = document.createElement('canvas'); c.width = 1000; c.height = 820; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 820); x.fillStyle = '#111'; ${JSON.stringify(lines)}.forEach(([f, t], i) => { x.font = f; x.fillText(t, 50, 90 + i * 75) }); return c.toDataURL('image/png') })()`)
  const packFile = OUT + '/scan-pack-fixture.png'; fs.writeFileSync(packFile, Buffer.from(packPng.split(',')[1], 'base64'))
  await js(`document.querySelector('[aria-label="Scan the pack"]').click()`); await waitFor(`!!document.querySelector('[data-scanner]')`, 5000); await wait(500)
  await setScanFile(packFile)
  await waitFor(`!!document.querySelector('[data-scan-result]') || document.querySelector('[data-scanner]')?.dataset.phase === 'empty'`, 60000); await wait(400)
  const field = k => js(`document.querySelector('[data-pack-field="${k}"] dd')?.innerText || ''`)
  ok('pack: batch read from the whole label (DOBS3975)', (await js(`document.getElementById('scan-batch')?.value`)) === 'DOBS3975', await scanText())
  ok('pack: product, composition and form extracted', /Paracetamol Tablets IP 650/.test(await field('product')) && /Paracetamol IP 650 mg/.test(await field('composition')) && (await field('form')) === 'tablet', `${await field('product')} | ${await field('composition')} | ${await field('form')}`)
  ok('pack: maker, state, licence, pack size and MRP extracted', /Micro Labs/.test(await field('manufacturer')) && (await field('manufacturerState')).includes('Tamil Nadu') && /28\/MD\/AP\/2010/.test(await field('licence')) && /15 tablets/.test(await field('packSize')) && (await field('mrp')).startsWith('33.60'), [await field('manufacturer'), await field('manufacturerState'), await field('licence'), await field('packSize'), await field('mrp')].join(' | '))
  ok('pack: fields are editable', await js(`(() => { const b = [...document.querySelectorAll('[data-pack-fields] button')].find(x => x.textContent.trim() === 'Edit'); b.click(); return true })()`) && (await waitFor(`document.querySelectorAll('[data-pack-fields] input, [data-pack-fields] textarea').length >= 5`, 2000)))
  await js(`[...document.querySelectorAll('[data-pack-fields] button')].find(x => x.textContent.trim() === 'Done').click()`); await wait(200)
  ok('pack: scanner has no horizontal overflow at 360', await js(`(() => { const d = document.querySelector('[data-scanner]'); return d.scrollWidth <= d.clientWidth + 1 })()`))
  await shot('scan-pack-360-dark')
  await js(`document.querySelector('[data-pack-fields]').scrollIntoView({ block: 'start' })`); await shot('scan-pack-360-dark-fields')
  const before = mock.medicineBodies.length
  await js(`[...document.querySelectorAll('[data-scanner] [data-medicine] button')].find(b => b.textContent.includes('Show general information')).click()`)
  await waitFor(`!!document.querySelector('[data-scanner] [data-medicine-card]')`, 8000); await wait(400)
  const sentScan = JSON.parse(mock.medicineBodies[before] || '{}')
  ok('pack: scanner "About this medicine" asks with the label read on the device (no image)', sentScan.product === 'Paracetamol Tablets IP 650 mg' && (sentScan.composition || []).some(c => /Paracetamol/.test(c)) && !JSON.stringify(sentScan).includes('data:image'), mock.medicineBodies[before])
  await js(`document.querySelector('[data-scanner] [data-medicine]').scrollIntoView({ block: 'start' })`); await shot('scan-pack-360-dark-medicine')

  // The name bug: a label that names only the form ("Tablet") must never become "About Tablet". The card says
  // "this medicine" and asks for the name before anything is sent.
  const editField = async (k, v) => { await js(`(() => { const el = document.querySelector('[data-pack-field="${k}"] input, [data-pack-field="${k}"] textarea'); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })()`); await wait(250) }
  const scanMed = `document.querySelector('[data-scanner] [data-medicine]')`
  await js(`[...document.querySelectorAll('[data-pack-fields] button')].find(x => x.textContent.trim() === 'Edit').click()`); await wait(250)
  await editField('product', 'Tablet'); await editField('composition', '')
  await js(`[...document.querySelectorAll('[data-pack-fields] button')].find(x => x.textContent.trim() === 'Done').click()`); await wait(400)
  const askText = await js(`${scanMed}?.innerText || ''`)
  ok('name: a label read as only "Tablet" says "About this medicine" and asks for the name, never "about Tablet"', (await js(`${scanMed}?.dataset.medicine`)) === 'idle' && (await js(`${scanMed}.querySelector('[data-medicine-name]')?.innerText`)) === 'About this medicine' && (await js(`!!${scanMed}.querySelector('[data-medicine-confirm-name] input')`)) && !/about tablet/i.test(askText), askText.slice(0, 200))
  const sentBefore = mock.medicineBodies.length
  await js(`[...${scanMed}.querySelectorAll('button')].find(b => b.textContent.includes('Show general information')).click()`); await wait(400)
  ok('name: nothing is sent to the AI until a name is typed', mock.medicineBodies.length === sentBefore && (await js(`document.activeElement === ${scanMed}.querySelector('[data-medicine-confirm-name] input')`)))
  await js(`(() => { const i = ${scanMed}.querySelector('[data-medicine-confirm-name] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Dolo 650'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await wait(150)
  await js(`[...${scanMed}.querySelectorAll('button')].find(b => b.textContent.includes('Show general information')).click()`)
  await waitFor(`!!document.querySelector('[data-scanner] [data-medicine-card]')`, 8000); await wait(300)
  ok('name: the typed name is what the AI is asked about', JSON.parse(mock.medicineBodies[sentBefore] || '{}').product === 'Dolo 650', mock.medicineBodies[sentBefore])
  // Put the label back as read, then check: the result card's AI panel names the product.
  await js(`[...document.querySelectorAll('[data-pack-fields] button')].find(x => x.textContent.trim() === 'Edit').click()`); await wait(250)
  await editField('product', 'Paracetamol Tablets IP 650 mg'); await editField('composition', 'Paracetamol IP 650 mg')
  await js(`[...document.querySelectorAll('[data-pack-fields] button')].find(x => x.textContent.trim() === 'Done').click()`); await wait(300)
  await js(`document.querySelector('[data-scan-result] button[type="submit"]').click()`); await waitIdle(); await wait(500)
  const resMed = `document.querySelector('[data-confirming] [data-medicine]')`
  const resText = await js(`${resMed}?.innerText || ''`)
  ok('name: after a scan (form "tablet", product "Paracetamol Tablets IP 650 mg") the AI panel names the product, never "about Tablet"', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'no_alert' && (await js(`${resMed}?.querySelector('[data-medicine-name]')?.innerText`)) === 'About Paracetamol Tablets IP 650 mg' && !/about tablets?\b/i.test(resText), resText.slice(0, 200))
  // The collapsed panel: badge, caveats and (i) on top; icon, "General information", name and one line; the button; the footer.
  const panel = await js(`(() => { const m = ${resMed}; const r = sel => m.querySelector(sel)?.getBoundingClientRect(); const badge = r('[data-medicine-ai-label] span'); const tile = r('[data-medicine-prompt] span[aria-hidden]'); const btn = [...m.querySelectorAll('button')].find(b => b.textContent.includes('Show general information')).getBoundingClientRect(); const foot = r('[data-medicine-footer]'); const name = r('[data-medicine-name]'); return { order: badge.top < name.top && name.top < btn.top && btn.bottom <= foot.top, aligned: Math.abs(badge.left - tile.left) <= 1 && Math.abs(tile.left - btn.left) <= 1, btn44: btn.height >= 44, info44: m.querySelector('[aria-label="Why this is marked AI-generated"]').getBoundingClientRect().height >= 44, eyebrow: /general information/i.test(m.querySelector('[data-medicine-prompt]').innerText) && m.querySelector('[data-medicine-prompt]').innerText.includes("What it's for, side effects, when to get help."), label: m.querySelector('[data-medicine-ai-label]').innerText.replace(/\\s+/g, ' '), footer: m.querySelector('[data-medicine-footer]').innerText.includes('Not medical advice. Ask your doctor or pharmacist.'), fits: m.getBoundingClientRect().right <= innerWidth && document.documentElement.scrollWidth <= innerWidth } })()`)
  ok('medicine panel (collapsed): badge, caveats, name, one line, a 44px button and the footer, stacked and left-aligned', panel.order && panel.aligned && panel.btn44 && panel.info44 && panel.eyebrow && /AI-generated/i.test(panel.label) && panel.label.includes('Not from a regulator · may be wrong') && panel.footer && panel.fits, JSON.stringify(panel))
  // No green and no "safe" anywhere in the verdict or the AI panel (dark mode).
  const greenAny = await js(`(() => { const nodes = [...document.querySelectorAll('[data-confirming], [data-confirming] *')]; return nodes.some(n => { const c = getComputedStyle(n); return [c.color, c.backgroundColor, c.borderTopColor].some(v => { const m = v.match(/\\d+(\\.\\d+)?/g); if (!m) return false; const [r, g, b] = m.map(Number); return g > r + 40 && g > b + 40 }) }) })()`)
  ok('no alert after a scan: no green in the card or the AI panel (dark)', greenAny === false)
  ok('no alert after a scan: never says "safe", "genuine" or "approved"', !/\b(safe|genuine|approved)\b/i.test((await js(`document.querySelector('[data-confirming]').innerText`)).replace(/not a safety certificate/gi, '')))
  await js(`document.querySelector('[data-confirming]').scrollIntoView({ block: 'start' })`); await shot('scan-result-360-dark-ai-panel')
}

// ---- Cabinet: add a medicine from a photo (mock). Read on the device and pre-filled with where each value came from;
// "Guess with AI" only on a weak read, sending the label text and hints, never the photo; nothing saves until confirmed.
if (MODE === 'mock') {
  const dlgText = () => js(`document.querySelector('[data-cabinet-dialog]')?.innerText || ''`)
  const cabStored = () => js(`JSON.parse(localStorage.getItem('nazar:cabinet') || '[]')`)
  const step = () => js(`document.querySelector('[data-cabinet-dialog]')?.dataset.step || null`)
  const val = k => js(`document.querySelector('[data-cabinet-form] [data-field="${k}"] input')?.value ?? null`)
  const src = k => js(`document.querySelector('[data-cabinet-form] [data-field="${k}"] [data-field-source]')?.dataset.fieldSource || ''`)
  const srcText = k => js(`document.querySelector('[data-cabinet-form] [data-field="${k}"] [data-field-source]')?.innerText || ''`)
  const setAddFile = async (file, sel = 'input[data-add-upload]') => {
    const doc = await send('DOM.getDocument', { depth: -1, pierce: true })
    const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: sel })
    return send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] })
  }
  const packImage = async (name, lines) => {
    const png = await js(`(() => { const c = document.createElement('canvas'); c.width = 1000; c.height = 120 + ${lines.length} * 75; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111'; ${JSON.stringify(lines)}.forEach(([f, t], i) => { x.font = f; x.fillText(t, 50, 90 + i * 75) }); return c.toDataURL('image/png') })()`)
    const file = `${OUT}/${name}.png`; fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64')); return file
  }
  const waitRead = () => waitFor(`!!document.querySelector('[data-cabinet-form][data-from-photo]')`, 90000)
  const setField = (k, v) => js(`(() => { const i = document.querySelector('[data-cabinet-form] [data-field="${k}"] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  const openChooser = async () => { await js(`(document.querySelector('[data-shelf-add]') || [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add a medicine')).click()`); await waitFor(`!!document.querySelector('[data-cabinet-choose]')`, 5000); await wait(300) }

  const goodPack = await packImage('cabphoto-good', [['bold 56px Arial', 'DOLO-650'], ['38px Arial', 'Paracetamol Tablets IP 650 mg'], ['34px Arial', 'Each uncoated tablet contains:'], ['34px Arial', 'Paracetamol IP 650 mg'], ['32px Arial', 'Mfd. by: Micro Labs Limited, Hosur 635126,'], ['32px Arial', 'Tamil Nadu'], ['34px Arial', 'B.No.: DOBS3975   Exp: 05/2028']])
  // No "B.No." label before the batch, so the device cannot tell which code is the batch: a weak read.
  const weakPack = await packImage('cabphoto-weak', [['bold 56px Arial', 'DOLO-650'], ['38px Arial', 'Paracetamol Tablets IP 650 mg'], ['32px Arial', 'Micro Labs Limited'], ['36px Arial', 'DOBS4410     EXP 04/2028']])

  await vp(390, 844, false); await send('Page.navigate', { url: URL + 'cabinet' }); await wait(1200)
  await js(`localStorage.clear(); localStorage.setItem('theme', 'light'); localStorage.setItem('nazar:onboarded', '1')`); await send('Page.reload'); await wait(1500)
  ok('cabinet photo: the empty shelf invites a photo of the pack', (await js(`!!document.querySelector('[data-shelf-photo-hint]')`)) && (await js(`document.querySelector('[data-shelf-add]')?.textContent.trim()`)) === 'Add your first medicine')
  await openChooser()
  const tiles = await js(`[...document.querySelectorAll('[data-cabinet-choose] button')].map(b => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height), bg: getComputedStyle(b).backgroundColor }))`)
  ok('cabinet photo: chooser offers take a photo (primary, rear camera), upload and type', tiles.length === 3 && tiles[0].t.startsWith('Take a photo of the pack') && tiles[1].t === 'Upload a photo' && tiles[2].t === 'Type it in' && tiles[0].bg !== tiles[1].bg && tiles[0].h > tiles[1].h && (await js(`document.querySelector('input[data-add-camera]').getAttribute('capture')`)) === 'environment' && !(await js(`document.querySelector('input[data-add-upload]').hasAttribute('capture')`)), JSON.stringify(tiles))
  ok('cabinet photo: focus starts inside the dialog, on the photo option', (await js(`document.activeElement?.hasAttribute('data-add-camera-btn')`)) === true)
  ok('cabinet photo: chooser says photos never leave the device', (await dlgText()).includes('Photos are read on this device and never uploaded'))
  await shot('cabphoto-chooser-390')

  await setAddFile(goodPack)
  ok('cabinet photo: reading shows progress with the scanning eye', await waitFor(`!!document.querySelector('[data-cabinet-reading] [data-sentinel][data-state="scanning"]')`, 5000))
  await shot('cabphoto-reading-390', 150)
  ok('cabinet photo: the label is read and the form pre-filled', await waitRead(), await dlgText())
  ok('cabinet photo: name, batch and expiry pre-filled from the label', /Paracetamol Tablets IP 650 mg|DOLO-650/.test(await val('name')) && (await val('batch')) === 'DOBS3975' && (await val('expiry')) === '2028-05', `${await val('name')} | ${await val('batch')} | ${await val('expiry')}`)
  ok('cabinet photo: each pre-filled field says "Read from the label · N%"', (await Promise.all(['name', 'batch', 'expiry'].map(srcText))).every(t => /^Read from the label · \d{1,3}%/.test(t)), (await Promise.all(['name', 'batch', 'expiry'].map(srcText))).join(' | '))
  ok('cabinet photo: composition and maker pre-filled as optional fields', /Paracetamol IP 650 mg/.test(await val('composition')) && /Micro Labs/.test(await val('maker')))
  ok('cabinet photo: a clear read offers no AI guess and sends nothing', !(await js(`!!document.querySelector('[data-ai-guess]')`)) && mock.identifyBodies.length === 0)
  ok('cabinet photo: focus moves to the "Check what we read" heading', (await js(`document.activeElement?.textContent`)) === 'Check what we read')
  ok('cabinet photo: nothing is saved before confirming', (await cabStored()).length === 0)
  await shot('cabphoto-prefilled-390')
  await setField('name', 'Dolo 650')
  ok('cabinet photo: fields stay editable; an edited field drops its source chip', (await val('name')) === 'Dolo 650' && !(await src('name')) && (await src('batch')) === 'label')
  await js(`document.querySelector('[data-cabinet-form] button[type="submit"]').click()`); await wait(800)
  const saved1 = (await cabStored())[0] || {}
  ok('cabinet photo: confirming saves the item with its composition and maker', saved1.name === 'Dolo 650' && saved1.batch === 'DOBS3975' && saved1.expiry === '2028-05' && /Paracetamol/.test((saved1.composition || []).join()) && /Micro Labs/.test(saved1.maker || ''), JSON.stringify(saved1))
  ok('cabinet photo: the saved item appears on the shelf', await waitFor(`!!document.querySelector('[data-shelf-batch="DOBS3975"]')`, 5000))
  await js(`document.querySelector('[data-cabinet-item][data-batch="DOBS3975"] button[aria-expanded]').click()`); await wait(300)
  ok('cabinet photo: the open row shows composition and maker', /Paracetamol IP 650 mg/.test(await js(`document.querySelector('[data-batch="DOBS3975"] [data-cabinet-details]')?.innerText || ''`)))

  // Weak read at 360 dark: Guess with AI, its error states, then a successful guess.
  await vp(360, 800, true); await js(`localStorage.setItem('theme', 'dark')`); await send('Page.reload'); await wait(1500)
  await openChooser(); await setAddFile(weakPack); await waitRead(); await wait(300)
  ok('cabinet photo: weak read (no batch) offers "Guess with AI" and says only the text is sent', (await val('batch')) === '' && (await js(`!!document.querySelector('[data-ai-guess]')`)) && (await js(`document.querySelector('[data-ai-disclosure]')?.innerText || ''`)) === "Only the text read from the label is sent to Nazar's server for Gemini to guess. The photo stays on this phone.", await dlgText())
  ok('cabinet photo: nothing is sent until the person asks', mock.identifyBodies.length === 0)
  mock.identify = 'limited'
  await js(`document.querySelector('[data-ai-guess]').click()`); await waitFor(`!!document.querySelector('[data-ai-error="limited"]')`, 8000)
  ok('cabinet photo: rate limited says the wait in minutes; the form stays usable', /Try again in 3 minutes/.test(await js(`document.querySelector('[data-ai-error]')?.innerText || ''`)) && (await js(`document.querySelector('[data-ai-guess]').disabled`)) && !(await js(`document.querySelector('[data-cabinet-form] [data-field="name"] input').disabled`)), await js(`document.querySelector('[data-ai-panel]')?.innerText`))
  await js(`document.querySelector('[data-photo-retake]').click()`); await wait(300); await setAddFile(weakPack); await waitRead(); await wait(300)
  mock.identify = 'failed'
  await js(`document.querySelector('[data-ai-guess]').click()`); await waitFor(`!!document.querySelector('[data-ai-error="error"]')`, 8000)
  ok('cabinet photo: a failed guess is explained politely with a retry', /Could not get a guess right now/.test(await js(`document.querySelector('[data-ai-error]')?.innerText || ''`)) && /Try the AI guess again/.test(await js(`document.querySelector('[data-ai-guess]')?.innerText || ''`)))
  mock.identify = 'ok'
  const sentBefore = mock.identifyBodies.length
  await js(`document.querySelector('[data-ai-guess]').click()`); await waitFor(`!!document.querySelector('[data-ai-done]')`, 8000); await wait(300)
  const sentRaw = mock.identifyBodies[sentBefore] || '{}'; const sent = JSON.parse(sentRaw)
  ok('cabinet photo: the AI request is only { text, hints }, with no image or data: URL', Object.keys(sent).every(k => k === 'text' || k === 'hints') && typeof sent.text === 'string' && /DOBS4410/.test(sent.text) && Object.keys(sent.hints || {}).every(k => ['product', 'batch', 'expiry', 'manufacturer', 'composition'].includes(k)) && !/data:|base64|image/i.test(sentRaw), sentRaw.slice(0, 300))
  ok('cabinet photo: AI fills only the empty fields and marks them "AI guess · check this"', (await val('batch')) === 'DOBS4410' && (await src('batch')) === 'ai' && (await srcText('batch')) === 'AI guess · check this' && (await src('maker')) === 'ai' && (await src('composition')) === 'ai', `${await val('batch')} ${await src('batch')} ${await src('maker')} ${await src('composition')}`)
  ok('cabinet photo: a well-read name is not overwritten; the AI name is a suggestion to accept', /Paracetamol Tablets IP 650 mg/.test(await val('name')) && (await src('name')) === 'label' && (await js(`document.querySelector('[data-ai-suggestion="name"]')?.innerText || ''`)).includes('DOLO-650'))
  ok('cabinet photo: the AI answer is labelled as an AI guess, not regulator data', /not regulator data/.test(await js(`document.querySelector('[data-ai-done]')?.innerText || ''`)))
  await js(`document.querySelector('[data-cabinet-form] [data-field="batch"] [data-field-source="ai"]').click()`); await waitFor(`!!document.querySelector('[data-ai-evidence]')`, 3000); await wait(250)
  ok('cabinet photo: the AI chip opens the evidence, quoting the label text', /DOBS4410/.test(await js(`document.querySelector('[data-ai-evidence]')?.innerText || ''`)) && /not regulator data/.test(await js(`document.querySelector('[data-ai-evidence]')?.innerText || ''`)))
  await shot('cabphoto-ai-evidence-360-dark')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(400)
  ok('cabinet photo: Escape closes the evidence, not the form', !(await js(`!!document.querySelector('[data-ai-evidence]')`)) && (await step()) === 'form')
  await js(`[...document.querySelectorAll('[data-ai-suggestion="name"] button')].find(b => b.textContent.trim() === 'Use this').click()`); await wait(200)
  ok('cabinet photo: accepting a suggestion fills it as an AI guess', (await val('name')) === 'DOLO-650' && (await src('name')) === 'ai')
  ok('cabinet photo: no horizontal overflow at 360 with the AI guess open', (await js(`document.documentElement.scrollWidth`)) <= 360 && (await js(`(() => { const d = document.querySelector('[data-cabinet-dialog]'); return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= 360 })()`)))
  ok('cabinet photo: nothing is saved by the AI guess; no batch check ran for it', (await cabStored()).length === 1 && !requests.some(u => /\/v1\/check\?batch=DOBS4410/.test(u)))
  await js(`document.querySelector('[data-cabinet-form] button[type="submit"]').click()`); await wait(800)
  const saved2 = (await cabStored()).find(i => i.batch === 'DOBS4410') || {}
  ok('cabinet photo: the confirmed AI-assisted item is saved and on the shelf', saved2.name === 'DOLO-650' && saved2.maker === 'Micro Labs Limited' && (await waitFor(`!!document.querySelector('[data-shelf-batch="DOBS4410"]')`, 5000)), JSON.stringify(saved2))
  ok('cabinet photo: after saving, the usual re-check runs', (await waitFor(`document.querySelector('[data-shelf-batch="DOBS4410"]')?.dataset.shelfState !== 'pending'`, 15000)) && requests.some(u => /\/v1\/check\?batch=DOBS4410/.test(u)))
  ok('cabinet photo: 360 cabinet has no horizontal overflow', (await js(`document.documentElement.scrollWidth`)) <= 360)

  // A GS1 QR (SR-13, exp Apr 2027) next to a printed "B.No.: SR-14": the code wins, and the mismatch is called out.
  const QR_PNG = 'data:image/png;base64,' + fs.readFileSync(decodeURIComponent(new globalThis.URL('./fixtures/scan-gs1-qr.png', import.meta.url).pathname)).toString('base64')
  const qrMixPng = await js(`(async () => { const img = new Image(); img.src = ${JSON.stringify(QR_PNG)}; await img.decode(); const c = document.createElement('canvas'); c.width = 1000; c.height = 420; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 420); x.drawImage(img, 30, 100); x.fillStyle = '#111'; x.font = 'bold 44px Arial'; x.fillText('COLDRIF Syrup', 320, 120); x.font = '42px Arial'; x.fillText('B.No.: SR-14', 320, 210); x.fillText('Exp: 04/2027', 320, 290); return c.toDataURL('image/png') })()`)
  const qrMix = `${OUT}/cabphoto-qr-mismatch.png`; fs.writeFileSync(qrMix, Buffer.from(qrMixPng.split(',')[1], 'base64'))
  await openChooser(); await setAddFile(qrMix); await waitRead(); await wait(300)
  ok('cabinet photo: a GS1 code is preferred (batch and expiry, high confidence)', (await val('batch')) === 'SR-13' && (await val('expiry')) === '2027-04' && (await srcText('batch')) === 'From the QR code · high confidence', `${await val('batch')} ${await val('expiry')} ${await srcText('batch')}`)
  ok('cabinet photo: a printed batch that disagrees with the code shows the mismatch warning', /Label details don.t match/.test(await js(`document.querySelector('[data-photo-mismatch]')?.innerText || ''`)) && /SR-14/.test(await js(`document.querySelector('[data-photo-mismatch]').innerText`)))
  await escape()

  // LLM switched off on the server: the button goes away with a note, and stays away for the visit.
  await openChooser(); await setAddFile(weakPack); await waitRead(); await wait(300)
  mock.identify = 'disabled'
  await js(`document.querySelector('[data-ai-guess]').click()`); await waitFor(`document.querySelector('[data-ai-panel]')?.dataset.aiState === 'disabled'`, 8000)
  ok('cabinet photo: LLM_DISABLED hides the AI button and leaves a note', !(await js(`!!document.querySelector('[data-ai-guess]')`)) && /AI guessing isn.t available right now/.test(await js(`document.querySelector('[data-ai-panel]')?.innerText || ''`)) && !(await js(`document.querySelector('[data-cabinet-form] [data-field="batch"] input').disabled`)))
  await js(`document.querySelector('[data-photo-retake]').click()`); await wait(300); await setAddFile(weakPack); await waitRead(); await wait(300)
  ok('cabinet photo: after LLM_DISABLED the next weak read shows the note, not the button', (await js(`document.querySelector('[data-ai-panel]')?.dataset.aiState`)) === 'disabled' && !(await js(`!!document.querySelector('[data-ai-guess]')`)))
  await escape()
  ok('cabinet photo: closing without confirming saves nothing', (await cabStored()).length === 2)
  mock.identify = 'ok'
}

// ---- Feed against the API (mock contract or the real backend)
if (MODE === 'mock' || MODE === 'live') {
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  ok('feed: nav link routes client-side (no reload)', await openFeed())
  ok('feed: answered by the API, labelled Live · Nazar API', (await js(`document.querySelector('[data-feed]').dataset.feedSource`)) === 'api' && (await js(`[...document.querySelectorAll('[data-source]')].some(e => e.innerText === 'Live · Nazar API')`)))
  const allCountBefore = await feedCount()
  // India pulse: drawn from the site's snapshot while the list comes from the API; a tile sets the API's state filter.
  if (await waitFor(`!!document.querySelector('[data-feed-pulse] [data-pulse-tile="IN-MH"]')`, 10000)) {
    await js(`document.querySelector('[data-pulse-tile="IN-MH"]').click()`); await feedIdle()
    ok('feed pulse: Maharashtra tile filters the API list', (await js(`location.search`)) === '?state=IN-MH' && (await js(`document.getElementById('feed-state').value`)) === 'IN-MH' && (await feedRows()) > 0 && (await rowTexts()).every(t => t.includes('Made in Maharashtra')), String(await feedRows()))
    await js(`document.querySelector('[data-pulse-clear]').click()`); await feedIdle()
    ok('feed pulse: Clear restores the full list', (await js(`location.search`)) === '' && (await feedCount()) === allCountBefore && !(await js(`!!document.querySelector('[data-pulse-tile][aria-pressed="true"]')`)))
  } else ok('feed pulse: drawn from the site snapshot next to the API list', false)
  const allCount = await feedCount(); const firstRows = await feedRows()
  ok('feed: first page has rows and a count', firstRows > 0 && /^[\d,]+ alerts?/.test(allCount), `${firstRows} rows · ${allCount}`)
  ok('feed: rows with an entity key carry a labelled Live on Arkiv dot', (await js(`document.querySelectorAll('[data-live-arkiv][aria-label="Live on Arkiv"]').length`)) === firstRows && (await js(`!!document.querySelector('[data-feed-onchain-key]')`)))
  { // fcfix: at 390 the name gets the row's width (two lines allowed); the on-chain status is a small dot.
    await vp(390, 844, false); await wait(400)
    const rowCheck = await js(`(() => { const rows = [...document.querySelectorAll('[data-alert-row]')]; const bad = rows.filter(r => { const n = r.querySelector('[data-row-name]'); const d = r.querySelector('[data-live-arkiv]'); return !n || n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1 || (d && d.getBoundingClientRect().width > 12) || /live on arkiv/i.test(r.innerText) }); return rows.length + ':' + bad.length })()`)
    ok('feed: at 390 row names are not truncated by a badge', rowCheck.endsWith(':0') && !rowCheck.startsWith('0:'), rowCheck)
    await vp(1440, 1000, false); await wait(300)
  }
  if (MODE === 'mock') ok('feed: first page is 20 of 43', firstRows === 20 && allCount.startsWith('43 alerts') && (await body()).includes('Showing 20 of 43'))
  if (await js(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Load more alerts')`)) {
    await click('Load more alerts'); await waitFor(`![...document.querySelectorAll('button')].some(b => b.getAttribute('aria-busy') === 'true')`); await wait(300)
    ok('feed: Load more appends the next page', (await feedRows()) > firstRows, `${firstRows} → ${await feedRows()}`)
    if (MODE === 'mock') {
      await click('Load more alerts'); await waitFor(`(document.querySelectorAll('[data-alert-row]').length) === 43`, 5000)
      ok('feed: paging reaches the end (43 rows, End of the feed)', (await feedRows()) === 43 && (await body()).includes('End of the feed'))
    }
  } else ok('feed: Load more is offered when more alerts exist', MODE === 'live' && firstRows < 20, String(firstRows))
  await shot(`${MODE}-feed-desktop`)
  await press('Serious 4–5')
  const seriousCount = await feedCount()
  ok('feed: Serious 4–5 filter changes the results', seriousCount !== allCount && (await rowTexts()).every(t => /^[45]\n/.test(t.trim())) && (await js(`location.search`)) === '?sev=4', `${allCount} → ${seriousCount}`)
  if (MODE === 'mock') ok('feed: Serious shows the 2 API alerts of severity 4+', seriousCount.startsWith('2 alerts') && (await feedRows()) === 2)
  await press('Reset filters')
  await pick('feed-state', 'IN-MH')
  const mhRows = await feedRows()
  ok('feed: Made in Maharashtra filter goes to the API', (await rowTexts()).every(t => t.includes('Made in Maharashtra')) && (await js(`location.search`)) === '?state=IN-MH', String(mhRows))
  await press('Reset filters')
  if (MODE === 'mock') {
    await pick('feed-source', 'mh-fda')
    const t = await rowTexts()
    ok('feed: source filter works even when the server ignores it', t.length === MH_ROWS && t.every(x => x.includes('Food and Drug Administration, Maharashtra')), String(t.length))
    ok("feed: Maharashtra rows say \"Date not given · first seen\" instead of a date", t.every(x => x.includes('Date not given · first seen Sep 2025') || x.includes('Date not given · first seen Aug 2025')), t[0])
    await js(`document.querySelector('[data-alert-row]').click()`); await wait(800)
    await js(`[...document.querySelectorAll('[data-feed] button')].find(b => b.textContent.includes('How do we know'))?.click()`); await wait(900)
    const p = await proofText()
    ok('feed: Maharashtra proof shows the honest date line', p.includes('Date not given · first seen'), p.slice(0, 160))
    await escape(); await press('Reset filters')
  }
  await js(`document.querySelector('[data-alert-row]').click()`); await wait(900)
  ok('feed: opening an alert shows the result card, labelled with the API', (await js(`document.querySelector('[data-feed] section[data-state="flagged"] [data-source]')?.dataset.source`)) === 'api')
  await js(`[...document.querySelectorAll('[data-feed] button')].find(b => b.textContent.includes('How do we know'))?.click()`); await wait(900)
  const fp = await proofText()
  ok('feed: proof sheet opens with publisher and source hash', fp.includes('Published by') && fp.includes('Source SHA-256'), fp.slice(0, 160))
  if (MODE === 'mock') ok('feed: proof shows the Arkiv entity key', fp.includes('0x8b1c…aa99'))
  await escape()
  await vp(360, 800, true); await js(`localStorage.setItem('theme', 'dark')`); await send('Page.reload'); await wait(1500); await feedIdle()
  ok('feed: no horizontal overflow at 360 (API data)', (await js(`document.documentElement.scrollWidth`)) <= 360)
  await shot(`${MODE}-feed-360-dark`)
}

// ---- Alerts: search by name, RSS link, "New since your last visit" and the nav badges (mock API)
if (MODE === 'mock') {
  // mock.feedNew: alerts published since the last visit, at the top of the unfiltered list (and in search).
  const mockBeforeNew = mockResponse
  mockResponse = (url) => {
    const r = mockBeforeNew(url); const q = new globalThis.URL(url).searchParams
    if (!r || new globalThis.URL(url).pathname !== '/v1/alerts' || !mock.feedNew?.length || ['offset', 'state', 'minSeverity', 'peds'].some(k => q.get(k))) return r
    return { items: [...mock.feedNew, ...r.items].slice(0, Number(q.get('limit') || 50)), total: r.total + mock.feedNew.length }
  }
  const searchFor = async (q) => {
    await js(`(() => { const i = document.getElementById('feed-q'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(q)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await wait(450); await waitFor(`document.querySelector('[data-feed]')?.dataset.feedMode === ${JSON.stringify(q ? 'search' : 'list')}`); await feedIdle(); await wait(150)
  }
  const searchRequests = () => requests.filter(u => u.startsWith('http://localhost:8787/v1/search'))
  const rssUrl = () => js(`document.querySelector('[data-rss-url]')?.value || ''`)
  const seen = () => js(`JSON.parse(localStorage.getItem('nazar:seen') || 'null')`)
  const noSafe = (t) => !/\bsafe\b|genuine|approved/i.test(t)
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  await openFeed()

  // RSS: built from the current filters, absolute, with copy and open.
  ok('rss: Subscribe (RSS) is offered when the build has an API', await js(`!!document.querySelector('[data-rss-toggle]')`))
  await press('Serious 4–5'); await pick('feed-state', 'IN-TN')
  await js(`document.querySelector('[data-rss-toggle]').click()`); await wait(300)
  {
    const u = new globalThis.URL(await rssUrl())
    ok('rss: the feed URL follows the filters (Serious 4–5, Made in Tamil Nadu)', u.origin + u.pathname === 'http://localhost:8787/v1/alerts.rss' && u.searchParams.get('minSeverity') === '4' && u.searchParams.get('state') === 'IN-TN' && [...u.searchParams.keys()].length === 2, u.href)
    ok('rss: Open links to the same feed; the panel names the filters', (await js(`document.querySelector('[data-rss-open]').href`)) === u.href && (await js(`document.querySelector('[data-rss-panel]').innerText`)).includes('Serious 4–5 · Made in Tamil Nadu'))
    await js(`[...document.querySelectorAll('[data-rss-panel] button')].find(b => b.textContent.trim() === 'Atom').click()`); await wait(200)
    ok('rss: Atom gives the .atom feed with the same filters', (await rssUrl()) === u.href.replace('/v1/alerts.rss', '/v1/alerts.atom'))
    await js(`[...document.querySelectorAll('[data-rss-panel] button')].find(b => b.textContent.trim() === 'RSS').click()`); await wait(200)
    await press('Child Shield only'); await pick('feed-source', 'who-mpa')
    const u2 = new globalThis.URL(await rssUrl())
    ok('rss: Child Shield and source are passed as peds=1 and source', u2.searchParams.get('peds') === '1' && u2.searchParams.get('source') === 'who-mpa' && u2.searchParams.get('minSeverity') === '4', u2.href)
  }
  await press('Reset filters')
  ok('rss: with no filters the feed is every alert', (await rssUrl()) === 'http://localhost:8787/v1/alerts.rss' && (await js(`document.querySelector('[data-rss-panel]').innerText`)).includes('This feed has every alert'))
  await js(`document.querySelector('[data-rss-panel]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -120)`); await shot('feat1-rss-desktop')
  await js(`document.querySelector('[data-rss-toggle]').click()`); await wait(200)

  // Search, answered by the API: debounced, in the URL, words highlighted.
  const before = searchRequests().length
  for (const q of ['m', 'ma', 'mah', 'maha']) { await js(`(() => { const i = document.getElementById('feed-q'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(q)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await wait(60) }
  await searchFor('mahacef')
  const asked = searchRequests().slice(before)
  ok('search: typing is debounced (one request for the word, none per letter)', asked.length === 1 && asked[0].includes('q=mahacef'), asked.join(' '))
  ok('search: answered by the API and labelled Live · Nazar API', (await js(`document.querySelector('[data-feed]').dataset.feedSource`)) === 'api' && (await js(`[...document.querySelectorAll('[data-source]')].some(e => e.innerText === 'Live · Nazar API')`)))
  ok('search: finds the Mahacef rows and says what it searched', (await feedRows()) === MH_ROWS && (await feedCount()).startsWith(`${MH_ROWS} alerts name “mahacef”`), `${await feedRows()} · ${await feedCount()}`)
  ok('search: the matched word is highlighted in every row', await js(`[...document.querySelectorAll('[data-alert-row]')].every(r => [...r.querySelectorAll('mark[data-hl]')].some(m => m.textContent.toLowerCase() === 'mahacef'))`))
  ok('search: the query is in the URL (?q=)', (await js(`location.search`)) === '?q=mahacef')
  await js(`document.getElementById('feed-q').scrollIntoView({ block: 'start' }); window.scrollBy(0, -120)`); await shot('feat1-search-desktop')
  await press('Serious 4–5')
  ok('search: filters still apply and the empty state says so', (await feedRows()) === 0 && (await js(`document.querySelector('[data-feed-search-empty]')?.innerText || ''`)).includes(`${MH_ROWS} alerts name “mahacef”, but none match your filters`) && (await js(`location.search`)) === '?sev=4&q=mahacef' && (await js(`document.querySelector('[data-feed-search-filters]')?.innerText || ''`)).includes('Serious 4–5'))
  await press('Reset filters')
  ok('search: Reset filters brings the matches back', (await feedRows()) === MH_ROWS && (await js(`location.search`)) === '?q=mahacef')
  await searchFor('Sres')
  ok('search: a maker search shows and highlights the maker line', (await feedRows()) > 0 && (await js(`[...document.querySelectorAll('[data-row-match]')].length > 0 && [...document.querySelectorAll('[data-row-match] mark[data-hl]')].every(m => m.textContent === 'Sres')`)))
  await searchFor('zzqx')
  {
    const e = await js(`document.querySelector('[data-feed-search-empty]')?.innerText || ''`)
    ok('search: no match says no regulator alert names it, and that this is not a safety certificate', e.includes('No regulator alert names “zzqx” in Nazar\'s records.') && e.includes('This is not a safety certificate.') && noSafe(e.replace('safety certificate', '')), e)
    ok('search: a word query offers no batch check', !(await js(`!!document.querySelector('[data-feed-check-batch]')`)))
  }
  await js(`document.querySelector('#feed-q')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -120)`); await shot('feat1-search-empty-desktop')
  await searchFor('SR-13')
  ok('search: a batch-like query offers "Check this batch" to /?batch=', (await js(`document.querySelector('[data-feed-check-batch]')?.getAttribute('href')`)) === '/?batch=SR-13' && (await rowTexts()).some(t => t.includes('SR-13')))
  await js(`document.querySelector('[data-feed-check-batch]').click()`); await wait(400); await waitIdle(); await wait(400)
  ok('search: Check this batch runs the check on the Check page', (await js(`location.pathname`)) === '/' && (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'flagged')
  await openFeed()
  ok('search: back on Alerts the list is unfiltered again', (await js(`document.querySelector('[data-feed]').dataset.feedMode`)) === 'list' && (await js(`document.getElementById('feed-q').value`)) === '')

  // Search when the API is down: Nazar's saved copy answers, labelled as such. Deep link with ?q=.
  mock.apiDown = true
  await send('Page.navigate', { url: new globalThis.URL('/feed?q=coldrif', URL).href }); await wait(1500)
  await waitFor(`document.querySelector('[data-feed]')?.dataset.feedSource === 'snapshot'`, 15000)
  ok('search: ?q= deep link fills the box and searches', (await js(`document.getElementById('feed-q').value`)) === 'coldrif' && (await js(`document.querySelector('[data-feed]').dataset.feedMode`)) === 'search')
  ok("search: with the API down the saved copy answers, and says so", (await js(`document.querySelector('[data-feed]').dataset.feedSource`)) === 'snapshot' && (await js(`document.querySelector('[data-feed-saved-copy]')?.innerText || ''`)).includes("these matches come from Nazar's saved copy") && (await rowTexts()).length > 0 && (await rowTexts()).every(t => /coldrif/i.test(t)))
  ok('search: saved-copy matches are highlighted too', await js(`[...document.querySelectorAll('[data-alert-row]')].every(r => [...r.querySelectorAll('mark[data-hl]')].some(m => m.textContent.toLowerCase() === 'coldrif'))`))
  mock.apiDown = false
  await js(`document.querySelector('[data-feed-search-clear]').click()`); await wait(300); await feedIdle()
  ok('search: Clear search returns to the list and drops ?q=', (await js(`document.querySelector('[data-feed]').dataset.feedMode`)) === 'list' && (await js(`location.search`)) === '')

  // "New since your last visit", across two visits (a visit = a browser tab session).
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('nazar:onboarded', '1'); localStorage.setItem('theme', 'light')`)
  await send('Page.navigate', { url: new globalThis.URL('/feed', URL).href }); await wait(1500); await feedIdle()
  await waitFor(`!!localStorage.getItem('nazar:seen')`, 10000); await wait(600)
  ok('new: a first visit marks nothing as new', !(await js(`!!document.querySelector('[data-new-pill], [data-feed-new]')`)) && !!(await seen()))
  const ym = (await seen()).ym
  mock.feedNew = [dto({ entityKey: KEY2, rid: 'r-new1', caseId: 'cn1', batch: 'NW-26', batchKey: 'nw26', brand: 'Fresh Batch Syrup', product: 'Fresh Batch Syrup', peds: false, severity: 4, alertYm: ym, noticeDate: null, dateKnown: false, sourceId: 'mh-fda', state: 'IN-MH' })]
  await js(`sessionStorage.clear()`); await send('Page.reload'); await wait(1500); await feedIdle(); await wait(500)
  const pills = () => js(`[...document.querySelectorAll('[data-alert-row]')].filter(r => r.querySelector('[data-new-pill]')).map(r => r.dataset.alertRow)`)
  ok('new: on the next visit the new (undated, first-seen) alert carries a New pill', JSON.stringify(await pills()) === '["r-new1"]', JSON.stringify(await pills()))
  ok('new: the header says how many are new, with Mark all seen', /^1 new alert since your last visit\s*·\s*Mark all seen$/.test((await js(`document.querySelector('[data-feed-new]')?.innerText || ''`)).replace(/\s+/g, ' ').trim()), await js(`document.querySelector('[data-feed-new]')?.innerText`))
  await js(`document.querySelector('[data-feed-new]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -120)`); await shot('feat1-new-desktop')
  await send('Page.reload'); await wait(1500); await feedIdle(); await wait(400)
  ok('new: the pill stays for the rest of the visit (reload)', JSON.stringify(await pills()) === '["r-new1"]')
  await js(`document.querySelector('[data-feed-mark-seen]').click()`); await wait(300)
  ok('new: Mark all seen clears the pills and the header', (await pills()).length === 0 && !(await js(`!!document.querySelector('[data-feed-new]')`)))
  await js(`sessionStorage.clear()`); await send('Page.reload'); await wait(1500); await feedIdle(); await wait(400)
  ok('new: a later visit has nothing new', (await pills()).length === 0 && !(await js(`!!document.querySelector('[data-feed-new]')`)))
  mock.feedNew = []

  // Nav badge for Alerts: unseen alerts in the saved copy, cleared by visiting Alerts.
  await js(`(() => { const s = JSON.parse(localStorage.getItem('nazar:seen')); s.keys = s.keys.slice(3); localStorage.setItem('nazar:seen', JSON.stringify(s)); sessionStorage.clear() })()`)
  await send('Page.navigate', { url: URL }); await wait(1500); await settle()
  await waitFor(`!!document.querySelector('nav[aria-label="Main navigation"] [data-nav="alerts"] [data-nav-badge]')`, 10000)
  ok('badge: Alerts shows the unseen count, in its accessible name', (await js(`document.querySelector('nav[aria-label="Main navigation"] [data-nav="alerts"] [data-nav-badge="new"]')?.dataset.count`)) === '3' && (await js(`document.querySelector('nav[aria-label="Main navigation"] [data-nav="alerts"]').getAttribute('aria-label')`)) === 'Alerts, 3 new alerts')
  await shot('feat1-badges-desktop')
  await openFeed(); await wait(600)
  ok('badge: visiting Alerts clears it; the page lists them as new', !(await js(`!!document.querySelector('[data-nav="alerts"] [data-nav-badge]')`)) && (await js(`document.querySelector('[data-feed-new]')?.innerText || ''`)).startsWith('3 new alerts since your last visit'))
  await navTo('Check'); await wait(400)
  ok('badge: and it stays cleared after leaving Alerts', !(await js(`!!document.querySelector('[data-nav="alerts"] [data-nav-badge]')`)))

  // Nav badge for the cabinet: medicines whose last check was flagged, read from the device.
  const item = (batch, state) => ({ id: 'b-' + batch, name: 'Med ' + batch, batch, expiry: null, note: '', addedAt: 1, last: { state, source: 'api', at: Date.now() } })
  await js(`localStorage.setItem('nazar:cabinet', ${JSON.stringify(JSON.stringify([item('SR-13', 'flagged'), item('AX-77', 'flagged'), item('AB-12', 'no_alert'), item('CD-34', 'unreadable')]))})`)
  await send('Page.reload'); await wait(1500); await settle()
  ok('badge: My cabinet shows 2 flagged medicines in red, in its accessible name', (await js(`document.querySelector('nav[aria-label="Main navigation"] [data-nav="cabinet"] [data-nav-badge="flagged"]')?.dataset.count`)) === '2' && (await js(`document.querySelector('nav[aria-label="Main navigation"] [data-nav="cabinet"]').getAttribute('aria-label')`)) === 'My cabinet, 2 medicines flagged' && (await js(`(() => { const c = getComputedStyle(document.querySelector('[data-nav="cabinet"] [data-nav-badge]')).backgroundColor.match(/[\\d.]+/g).map(Number); return c[0] > c[1] + 60 && c[0] > c[2] + 60 })()`)))
  await vp(360, 800, true); await js(`localStorage.setItem('theme', 'dark')`)
  await js(`(() => { const s = JSON.parse(localStorage.getItem('nazar:seen')); s.keys = s.keys.slice(12); localStorage.setItem('nazar:seen', JSON.stringify(s)); sessionStorage.clear() })()`)
  await send('Page.reload'); await wait(1500); await settle()
  await waitFor(`!!document.querySelector('nav[aria-label="Mobile navigation"] [data-nav="alerts"] [data-nav-badge]')`, 10000)
  {
    const bar = await js(`(() => { const nav = document.querySelector('nav[aria-label="Mobile navigation"]'); const tabs = [...nav.querySelectorAll('a')]; const r = (e) => e.getBoundingClientRect(); return { n: tabs.length, min: Math.min(...tabs.map(t => Math.min(r(t).width, r(t).height))), inside: [...nav.querySelectorAll('[data-nav-badge]')].every(b => { const p = r(b.closest('a')); const q = r(b); return q.left >= p.left && q.right <= p.right && q.top >= p.top && q.bottom <= p.bottom }), alerts: nav.querySelector('[data-nav="alerts"]').getAttribute('aria-label'), cab: nav.querySelector('[data-nav="cabinet"]').getAttribute('aria-label'), badges: [...nav.querySelectorAll('[data-nav-badge]')].map(b => b.dataset.count).join(), text: tabs.map(t => t.textContent.trim()).join() } })()`)
    ok('badge 360: five tabs, both badges inside their 44px+ tabs, named for screen readers', bar.n === 5 && bar.min >= 44 && bar.inside && bar.badges === '12,2' && bar.text === 'Check,Alerts,Cabinet,AI,More' && bar.alerts === 'Alerts, 12 new alerts' && bar.cab === 'My cabinet, 2 medicines flagged', JSON.stringify(bar))
    ok('badge 360: no horizontal overflow', (await js(`document.documentElement.scrollWidth`)) <= 360)
  }
  await shot('feat1-badges-360-dark')
  await js(`localStorage.removeItem('nazar:cabinet')`)
  await vp(1440, 1000, false); await js(`localStorage.setItem('theme', 'light')`)
}

// ---- More › Sources from the API (mock)
if (MODE === 'mock') {
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  await navTo('How it works'); await waitFor(`['api','static'].includes(document.querySelector('[data-sources-from]')?.dataset.sourcesFrom)`)
  ok('more: sources come live from GET /v1/sources', (await js(`document.querySelector('[data-sources-from]').dataset.sourcesFrom`)) === 'api' && (await js(`document.querySelectorAll('[data-source-row]').length`)) === 2)
  ok('more: API source shows its last run; disabled one its reason', (await js(`document.querySelector('[data-source-row="cdsco-online"]').innerText`)).includes('Last run 5 min ago') && (await js(`document.querySelector('[data-source-row="tg-dca"]').innerText`)).includes('refuses connections from outside India'))
  await waitFor(`document.querySelector('[data-stat="alerts"]')?.getAttribute('aria-busy') !== 'true'`, 8000)
  ok('more: hero reads its sources from the API and shows no alert count the API did not give', (await js(`document.querySelector('[data-stat="sources"]').innerText`)).includes('Live from the Nazar API') && (await js(`document.querySelector('[data-stat="sources"] [data-stat-value]').innerText`)) === '1' && !/\d/.test(await js(`document.querySelector('[data-stat="alerts"] [data-stat-value]').innerText`)))
}

// ---- Instant checks from the on-device snapshot (mock): answer at once, then the live API confirms.
if (MODE === 'mock') {
  mock.snapshot = true
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  ok('snapshot: loaded once the page is idle', await waitFor(`window.performance.getEntriesByType('resource').some(e => e.name.includes('/v1/snapshot'))`, 8000))
  await wait(800)
  mock.checkDelayMs = 1500
  // Enter, then watch every frame for the first answer and record how long it took.
  const timing = await js(`new Promise(resolve => {
    const i = document.getElementById('batch'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(i, 'SR-13'); i.dispatchEvent(new Event('input', { bubbles: true }))
    const t0 = performance.now(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    const tick = () => { const s = document.querySelector('section[data-state] [data-source]'); if (s) return resolve({ ms: Math.round(performance.now() - t0), source: s.dataset.source, state: s.closest('section[data-state]').dataset.state, confirming: !!document.querySelector('[data-confirming="true"] [role="status"]') }); if (performance.now() - t0 > 3000) return resolve(null); requestAnimationFrame(tick) }
    tick()
  })`)
  ok('snapshot: SR-13 answers instantly from the snapshot (< 250 ms, API still pending)', !!timing && timing.source === 'snapshot' && timing.state === 'flagged' && timing.ms < 250, JSON.stringify(timing))
  ok('snapshot: labelled "Instant · from the latest snapshot" with a confirming badge', !!timing?.confirming && (await js(`document.querySelector('section[data-state] [data-source]')?.innerText`)) === 'Instant · from the latest snapshot')
  await js(`window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value }).observe({ type: 'layout-shift' })`)
  await shot('mock-snapshot-instant', 0)
  ok('snapshot: the live API answer replaces it', await waitFor(`document.querySelector('section[data-state] [data-source]')?.dataset.source === 'api'`, 6000))
  await wait(400)
  const cls = await js('window.__cls')
  // The verdict, timeline and actions keep their place; only the proof block grows from "Not yet published"
  // to the full chain (entity keys are not in the snapshot), well under the 0.1 "good" CLS line.
  ok('snapshot: live answer lands with minimal layout shift (CLS < 0.05)', cls < 0.05, String(cls.toFixed?.(4) ?? cls))
  ok('snapshot: confirming badge is gone; proof now links the entity', !(await js(`!!document.querySelector('[data-confirming="true"]')`)) && (await js(`document.querySelector('section[data-state="flagged"] [data-onchain-proof]')?.dataset.onchainProof`)) === 'published')
  // On a phone the instant answer and the live one have the same shape: the card keeps its top and height
  // (the proof is one line either way, and the severity rule's line is held while it loads).
  await vp(390, 844, false); await typeBatch('AB1234'); await wait(300)
  const card = `(() => { const s = document.querySelector('section[data-state]'); if (!s) return null; const b = s.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), h: Math.round(b.height), src: s.querySelector('[data-source]')?.dataset.source, confirming: !!document.querySelector('[data-confirming="true"] [role="status"]') } })()`
  await js(`(() => { const i = document.getElementById('batch'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'SR-13'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
  await waitFor(`document.querySelector('section[data-state] [data-source]')?.dataset.source === 'snapshot'`, 3000); await wait(450)
  const instantBox = await js(card)
  await waitFor(`document.querySelector('section[data-state] [data-source]')?.dataset.source === 'api'`, 6000); await wait(500)
  const liveBox = await js(card)
  ok('snapshot 390: the card does not jump when the instant answer is confirmed live (same top and height)', !!instantBox && instantBox.confirming && !!liveBox && !liveBox.confirming && Math.abs(instantBox.top - liveBox.top) <= 1 && Math.abs(instantBox.h - liveBox.h) <= 1, `${JSON.stringify(instantBox)} -> ${JSON.stringify(liveBox)}`)
  await vp(1440, 1000, false)
  mock.checkDelayMs = 0

  // Offline: the snapshot (saved in IndexedDB) answers every state, and the app says it is offline.
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await wait(300)
  ok('offline: indicator shows "Offline · showing saved data"', await waitFor(`(document.querySelector('[data-offline-indicator]')?.innerText || '').includes('Offline · showing saved data')`, 3000))
  await typeBatch('SR-13')
  ok('offline: SR-13 flagged from the snapshot', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'flagged' && (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'snapshot')
  await typeBatch('5R-13')
  ok('offline: look-alike 5R-13 is "did you mean SR-13", never flagged', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'unreadable' && (await body()).includes('Did you mean'))
  await typeBatch('ZZ-404')
  ok('offline: unknown batch is no alert, from the snapshot', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'no_alert' && (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'snapshot')
  await shot('mock-offline-snapshot')
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await wait(300)
  ok('offline: indicator clears when back online', !(await js(`!!document.querySelector('[data-offline-indicator]')`)))

  // Every page load reads the snapshot once: the idle load, the Home lists and checks share one request.
  for (const path of ['', 'cabinet', 'arkiv']) {
    const from = requests.length
    await send('Page.navigate', { url: URL + path }); await wait(5000)
    const n = requests.slice(from).filter(u => u.includes('/v1/snapshot')).length
    ok(`network: /v1/snapshot is fetched once on the ${path || 'home'} page load`, n === 1, String(n))
  }
  // Home lists medicines only, even when the server ignores ?productClass (as this mock does).
  {
    const plain = mockResponse
    const extra = [{ ...MOCK_ALERTS[0], rid: 'r-kt', batch: 'KT-1', batchKey: 'kt1', brand: 'KT Kids Cleansing Shampoo', product: 'KT Kids Cleansing Shampoo', form: 'other', productClass: 'cosmetic', alertYm: 202511 }, { ...MOCK_ALERTS[0], rid: 'r-hr', batch: 'HR-9', batchKey: 'hr9', brand: 'Kids Hand Rub', product: 'Kids Hand Rub', generic: null, form: 'solution', alertYm: 202511 }]
    mockResponse = url => { const r = plain(url); return new globalThis.URL(url).pathname === '/v1/alerts' && r ? { items: [...extra, ...r.items], total: r.total + extra.length } : r }
    await js(`sessionStorage.clear()`); await send('Page.navigate', { url: URL }); await wait(1500); await settle(); await wait(500)
    const kids = await js(`[...document.querySelectorAll('[data-child-list] li')].map(l => l.innerText).join(' | ')`)
    const severe = await js(`[...document.querySelectorAll('[aria-label="High-severity alerts"] li')].map(l => l.innerText).join(' | ')`)
    ok('Child Shield: the list holds medicines only (no kids shampoo or hand rub)', kids.includes('COLDRIF') && !/shampoo|hand rub/i.test(kids), kids)
    ok('High-severity alerts: no cosmetics or hygiene products', severe.includes('COLDRIF') && !/shampoo|hand rub/i.test(severe), severe)
    ok('Home asks the API for medicines only', requests.some(u => u.includes('/v1/alerts') && u.includes('productClass=medicine')))
    await shot('mock-home-medicines-only')
    mockResponse = plain
  }
  // Leave no snapshot or cached lists behind for the blocks that follow.
  mock.snapshot = false
  await js(`new Promise(r => { const q = indexedDB.deleteDatabase('nazar'); q.onsuccess = q.onerror = q.onblocked = () => r(true) })`)
  await js(`sessionStorage.clear()`)
}

// ---- Arkiv throttled (mock): API down and every RPC call answered 429 with Retry-After.
if (MODE === 'mock') {
  mock.apiDown = true; mock.arkiv429 = true
  await vp(1440, 1000, false); await send('Page.navigate', { url: URL }); await wait(1200)
  await js(`localStorage.clear(); localStorage.setItem('theme', 'light'); localStorage.setItem('nazar:onboarded', '1')`)
  mock.arkivHits = 0
  await send('Page.reload'); await wait(6000); await settle()
  // Let any request already in flight on a slow machine land before taking the count.
  for (let prev = -1, t = Date.now(); prev !== mock.arkivHits && Date.now() - t < 20000;) { prev = mock.arkivHits; await wait(3000) }
  const hits = mock.arkivHits
  ok('429: page load sends at most 4 Arkiv requests and does not retry in a loop', hits >= 1 && hits <= 4, String(hits))
  ok('429: status pill says live sources are down and the saved copy answers (not demo data)', (await js(`document.querySelector('[data-status]')?.dataset.status`)) === 'offline' && /saved copy/.test(await js(`document.querySelector('[data-status]').getAttribute('aria-label')`)), await js(`document.querySelector('[data-status]')?.getAttribute('aria-label')`))
  ok("429: home lists fall back to Nazar's saved copy, not demo data", (await js(`document.querySelector('[aria-label="High-severity alerts"]')?.parentElement.querySelector('[data-source]')?.dataset.source`)) === 'snapshot')
  await typeBatch('SR-13')
  // On a loaded machine the first call can time out instead (a shorter network backoff), so the bound is on the whole phase.
  ok("429: checks during the backoff answer from the saved copy, no retry storm", (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'snapshot' && mock.arkivHits <= 4, `${hits} → ${mock.arkivHits}`)
  await openFeed()
  ok('429: feed during the backoff uses the saved copy, no retry storm', (await js(`document.querySelector('[data-feed]').dataset.feedSource`)) === 'snapshot' && mock.arkivHits <= 4, `${hits} → ${mock.arkivHits}`)
  mock.apiDown = false; mock.arkiv429 = false
}

// ======== Strip Scan: camera scanner (fallback mode). Self-contained block; uses only the shared helpers above. ========
if (MODE === 'fallback') {
  const SCAN_FIXTURE = decodeURIComponent(new globalThis.URL('./fixtures/scan-gs1-qr.png', import.meta.url).pathname)
  const SCAN_PNG = 'data:image/png;base64,' + fs.readFileSync(SCAN_FIXTURE).toString('base64')
  const ORIGIN = new globalThis.URL(URL).origin
  const scanPhase = () => js(`document.querySelector('[data-scanner]')?.dataset.phase || null`)
  const scanText = () => js(`document.querySelector('[data-scanner]')?.innerText || ''`)
  const openScanner = async () => { await js(`document.querySelector('[aria-label="Scan the pack"]').click()`); await waitFor(`!!document.querySelector('[data-scanner]')`, 5000); await wait(500) }
  const setScanFile = async file => {
    const doc = await send('DOM.getDocument', { depth: -1, pierce: true })
    const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[data-scan-upload]' })
    return send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] })
  }
  /** Replaces the camera with a canvas stream that shows the QR fixture (or a blank card), and records every track. */
  const fakeCamera = withQr => js(`(() => {
    window.__scanTracks = []
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 480
      const ctx = c.getContext('2d'); const img = new Image(); img.src = ${JSON.stringify(SCAN_PNG)}; await img.decode()
      const draw = () => { ctx.fillStyle = '#f4efe6'; ctx.fillRect(0, 0, 640, 480); if (${withQr}) ctx.drawImage(img, 209, 129) }
      draw(); setInterval(draw, 100)
      const s = c.captureStream(15); window.__scanTracks.push(...s.getTracks()); return s
    }
    return true
  })()`)
  const tracksState = () => js(`(window.__scanTracks || []).map(t => t.readyState).join(',')`)

  await vp(360, 800, true); await fresh(true); await click('Skip'); await wait(600)
  await openScanner()
  ok('scan: scan button opens the scanner as a modal dialog', (await js(`document.querySelector('[data-scanner]')?.getAttribute('role')`)) === 'dialog')
  const st = await scanText()
  ok('scan: before any permission, explains the camera and offers Use camera, upload and type', (await scanPhase()) === 'prompt' && st.includes('Use camera') && st.includes('Upload a photo of the pack') && st.includes('Type it instead'), String(await scanPhase()))
  ok('scan: says images never leave the device', st.includes('Images are read on this device and never leave it'))
  ok('scan: full screen at 360 with no horizontal scroll', (await js(`(() => { const d = document.querySelector('[data-scanner]'); const r = d.getBoundingClientRect(); return r.width === 360 && d.scrollWidth <= d.clientWidth + 1 })()`)))
  const minBtn = await js(`Math.min(...[...document.querySelectorAll('[data-scanner] button')].map(b => Math.round(Math.min(b.getBoundingClientRect().height, b.getBoundingClientRect().width))))`)
  ok('scan: every scanner button is at least 48px', minBtn >= 48, String(minBtn))
  ok('scan: focus is trapped inside the scanner', await js(`document.querySelector('[data-scanner]').contains(document.activeElement)`))
  await shot('scan-360-dark-prompt')

  await setScanFile(SCAN_FIXTURE)
  await waitFor(`!!document.querySelector('[data-scan-result]')`, 20000)
  ok('scan: uploaded QR photo is decoded on the device (GS1 Digital Link → SR-13)', (await js(`document.getElementById('scan-batch')?.value`)) === 'SR-13' && (await scanText()).includes('We read SR-13 – check it?'), await scanText())
  ok('scan: shows expiry from GS1 (17) and how it was read', (await js(`document.querySelector('[data-scan-expiry]')?.innerText || ''`)).includes('Exp 30 Apr 2027') && (await scanText()).includes('QR code · GS1') && (await scanText()).includes('High confidence'))
  ok('scan: live region announces the read', (await js(`document.querySelector('[data-scan-announce]')?.textContent`)) === 'Read batch SR-13 from the QR code. Check it?')
  ok('scan: does not auto-check; waits for confirmation', !(await body()).includes('This batch failed a government quality test'))
  ok('scan: image was not uploaded anywhere', !requests.some(u => /^https?:/.test(u) && !u.startsWith(ORIGIN) && !u.includes('cdn.jsdelivr.net') && !u.startsWith('https://rpc.tiramisu') && !u.startsWith('http://localhost:8787')), requests.filter(u => !u.startsWith(ORIGIN)).slice(-5).join(' '))
  await shot('scan-360-dark-read')
  await js(`[...document.querySelectorAll('[data-scanner] button')].find(b => b.textContent.trim().startsWith('Check'))?.click()`)
  await wait(500); await waitIdle(); await wait(400)
  ok('scan: confirming closes the scanner and runs the normal check (SR-13 flagged)', !(await scanPhase()) && (await body()).includes('This batch failed a government quality test') && (await js(`document.getElementById('batch').value`)) === 'SR-13')

  await openScanner(); await clickHas('Type it instead'); await wait(700)
  ok('scan: Type it instead closes the scanner and focuses the batch input', !(await scanPhase()) && (await js(`document.activeElement?.id`)) === 'batch')
  await js(`document.activeElement.blur()`)

  // Live camera path with a fake stream; permission granted so the scanner starts straight away.
  await send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['videoCapture'] })
  await fakeCamera(false); await openScanner()
  await waitFor(`document.querySelector('[data-scanner]')?.dataset.phase === 'live'`, 5000); await wait(600)
  ok('scan: with permission, the camera starts and shows the viewfinder', (await scanPhase()) === 'live' && (await tracksState()) === 'live' && (await js(`!!document.querySelector('[data-scan-video]')?.srcObject`)))
  await shot('scan-360-dark-live')
  ok('scan: viewfinder status reads aloud (role=status)', (await js(`document.querySelector('[data-scanner] [role="status"]')?.innerText || ''`)).includes('Looking for a QR code'))
  await escape()
  ok('scan: Escape closes the scanner and stops the camera (no lingering light)', !(await scanPhase()) && (await tracksState()) === 'ended', await tracksState())

  await fakeCamera(true); await openScanner()
  await waitFor(`!!document.querySelector('[data-scan-result]')`, 15000)
  ok('scan: live camera reads the QR by majority vote over frames', (await js(`document.getElementById('scan-batch')?.value`)) === 'SR-13' && /\d of \d frames agree/.test(await scanText()), await scanText())
  ok('scan: camera stops once a batch is read', (await tracksState()) === 'ended', await tracksState())
  await escape()
  await send('Browser.resetPermissions')

  await send('Browser.setPermission', { origin: ORIGIN, permission: { name: 'camera' }, setting: 'denied' })
  await openScanner(); await waitFor(`!!document.querySelector('[data-blocked]')`, 5000)
  ok('scan: camera blocked → instructions to allow it, upload still offered', (await js(`document.querySelector('[data-blocked]')?.dataset.blocked`)) === 'denied' && (await scanText()).includes('Website Settings → Camera → Allow') && (await scanText()).includes('Upload a photo of the pack'))
  await shot('scan-360-dark-denied')
  await escape()
  await send('Browser.resetPermissions')

  // Printed label without a code: OCR fallback (tesseract.js downloads its engine and English model once).
  const labelPng = await js(`(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 360; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 360); x.fillStyle = '#111'; x.font = 'bold 44px Arial'; x.fillText('ReLife Syrup 100 ml', 40, 80); x.font = '40px Arial'; x.fillText('B.No.: LSL25160', 40, 170); x.fillText('Mfg: 01/2025   Exp: 12/2026', 40, 250); return c.toDataURL('image/png') })()`)
  const labelFile = OUT + '/scan-label-fixture.png'; fs.writeFileSync(labelFile, Buffer.from(labelPng.split(',')[1], 'base64'))
  await openScanner(); await setScanFile(labelFile)
  await waitFor(`!!document.querySelector('[data-scan-result]') || document.querySelector('[data-scanner]')?.dataset.phase === 'empty'`, 60000)
  ok('scan: printed label photo is read by OCR on the device (LSL25160, Exp Dec 2026)', (await js(`document.getElementById('scan-batch')?.value`)) === 'LSL25160' && (await scanText()).includes('Printed text') && (await scanText()).includes('Exp Dec 2026'), await scanText())
  await shot('scan-360-dark-ocr')
  await escape()

  // QR says SR-13 but the printed label says SR-14: warn, never auto-check.
  const mixPng = await js(`(async () => { const img = new Image(); img.src = ${JSON.stringify(SCAN_PNG)}; await img.decode(); const c = document.createElement('canvas'); c.width = 1000; c.height = 420; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 420); x.drawImage(img, 30, 100); x.fillStyle = '#111'; x.font = '42px Arial'; x.fillText('B.No.: SR-14', 320, 190); x.fillText('Exp: 04/2027', 320, 270); return c.toDataURL('image/png') })()`)
  const mixFile = OUT + '/scan-mismatch-fixture.png'; fs.writeFileSync(mixFile, Buffer.from(mixPng.split(',')[1], 'base64'))
  await openScanner(); await setScanFile(mixFile)
  await waitFor(`document.querySelector('[data-scan-result]')?.dataset.scanResult === 'mismatch'`, 30000)
  ok('scan: QR and printed batch disagree → mismatch warning, no auto-check', (await scanText()).includes("Label details don't match. Show this pack to your chemist.") && (await scanText()).includes('SR-14') && (await scanPhase()) === 'result', await scanText())
  await shot('scan-360-dark-mismatch')
  await escape()

  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  await openScanner()
  ok('scan: centred dialog on desktop', (await js(`(() => { const r = document.querySelector('[data-scanner]').getBoundingClientRect(); return r.width <= 560 && Math.abs(r.left + r.width / 2 - 720) < 2 })()`)))
  await setScanFile(SCAN_FIXTURE); await waitFor(`!!document.querySelector('[data-scan-result]')`, 20000)
  await shot('scan-desktop-read')
  await escape()
  ok('scan: Escape closes on desktop', !(await scanPhase()))
}
// ======== end Strip Scan ========

// ======== Arkiv directory (/arkiv). Self-contained block; uses only the shared helpers above. ========
const ARKIV_BLOCK = '727733'
const ARKIV_SHOTS = process.env.ARKIV_SHOTS || ''
const hexOf = (s, n = 64) => '0x' + [...s].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(n, '0').slice(0, n)
const NOTICE_KEYS = ['tn-aug', 'cdsco-aug', 'mh-oct'].map(s => hexOf('notice:' + s))
const tAttr = (name, type, value) => ({ name, type, value })
const ARKIV_ALERTS = Array.from({ length: 30 }, (_, i) => {
  const src = i % 3 === 0 ? 'tn-dc' : 'cdsco-online'
  const sev = 1 + (i % 5)
  const batch = 'AK' + String(1000 + i)
  return {
    key: hexOf('alert:' + i), type: 'alert', creator: BUILD_PUBLISHER, owner: BUILD_PUBLISHER,
    createdAtBlock: '727143', expiresAtBlock: '4615143', expiresAtEstimate: '2027-01-16T06:14:13.493Z',
    flags: { readonly: true, permissionlessExtension: true },
    attributes: [
      tAttr('alert_ym', 'i32', 202608), tAttr('batch', 'str', batch.toLowerCase()), tAttr('batch_raw', 'str', batch), tAttr('brand', 'str', 'paracip-' + i),
      tAttr('cat', 'str', i === 4 ? 'spurious' : 'nsq'), tAttr('exp_ym', 'i32', 202712), tAttr('fail', 'str', 'assay'), tAttr('form', 'str', 'tablet'),
      tAttr('notice', 'key', NOTICE_KEYS[i % 3 === 0 ? 0 : 1]), tAttr('peds', 'i32', i % 7 === 0 ? 1 : 0), tAttr('project', 'str', 'nazar-in-batch-alerts'),
      tAttr('sev', 'i32', sev), tAttr('src', 'str', src), tAttr('state', 'str', i % 2 ? 'IN-HP' : 'IN-GJ'), tAttr('t', 'str', 'alert'), tAttr('v', 'i32', 1),
    ],
    payload: { product: `Paracip ${i} Tablets IP 500 mg`, manufacturer: 'Example Pharma Pvt Ltd, Baddi 173205', reason: 'Assay of paracetamol 82%', failures: ['assay'], severityRules: ['Assay failure: base 3'], noticeTitle: src === 'tn-dc' ? 'TN NSQ list, August 2026' : 'CDSCO NSQ, August 2026' },
  }
})
const ARKIV_NOTICES = NOTICE_KEYS.map((key, i) => ({
  key, type: 'notice', creator: BUILD_PUBLISHER, owner: BUILD_PUBLISHER, createdAtBlock: '727100', expiresAtBlock: '79565418', expiresAtEstimate: '2031-10-17T00:00:00.000Z',
  flags: { readonly: true, permissionlessExtension: false },
  attributes: [tAttr('notice_ym', 'i32', [202608, 202608, 202610][i]), tAttr('project', 'str', 'nazar-in-batch-alerts'), tAttr('rows', 'i32', [10, 20, 193][i]), tAttr('sha', 'str', 'ab'.repeat(32)), tAttr('src', 'str', ['tn-dc', 'cdsco-online', 'mh-fda'][i]), tAttr('t', 'str', 'notice'), tAttr('v', 'i32', 1)],
  payload: { title: ['TN NSQ list, August 2026', 'CDSCO Not of Standard Quality drugs reported in Aug 2026', 'Maharashtra FDA NSQ alerts (as of 2026-10-17)'][i], authority: 'Regulator', url: 'https://example.gov.in/notice.pdf', sha256: 'ab'.repeat(32) },
}))
const ARKIV_BEAT = { key: hexOf('beat'), type: 'heartbeat', creator: BUILD_PUBLISHER, owner: BUILD_PUBLISHER, createdAtBlock: '726146', expiresAtBlock: '728221', expiresAtEstimate: new Date(Date.now() + 15 * 60_000).toISOString(), flags: { readonly: false, permissionlessExtension: false }, attributes: [tAttr('last_ok', 'u64', String(Date.now() - 4 * 60_000)), tAttr('project', 'str', 'nazar-in-batch-alerts'), tAttr('t', 'str', 'heartbeat'), tAttr('v', 'i32', 1), tAttr('worker', 'str', 'nazar')], payload: { worker: 'nazar', alerts: 1404 } }
const ARKIV_SUMMARY = {
  publisher: BUILD_PUBLISHER, project: 'nazar-in-batch-alerts', generatedAt: new Date(Date.now() - 2 * 60_000).toISOString(), generatedAtBlock: ARKIV_BLOCK, latestBlock: ARKIV_BLOCK, stale: false, error: null,
  entities: { alert: 1404, notice: 21, retraction: 0, heartbeat: 1, snapshot: 0 },
  alerts: { total: 1404, bySrc: { 'cdsco-online': 813, 'cdsco-pdf': 321, 'mh-fda': 162, 'tn-dc': 102, curated: 3, 'who-mpa': 3 }, byState: { 'IN-HP': 387, 'IN-UK': 179, unknown: 158, 'IN-GJ': 134, 'IN-MP': 90, 'IN-MH': 67, 'IN-HR': 59, 'IN-TN': 51 }, byCat: { nsq: 1337, misbranded: 36, spurious: 25, adulterated: 6 }, bySev: { 1: 154, 2: 593, 3: 427, 4: 111, 5: 119 }, byForm: { tablet: 679, other: 176, injection: 138, syrup: 87, capsule: 87, suspension: 79 }, byFail: { assay: 415 }, peds: 19, inDate: 1149 },
  notices: [], heartbeat: { key: ARKIV_BEAT.key, lastOkMs: Date.now() - 4 * 60_000, expiresAtBlock: '728221', expiresAtEstimate: null },
}
const arkivCalls = []
const aval = (e, n) => e.attributes.find(a => a.name === n)?.value
function arkivMock(u) {
  arkivCalls.push(u.pathname + u.search)
  if (u.pathname === '/v1/arkiv/summary') return ARKIV_SUMMARY
  if (u.pathname !== '/v1/arkiv/entities') return null
  const q = u.searchParams
  const type = q.get('type') || 'alert'
  let all = type === 'notice' ? ARKIV_NOTICES : type === 'heartbeat' ? [ARKIV_BEAT] : ARKIV_ALERTS
  for (const k of ['src', 'state', 'cat', 'form', 'fail', 'notice']) if (q.get(k)) all = all.filter(e => String(aval(e, k)) === q.get(k))
  if (q.get('sevMin')) all = all.filter(e => aval(e, 'sev') >= Number(q.get('sevMin')))
  if (q.get('sevMax')) all = all.filter(e => aval(e, 'sev') <= Number(q.get('sevMax')))
  if (q.get('peds')) all = all.filter(e => aval(e, 'peds') === Number(q.get('peds')))
  if (q.get('noticeYm')) all = all.filter(e => aval(e, 'notice_ym') === Number(q.get('noticeYm')))
  const limit = Number(q.get('limit') || 25)
  const cursor = q.get('cursor'); const offset = cursor ? Number(cursor.slice(2)) : 0
  if (cursor && q.get('block') !== ARKIV_BLOCK) return { items: [], cursor: null, block: 'UNPINNED' }
  return { items: all.slice(offset, offset + limit), cursor: offset + limit < all.length ? 'c:' + (offset + limit) : null, block: ARKIV_BLOCK, query: { string: '', sdk: '' } }
}

const ARKIV_URL = new globalThis.URL('/arkiv', URL).href
const arkivShot = async name => { await shot('arkiv-' + name); if (ARKIV_SHOTS) { fs.mkdirSync(ARKIV_SHOTS, { recursive: true }); fs.copyFileSync(`${OUT}/arkiv-${name}.png`, `${ARKIV_SHOTS}/${MODE}-${name}.png`) } }
const openArkiv = async (dark = false, search = '') => {
  await send('Page.navigate', { url: URL }); await wait(1000)
  await js(`localStorage.clear(); localStorage.setItem('theme', '${dark ? 'dark' : 'light'}'); localStorage.setItem('nazar:onboarded', '1')`)
  await send('Page.navigate', { url: ARKIV_URL + search }); await wait(800)
}
const resultsKind = () => js(`document.querySelector('[data-results]')?.dataset.results || null`)
const arkivIdle = async () => { await wait(450); return waitFor(`['ok','error'].includes(document.querySelector('[data-results]')?.dataset.results)`, 25000) }
const arkivRows = () => js(`document.querySelectorAll('[data-entity-row]').length`)
const arkivQuery = () => js(`document.querySelector('[data-query-panel]')?.dataset.query || ''`)
const setField = async (id, v, proto = 'HTMLSelectElement', ev = 'change') => { await js(`(() => { const s = document.getElementById(${JSON.stringify(id)}); const set = Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set; set.call(s, ${JSON.stringify(v)}); s.dispatchEvent(new Event(${JSON.stringify(ev)}, { bubbles: true })) })()`); await arkivIdle() }
const noHScroll = () => js(`document.documentElement.scrollWidth <= window.innerWidth + 1`)
const HERO = `document.querySelector('[data-arkiv-hero] .sh-root')`
/** The particle hero renders only while on screen: scrolled away it is paused and draws no frames. */
const heroPauseCheck = async (label) => {
  await waitFor(`['on', 'off'].includes(${HERO}?.dataset.gl) || ${HERO}?.dataset.loop === 'paused'`, 10000)
  const gl = await js(`${HERO}?.dataset.gl || 'pending'`)
  if (gl === 'off') { ok(`${label}: no fast WebGL here, so the still mark shows and no loop runs`, (await js(`${HERO}.dataset.loop`)) === 'off' && !!(await js(`${HERO}.dataset.glReason`)), await js(`${HERO}.dataset.glReason`)); return }
  await js(`document.getElementById('arkiv-results').scrollIntoView()`); await wait(700)
  const f0 = await js(`${HERO}.sculptureFrames`)
  await js(`window.__rafN = 0; window.__rafOrig ||= window.requestAnimationFrame; window.requestAnimationFrame = (cb) => { window.__rafN++; return window.__rafOrig.call(window, cb) }`)
  await wait(1500)
  const f1 = await js(`${HERO}.sculptureFrames`); const rafN = await js(`window.__rafN`)
  ok(`${label}: hero loop pauses off screen (no frames, no rAF)`, (await js(`${HERO}.dataset.loop`)) === 'paused' && f0 === f1 && rafN === 0, `loop=${await js(`${HERO}.dataset.loop`)} frames ${f0}→${f1} rAF ${rafN}`)
  await js(`window.scrollTo(0, 0)`); await wait(400)
  const box = await js(`(() => { const r = ${HERO}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.3 } })()`)
  for (let i = 0; i < 6; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x - 60 + i * 20, y: box.y + i * 4 })
  await wait(300)
  const f2 = await js(`${HERO}.sculptureFrames`)
  ok(`${label}: back on screen, the hero renders again on pointer movement`, f2 > f1, `frames ${f1}→${f2}`)
  await js(`window.requestAnimationFrame = window.__rafOrig`)
}

if (MODE === 'mock') {
  const base = mockResponse
  // Route /v1/arkiv/* through the directory fixtures; everything else keeps the existing mock contract.
  mockResponse = url => { const u = new globalThis.URL(url); return u.pathname.startsWith('/v1/arkiv/') ? arkivMock(u) : base(url) }

  await vp(1440, 1000, false); await openArkiv()
  await waitFor(`document.querySelector('[data-overview]')?.dataset.overview === 'ready'`, 20000); await arkivIdle()
  ok('arkiv: overview renders live counts from GET /v1/arkiv/summary', (await js(`document.querySelector('[data-count="alert"]')?.innerText`)) === '1,404' && (await js(`document.querySelector('[data-count="notice"]')?.innerText`)) === '21' && (await js(`document.querySelector('[data-count="peds"]')?.innerText`)) === '19')
  ok('arkiv: header shows publisher, project tag, latest block and Live', (await js(`document.querySelector('[data-arkiv-header] [data-publisher]')?.innerText`)) === BUILD_PUBLISHER && (await js(`document.querySelector('[data-latest-block]')?.innerText`)) === '#727733' && (await js(`document.querySelector('[data-live]')?.dataset.live`)) === 'live')
  ok('arkiv: nav rail has On-chain marked current', (await js(`[...document.querySelectorAll('nav[aria-label="Main navigation"] a[aria-current="page"]')].map(a => a.dataset.label).join()`)) === 'On-chain')
  ok('arkiv: first page of alerts via the API (25 rows)', (await arkivRows()) === 25 && (await resultsKind()) === 'ok')
  ok('arkiv: overview says what it counts (entities at a block) and why it can exceed the alert count', (await js(`document.querySelector('[data-entities-caption]')?.innerText.replace(/\\s+/g, ' ').trim()`)) === 'Entities on Arkiv · at block #727733' && /merges a duplicate.*read-only/.test(await js(`document.querySelector('[data-count-note]')?.innerText || ''`)))
  {
    const row = await js(`document.querySelector('[data-entity-row]')?.innerText || ''`)
    ok('arkiv: rows label the two expiries apart (batch expiry vs life on Arkiv)', row.includes('Batch expiry Dec 2027') && row.includes('On Arkiv until ~Jan 2027') && !/\bexp Dec|expires ~/.test(row), row.replace(/\n/g, ' | '))
    ok('arkiv: category chips are plain words, not raw tags', row.includes('Not of standard quality') && !/\bnsq\b/.test(row))
  }
  ok('arkiv: type-tab counts and filter key hints use muted text, no opacity', (await js(`[...document.querySelectorAll('[data-type-tab] span.font-mono, [data-filter-panel] label code, [data-filter-panel] legend code')].every(e => !/opacity-/.test(e.className))`)))
  {
    const small = await js(`[...document.querySelectorAll('[aria-label="Refresh counts"], [data-arkiv-directory] button[aria-label^="Copy"], [data-arkiv-directory] a[aria-label^="Open"], [data-arkiv-hero] .sh-credit, [data-arkiv-hero] .sh-txt')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label') || e.textContent.trim(), Math.round(r.width), Math.round(r.height)] }).filter(([, w, h]) => w < 44 || h < 44)`)
    ok('arkiv: refresh, copy, explorer, "See the query" and the credit are 44px targets', small.length === 0, JSON.stringify(small))
  }
  ok('arkiv: hero credit stays visible and links to its author', await js(`(() => { const a = document.querySelector('[data-arkiv-hero] .sh-credit'); return !!a && a.href.startsWith('https://guglielmogiannattasio.it') && a.offsetParent !== null && getComputedStyle(a).opacity > 0.5 })()`))
  ok('arkiv: desktop hint reads "Move across the mark"', (await js(`(() => { const m = document.querySelector('[data-sh-hint] .sh-hint-mouse'); return m && getComputedStyle(m).display !== 'none' ? m.textContent : '' })()`)) === 'Move across the mark')
  await heroPauseCheck('arkiv')
  const q0 = await arkivQuery()
  ok('arkiv: query string pins project, type and publisher', q0 === `project = str('nazar-in-batch-alerts') AND t = str('alert') AND $creator = addr(${BUILD_PUBLISHER})`, q0)
  await arkivShot('desktop-overview')

  await setField('f-src', 'tn-dc')
  const q1 = await arkivQuery()
  ok('arkiv: source filter updates the query string, the URL and the API call', q1.includes("t = str('alert') AND src = str('tn-dc') AND $creator") && (await js('location.search')) === '?src=tn-dc' && arkivCalls.at(-1).includes('src=tn-dc') && (await arkivRows()) === 10, `${q1} | ${arkivCalls.at(-1)}`)
  await js(`[...document.querySelectorAll('[data-overview] button')].find(b => b.getAttribute('aria-label')?.startsWith('Severity 4'))?.click()`); await arkivIdle()
  ok('arkiv: clicking a severity tile applies sev = i32(4)', (await arkivQuery()).includes('sev = i32(4)') && (await js('location.search')).includes('sevMin=4&sevMax=4') && (await js(`[...document.querySelectorAll('[data-entity-row]')].every(r => r.innerText.trim().startsWith('4'))`)))
  await js(`document.getElementById('f-in-date').click()`); await arkivIdle()
  ok('arkiv: "still in date" adds exp_ym >= this month', /exp_ym >= i32\(\d{6}\)/.test(await arkivQuery()) && (await js('location.search')).includes('inDate=1') && /expFrom=\d{6}/.test(arkivCalls.at(-1)))
  await js(`document.querySelector('[data-query-panel] [role="tab"]#qtab-sdk').click()`); await wait(200)
  ok('arkiv: SDK snippet mirrors the filters', (await js(`document.querySelector('[data-sdk-snippet]')?.innerText || ''`)).includes("eq('src', str('tn-dc')),") && (await js(`document.querySelector('[data-sdk-snippet]').innerText`)).includes('.atBlock(page.blockNumber).cursor(page.cursor)'))
  await js(`document.getElementById('arkiv-results').scrollIntoView()`); await wait(300)
  await arkivShot('desktop-filtered')
  await js(`document.querySelector('#qtab-query').click()`)

  await clickHas('Reset'); await arkivIdle()
  ok('arkiv: Reset clears filters and the URL', (await js('location.search')) === '' && (await arkivRows()) === 25)
  await js(`document.querySelector('[data-load-more]').click()`); await waitFor(`document.querySelectorAll('[data-entity-row]').length === 30`, 10000)
  ok('arkiv: Load more fetches the next cursor page pinned to its block', (await arkivRows()) === 30 && arkivCalls.at(-1).includes('cursor=c%3A25') && arkivCalls.at(-1).includes('block=' + ARKIV_BLOCK) && !(await js(`!!document.querySelector('[data-load-more]')`)))

  await js(`document.querySelector('[data-entity-row] button').click()`); await waitFor(`!!document.querySelector('[data-entity-drawer]')`); await wait(700)
  const attrsText = await js(`document.querySelector('[data-entity-attributes]')?.innerText || ''`)
  const payloadText = await js(`document.querySelector('[data-entity-payload]')?.innerText || ''`)
  ok('arkiv: drawer shows typed attributes vs JSON payload', /batch\s+str\s+ak1000/.test(attrsText) && /sev\s+i32\s+1/.test(attrsText) && /notice\s+key\s+0x/.test(attrsText) && payloadText.includes('"product": "Paracip 0 Tablets IP 500 mg"') && !attrsText.includes('Paracip 0 Tablets'), attrsText.slice(0, 120))
  ok('arkiv: drawer shows flags and the creator check', (await js(`document.querySelector('[data-entity-flags]').innerText`)).includes('Official Nazar publisher') && (await js(`document.querySelector('[data-entity-flags]').innerText`)).includes('Read-only') && (await js(`document.querySelector('[data-entity-flags]').innerText`)).includes('Anyone can keep alive'))
  ok('arkiv: drawer links the entity to the explorer', (await js(`document.querySelector('[data-entity-drawer] a[href*="/entity/"]')?.href || ''`)) === `https://tiramisu.explorer.arkiv.network/entity/${ARKIV_ALERTS[0].key}`)
  await arkivShot('desktop-drawer')
  ok('arkiv: drawer title is product and batch, the entity hash below it', (await js(`document.querySelector('[data-entity-title]')?.innerText`)) === 'Paracip 0 Tablets IP 500 mg · Batch AK1000' && /^0x616c65…[0-9a-f]{6}$/.test(await js(`document.querySelector('[data-entity-hash]')?.innerText || ''`)), await js(`document.querySelector('[data-entity-hash]')?.innerText`))
  await escape()
  ok('arkiv: Escape closes the drawer', !(await js(`!!document.querySelector('[data-entity-drawer]')`)))
  ok('arkiv: closing the drawer puts focus back on the row that opened it', (await js(`document.activeElement?.closest('[data-entity-row]')?.dataset.entityRow || document.activeElement?.tagName`)) === ARKIV_ALERTS[0].key, await js(`document.activeElement?.tagName`))

  await js(`document.querySelector('[data-type-tab="notice"]').click()`); await arkivIdle()
  ok('arkiv: Notices tab lists notices with t = notice', (await arkivRows()) === 3 && (await arkivQuery()).includes("t = str('notice')") && (await js('location.search')) === '?type=notice')
  ok('arkiv: loaded rows are listed newest first (Oct 2026 notice before Aug)', (await js(`document.querySelector('[data-entity-row]')?.dataset.entityRow`)) === NOTICE_KEYS[2])
  await js(`document.querySelector('[data-entity-row="${NOTICE_KEYS[0]}"] button').click()`); await waitFor(`!!document.querySelector('[data-notice-alerts]')`); await wait(500)
  await js(`document.querySelector('[data-notice-alerts]').click()`); await wait(600); await arkivIdle()
  ok("arkiv: a notice's alerts are one click away (notice = key(...))", (await arkivQuery()).includes(`notice = key(${NOTICE_KEYS[0]})`) && (await js('location.search')).includes('notice=' + NOTICE_KEYS[0]) && (await arkivRows()) === 10)
  await js(`document.querySelector('[data-type-tab="heartbeat"]').click()`); await arkivIdle()
  ok('arkiv: Heartbeat tab shows the lease', (await arkivRows()) === 1 && (await js(`document.querySelector('[data-entity-row]').innerText`)).includes('last ok 4 min ago'))

  // Browser mode against a throttled RPC: a clear rate-limit state, not a crash or a loop.
  mock.arkiv429 = true; mock.arkivHits = 0
  await js(`document.querySelector('[data-type-tab="alert"]').click()`); await arkivIdle()
  await js(`document.querySelector('[data-mode="browser"]').click()`); await arkivIdle()
  ok('arkiv: browser mode sends the query to Arkiv itself (URL via=browser)', (await js('location.search')).includes('via=browser') && (await js(`document.querySelector('[data-mode-note]').innerText`)).includes('public Arkiv RPC'))
  ok('arkiv: a 429 from Arkiv shows the rate-limit state', (await resultsKind()) === 'error' && (await js(`document.querySelector('[data-results-error]')?.dataset.resultsError`)) === 'throttled' && mock.arkivHits <= 2, String(mock.arkivHits))
  const waitText = await js(`document.querySelector('[data-results-error]')?.innerText || ''`)
  ok('arkiv: the retry wait reads in minutes (Retry-After 120 → about 2 min), never raw seconds', waitText.includes('Try again in about 2 min.') && !/\d+ s\b/.test(waitText), waitText)
  mock.arkiv429 = false
  await js(`document.querySelector('[data-mode="api"]').click()`); await arkivIdle()
  ok('arkiv: back to the API mode', (await arkivRows()) === 25 && !(await js('location.search')).includes('via='))

  // Phone, dark: five-item bottom nav, Arkiv reachable from More, no sideways scroll.
  await vp(360, 780, true); await openArkiv(true, '?sevMin=5&sevMax=5')
  await waitFor(`document.querySelector('[data-overview]')?.dataset.overview === 'ready'`, 20000); await arkivIdle()
  ok('arkiv 360: filters restored from the URL', (await arkivQuery()).includes('sev = i32(5)') && (await js(`document.getElementById('f-sev-min').value`)) === '5')
  ok('arkiv 360: no horizontal scroll', await noHScroll(), String(await js('document.documentElement.scrollWidth')))
  ok('arkiv 360: bottom nav has five items (Arkiv stays in More)', (await js(`[...document.querySelectorAll('nav[aria-label="Mobile navigation"] a')].map(a => a.textContent.trim()).join()`)) === 'Check,Alerts,Cabinet,AI,More')
  const firstRowY = await js(`Math.round(document.querySelector('[data-entity-row]').getBoundingClientRect().top + scrollY)`)
  ok('arkiv 360: filters and the query fold away on phones, with a jump link to the entities', (await js(`document.querySelector('[data-filter-toggle]')?.getAttribute('aria-expanded')`)) === 'false' && (await js(`document.getElementById('f-sev-min').offsetParent === null && document.querySelector('[data-query-toggle]')?.getAttribute('aria-expanded') === 'false' && !!document.querySelector('[data-jump-entities]')?.offsetParent`)), 'first entity at ' + firstRowY + 'px')
  ok('arkiv 360: the first screen has a one-tap way to the entities (hero "Browse entities")', await js(`(() => { const a = [...document.querySelectorAll('[data-arkiv-hero] a')].find(x => x.textContent.includes('Browse entities')); if (!a) return false; const r = a.getBoundingClientRect(); return a.getAttribute('href') === '#arkiv-results' && r.top + scrollY < 780 && r.height >= 44 })()`))
  ok('arkiv 360: hero headline and the three-step explainer render', await js(`(() => { const h = document.querySelector('[data-arkiv-hero]'); return !!h && /Every alert/.test(h.innerText) && h.querySelectorAll('ol li').length === 3 })()`))
  ok('arkiv 360: the four breakdowns fold behind "See breakdowns"; tiles and severity stay', (await js(`document.querySelector('[data-breakdowns]').offsetParent === null && document.querySelector('[data-breakdown-toggle]')?.getAttribute('aria-expanded') === 'false' && /See breakdowns/.test(document.querySelector('[data-breakdown-toggle]').innerText)`)) && (await js(`!!document.querySelector('[data-count="alert"]').offsetParent && !!document.getElementById('ov-sev').offsetParent`)))
  await js(`document.querySelector('[data-breakdown-toggle]').click()`); await wait(300)
  ok('arkiv 360: "See breakdowns" opens them', (await js(`document.querySelector('[data-breakdowns]').offsetParent !== null && document.querySelectorAll('[data-breakdown]').length === 4 && document.querySelector('[data-breakdown-toggle]').getAttribute('aria-expanded') === 'true'`)))
  await js(`document.querySelector('[data-breakdown-toggle]').click()`); await wait(200)
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await wait(200)
  ok('arkiv 360: on a touch screen the hint says "Drag across the mark", never "Move across"', (await js(`(() => { const t = document.querySelector('[data-sh-hint] .sh-hint-touch'), m = document.querySelector('[data-sh-hint] .sh-hint-mouse'); return t && getComputedStyle(t).display !== 'none' && getComputedStyle(m).display === 'none' ? t.textContent : '' })()`)) === 'Drag across the mark')
  await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await js(`document.querySelector('[data-filter-toggle]').click()`); await wait(200)
  ok('arkiv 360: Show opens the filters', (await js(`document.getElementById('f-sev-min').offsetParent !== null && document.querySelector('[data-filter-toggle]').getAttribute('aria-expanded') === 'true'`)))
  await arkivShot('360-dark-overview')
  await js(`document.getElementById('arkiv-results').scrollIntoView()`); await wait(300)
  await arkivShot('360-dark-results')
  await js(`window.scrollTo(0, document.querySelector('[data-results]').getBoundingClientRect().top + scrollY - 80)`); await wait(300)
  await arkivShot('360-dark-rows')
  ok('arkiv 360: an alert row stays compact (chips use the full width)', await js(`(() => { const r = document.querySelector('[data-entity-row]').getBoundingClientRect(); return r.height <= 210 })()`), String(await js(`Math.round(document.querySelector('[data-entity-row]').getBoundingClientRect().height)`)))
  await js(`document.querySelector('[data-entity-row] button').click()`); await waitFor(`!!document.querySelector('[data-entity-drawer]')`); await wait(700)
  ok('arkiv 360: drawer fits the screen', await js(`(() => { const r = document.querySelector('[data-entity-drawer]').getBoundingClientRect(); return r.width <= 361 && r.left >= -1 })()`))
  await arkivShot('360-dark-drawer')
  await escape()
  await send('Page.navigate', { url: new globalThis.URL('/more', URL).href }); await wait(1500)
  ok('arkiv 360: More links to the Arkiv directory', (await js(`document.querySelector('[data-arkiv-link]')?.getAttribute('href')`)) === '/arkiv')
  ok('arkiv: More hero counts the alerts from GET /v1/arkiv/summary', await waitFor(`document.querySelector('[data-stat="alerts"] [data-stat-value]')?.innerText === '1,404'`, 10000), await js(`document.querySelector('[data-stat="alerts"]')?.innerText`))
}

if (MODE === 'fallback') {
  // No API, and the build's publisher has nothing on Arkiv: the directory degrades gracefully.
  await vp(1440, 1000, false); await openArkiv()
  await waitFor(`!!document.querySelector('[data-summary-error]')`, 25000); await arkivIdle(); await wait(500); await arkivIdle()
  ok('arkiv fallback: header explains counts are unavailable', (await js(`document.querySelector('[data-summary-error]')?.innerText || ''`)).length > 20)
  ok('arkiv fallback: reads Arkiv from the browser when the API is down', (await js(`document.querySelector('[data-mode="browser"]')?.getAttribute('aria-checked')`)) === 'true' && (await js(`!!document.querySelector('[data-auto-browser]')`)))
  const kind = await resultsKind()
  ok('arkiv fallback: results settle into an empty or rate-limit state, never a spinner', kind === 'error' || (kind === 'ok' && (await js(`!!document.querySelector('[data-results-empty]')`))), String(kind))
  ok('arkiv fallback: query panel still shows the query', (await arkivQuery()).startsWith("project = str('nazar-in-batch-alerts') AND t = str('alert')"))
  await heroPauseCheck('arkiv fallback')
  {
    // A software renderer (SwiftShader, llvmpipe) gets the still mark, not a 1 fps particle field.
    const fake = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `{ const g = WebGL2RenderingContext.prototype.getParameter; WebGL2RenderingContext.prototype.getParameter = function (p) { return p === 0x9246 || p === 0x1F01 ? 'Google SwiftShader' : g.call(this, p) } }` })).result?.identifier
    await send('Page.reload'); await wait(1500)
    await waitFor(`${HERO}?.dataset.gl === 'off'`, 8000)
    ok('arkiv fallback: a software WebGL renderer falls back to the still mark', (await js(`${HERO}?.dataset.gl`)) === 'off' && (await js(`${HERO}.dataset.glReason`)) === 'software' && (await js(`(() => { const i = document.querySelector('[data-arkiv-hero] .sh-fallback'); const c = getComputedStyle(i); return c.visibility === 'visible' && c.opacity === '1' && i.getBoundingClientRect().width > 100 && !document.querySelector('[data-arkiv-hero] canvas') })()`)), await js(`${HERO}?.dataset.glReason`))
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fake })
  }
  await arkivShot('fallback-desktop')
}
// ======== end Arkiv directory ========

// ======== Share links (fallback): deep link, result-card share, public /b/[batch] page. Self-contained block. ========
if (MODE === 'fallback') {
  const origin = new globalThis.URL(URL).origin
  const onNewDoc = async src => (await send('Page.addScriptToEvaluateOnNewDocument', { source: src })).result?.identifier
  const dropNewDoc = id => id && send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id })
  const openCheck = async q => { await send('Page.navigate', { url: new globalThis.URL('/' + q, URL).href }); await wait(1500); await waitIdle(); await wait(300) }
  const cardState = () => js(`document.querySelector('section[data-state]')?.dataset.state || null`)
  await vp(390, 844, false)
  await send('Page.navigate', { url: URL }); await wait(1200)
  await js(`localStorage.clear(); localStorage.setItem('nazar:onboarded', '1'); localStorage.setItem('theme', 'light')`)

  // Deep link: /?batch= and /?b= fill in the box and run the check on load, then drop the parameter.
  await openCheck('?batch=SR-13')
  ok('share: /?batch=SR-13 runs the check on load', (await cardState()) === 'flagged' && (await js(`document.getElementById('batch')?.value`)) === 'SR-13')
  ok('share: deep link parameter is dropped after the check', (await js(`location.search`)) === '')
  await openCheck('?b=demo-rt1')
  ok('share: /?b= alias works (DEMO-RT1 retracted)', (await cardState()) === 'retracted' && (await js(`document.getElementById('batch')?.value`)) === 'DEMO-RT1')

  // Without the Web Share API: Copy link and WhatsApp carry the absolute /b/ link.
  const noShare = await onNewDoc(`Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true })`)
  await openCheck('?batch=SR-13')
  ok('share: Save and Share sit right after "What to do", before the on-chain proof', await js(`(() => { const a = document.querySelector('section[data-state="flagged"] [data-share-actions]'); const p = document.querySelector('section[data-state="flagged"] [data-onchain-proof]'); return !!a && !!a.previousElementSibling?.textContent.includes('What to do') && !!a.querySelector('[data-save-cabinet]') && (!p || !!(a.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)) })()`))
  await js(`window.__copied = []; navigator.clipboard.writeText = async t => { window.__copied.push(t) }`)
  ok('share: Copy link is offered when the Web Share API is missing', await js(`(() => { const b = document.querySelector('[data-copy-link]'); if (!b) return false; b.click(); return true })()`))
  await wait(300)
  const copied = await js(`window.__copied`)
  ok('share: Copy link copies the absolute /b/SR-13 link', copied?.[0] === `${origin}/b/SR-13`, JSON.stringify(copied))
  const wa = await js(`document.querySelector('[data-whatsapp]')?.href || ''`)
  const waText = wa.startsWith('https://wa.me/?text=') ? decodeURIComponent(wa.slice('https://wa.me/?text='.length)) : ''
  ok('share: WhatsApp message names the batch, its state and the /b/ link', waText.includes('COLDRIF batch SR-13: Flagged by') && waText.includes(`${origin}/b/SR-13`), waText)
  await dropNewDoc(noShare)

  // With the Web Share API: the native sheet gets the link as its url.
  const stubShare = await onNewDoc(`window.__shared = []; Object.defineProperty(Navigator.prototype, 'share', { value: async d => { window.__shared.push(d) }, configurable: true })`)
  await openCheck('?batch=SR-13')
  ok('share: Share button uses the Web Share API when present', await js(`(() => { const b = document.querySelector('[data-share]'); if (!b) return false; b.click(); return true })()`))
  await wait(300)
  const shared = await js(`window.__shared?.[0] || null`)
  ok('share: shared data carries the /b/SR-13 url and the summary', shared?.url === `${origin}/b/SR-13` && /COLDRIF batch SR-13: Flagged by/.test(shared?.text || '') && !/\b(safe|genuine|approved)\b/i.test(shared?.text || ''), JSON.stringify(shared))
  await dropNewDoc(stubShare)
  await typeBatch('ZZ-404')
  ok('share: a no-alert share still says it is not a safety certificate', decodeURIComponent((await js(`document.querySelector('[data-whatsapp]')?.href || ''`))).includes('This is not a safety certificate'))

  // Public share page. Its server fetch is not mocked (run.mjs points NAZAR_API_ORIGIN at nothing), so it shows the neutral state.
  await send('Page.navigate', { url: new globalThis.URL('/b/SR-13', URL).href }); await wait(1800)
  const sp = await js(`({ title: document.title, state: document.querySelector('[data-share-page]')?.dataset.shareState, batch: document.querySelector('[data-share-batch]')?.innerText, text: document.body.innerText, cta: document.querySelector('[data-share-cta]')?.getAttribute('href'), ctaText: document.querySelector('[data-share-cta]')?.innerText.trim(), og: document.querySelector('meta[property="og:image"]')?.content || '', tw: document.querySelector('meta[name="twitter:image"]')?.content || '', ogTitle: document.querySelector('meta[property="og:title"]')?.content || '', fits: document.documentElement.scrollWidth <= innerWidth + 1 })`)
  ok('share page: title names the batch', /^Batch SR-13 · .*Nazar$/.test(sp.title), sp.title)
  ok('share page: shows the batch and a state (neutral when the API is unreachable)', sp.batch === 'SR-13' && (sp.state === 'unavailable' ? sp.text.includes('Open in Nazar to check') : ['flagged', 'retracted', 'no_alert', 'unreadable'].includes(sp.state)), String(sp.state))
  ok('share page: "Check your own batch" links to /?batch=SR-13', sp.cta === '/?batch=SR-13' && sp.ctaText === 'Check your own batch', `${sp.cta} ${sp.ctaText}`)
  ok('share page: og:image and twitter:image point at the per-batch card', /\/b\/SR-13\/opengraph-image/.test(sp.og) && /\/b\/SR-13\/opengraph-image/.test(sp.tw) && sp.ogTitle === sp.title, `${sp.og} | ${sp.tw}`)
  ok('share page: no device data and no "safe" wording', !sp.text.includes('Recent checks') && !sp.text.includes('cabinet') && !/\b(safe|genuine|approved)\b/i.test(sp.text))
  ok('share page: fits 390 without horizontal scroll', sp.fits)
  await shot('share-page-390')
  const img = await fetch(new globalThis.URL('/b/SR-13/opengraph-image', URL)).catch(() => null)
  const imgType = img?.headers.get('content-type') || ''
  const imgBytes = img?.ok ? (await img.arrayBuffer()).byteLength : 0
  ok('share page: Open Graph image renders as a PNG', img?.status === 200 && imgType.startsWith('image/png') && imgBytes > 5000, `${img?.status} ${imgType} ${imgBytes}`)
  if (img?.ok) fs.writeFileSync(`${OUT}/share-og-SR-13.png`, Buffer.from(await (await fetch(new globalThis.URL('/b/SR-13/opengraph-image', URL))).arrayBuffer()))
  await send('Page.navigate', { url: new globalThis.URL('/b/!!', URL).href }); await wait(1500)
  ok("share page: an unreadable batch is Can't tell, never an error page", (await js(`document.querySelector('[data-share-page]')?.dataset.shareState`)) === 'unreadable' && /Can't tell/.test(await js(`document.title`)))
  await send('Page.navigate', { url: new globalThis.URL('/b/SR-13', URL).href }); await wait(1500)
  await js(`document.querySelector('[data-share-cta]').click()`); await wait(1500); await waitIdle(); await wait(300)
  ok('share page: CTA opens Check and runs the batch', (await js(`location.pathname`)) === '/' && (await cardState()) === 'flagged')
}
// ======== end Share links ========

// ======== Saved copy (fallback): the API is refused and Arkiv knows nothing for this build's publisher,
// so the site's own /data/snapshot.json must answer with real alerts instead of demo data. ========
if (MODE === 'fallback') {
  fb.savedCopy = true
  await vp(390, 844, false)
  await send('Page.navigate', { url: URL }); await wait(1200)
  await js(`localStorage.clear(); localStorage.setItem('nazar:onboarded', '1'); new Promise((r) => { const q = indexedDB.deleteDatabase('nazar'); q.onsuccess = q.onerror = q.onblocked = () => r(true) })`)
  await send('Page.reload'); await wait(1500); await settle(); await wait(800)
  const lists = await js(`[...document.querySelectorAll('[data-source]')].map((e) => e.dataset.source).join(',')`)
  ok('saved copy: home lists come from the saved copy, not demo data', lists.includes('snapshot') && !lists.includes('demo') && !(await body()).includes('3 active'), lists)
  await typeBatch('SR-13')
  ok('saved copy: SR-13 is flagged from the saved copy (Sresan)', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'flagged' && (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'snapshot' && (await body()).includes('Sresan Pharmaceutical'))
  // At 390 the proof is one line (data-proof-line); from md up it is the full block (data-proof-saved).
  ok("saved copy: the proof says it came from the saved copy, not that it is confirming forever", (await js(`(!!document.querySelector('[data-proof-saved]') || document.querySelector('[data-proof-line]')?.dataset.proofLine === 'saved') && !document.querySelector('[data-proof-pending], [data-proof-line="pending"]') && /saved copy/.test(document.querySelector('[data-proof-line], [data-proof-saved]')?.innerText || '')`)))
  await typeBatch('TG25-2281A')
  ok('saved copy: a real CDSCO batch (TG25-2281A, Levcon-M) is flagged without any live source', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'flagged' && (await body()).includes('Levcon-M'))
  await typeBatch('DEMO-RT1')
  ok('saved copy: demo-only records are not invented once real data is loaded', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'no_alert')
  await send('Page.navigate', { url: new globalThis.URL('/feed', URL).href }); await wait(1500)
  await waitFor(`!!document.querySelector('[data-feed-source]')`, 15000)
  ok('saved copy: the Feed shows real alerts and says they are the saved copy', (await js(`document.querySelector('[data-feed]')?.dataset.feedSource`)) === 'snapshot' && !!(await js(`document.querySelector('[data-feed-saved-copy]')?.innerText`)))
  {
    // India pulse, drawn from the same saved copy: honest counts, a labelled tile map that drives the list.
    const P = `document.querySelector('[data-feed-pulse]')`
    const facts = await js(`fetch('/data/snapshot.json').then(r => r.json()).then(f => { const rows = Object.values(f.alerts).flat().filter(r => r[19] !== 1); return { total: rows.length, tn: rows.filter(r => r[13] === 'IN-TN').length, undated: rows.filter(r => r[20] === 0).length } })`)
    ok('feed pulse: renders from the snapshot with its date', (await waitFor(`!!${P}`, 8000)) && Number(await js(`${P}.dataset.pulseTotal`)) === facts.total && /as of \d{1,2} \w{3} \d{4}/.test(await js(`${P}.innerText`)), `${await js(`${P}?.dataset.pulseTotal`)} vs ${facts.total}`)
    ok('feed pulse: compact on a phone, map behind "Show the map"', (await js(`getComputedStyle(document.getElementById('pulse-body')).display`)) === 'none' && (await js(`document.querySelector('[data-pulse-toggle]').getAttribute('aria-expanded')`)) === 'false')
    await js(`document.querySelector('[data-pulse-toggle]').click()`); await wait(400)
    { // fcfix: WCAG 2.5.8 targets. Tiles are 44px or more on a phone, and the page does not scroll sideways.
      const t = await js(`(() => { const r = [...document.querySelectorAll('[data-pulse-tile]')].map(b => b.getBoundingClientRect()); return Math.floor(Math.min(...r.map(x => Math.min(x.width, x.height)))) })()`)
      ok('feed pulse: map tiles are at least 44px at 390, with no page overflow', (await js(`innerWidth`)) === 390 && t >= 44 && (await js(`document.documentElement.scrollWidth`)) <= 390, String(t))
      ok("feed pulse: the count says it is Nazar's ledger, as of a time in IST", /^[\d,]+ alerts? in Nazar's ledger · as of \d{1,2} \w{3} \d{4}, \d{1,2}:\d{2}\s?[ap]m IST$/i.test((await js(`document.querySelector('[data-pulse-source]')?.innerText || ''`)).trim()), await js(`document.querySelector('[data-pulse-source]')?.innerText`))
    }
    ok('feed pulse: "Show the map" opens it', (await js(`getComputedStyle(document.getElementById('pulse-body')).display`)) !== 'none' && (await js(`document.querySelector('[data-pulse-toggle]').getAttribute('aria-expanded')`)) === 'true')
    ok('feed pulse: every state tile is a labelled button; the map group and a text summary are labelled', (await js(`(() => { const t = [...document.querySelectorAll('[data-pulse-tile]')]; return t.length === 36 && t.every(b => b.tagName === 'BUTTON' && /^.+: [\\d,]+ alerts?/.test(b.getAttribute('aria-label'))) })()`)) && (await js(`!!document.querySelector('[data-feed-pulse] [role="group"][aria-label]')`)) && (await js(`[...document.querySelectorAll('[data-feed-pulse] .sr-only')].some(e => e.textContent.includes("From Nazar's snapshot"))`)))
    const tnLabel = await js(`document.querySelector('[data-pulse-tile="IN-TN"]').getAttribute('aria-label')`)
    ok('feed pulse: the Tamil Nadu tile says its count from the snapshot', tnLabel.startsWith(`Tamil Nadu: ${facts.tn} alert`), tnLabel)
    ok('feed pulse: undated alerts are kept off the timeline and counted in a note', facts.undated === 0 || (await js(`document.querySelector('[data-pulse-undated]')?.innerText || ''`)).startsWith(`${facts.undated.toLocaleString('en-IN')} alert`))
    const green = await js(`(() => { const x = document.createElement('canvas').getContext('2d'); const rgb = v => { x.clearRect(0, 0, 1, 1); x.fillStyle = '#000'; x.fillStyle = v; x.fillRect(0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data }; const el = ${P}; return [el, ...el.querySelectorAll('*')].some(n => { const c = getComputedStyle(n); return [c.color, c.backgroundColor].some(v => { const [r, g, b, a] = rgb(v); return a > 0 && g > r + 40 && g > b + 40 }) }) })()`)
    ok('feed pulse: no green anywhere (empty states are neutral)', green === false)
    await js(`document.querySelector('[data-pulse-tile="IN-TN"]').click()`); await feedIdle()
    ok('feed pulse: tapping Tamil Nadu filters the list to it', (await js(`location.search`)) === '?state=IN-TN' && (await js(`document.getElementById('feed-state').value`)) === 'IN-TN' && (await rowTexts()).every(t => t.includes('Made in Tamil Nadu')) && (await feedCount()).startsWith(`${facts.tn} alert`) && (await js(`document.querySelector('[data-pulse-tile="IN-TN"]').getAttribute('aria-pressed')`)) === 'true', await feedCount())
    await js(`document.querySelector('[data-pulse-tile="IN-TN"]').focus()`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await wait(150)
    ok('feed pulse: arrow keys move between neighbouring states', (await js(`document.activeElement?.dataset.pulseTile`)) === 'IN-PY')
    ok('feed pulse: Clear is visible while a state is chosen', await js(`(() => { const b = document.querySelector('[data-pulse-clear]'); return !!b && b.offsetParent !== null && /Clear/.test(b.textContent) })()`))
    await js(`document.querySelector('[data-pulse-clear]').click()`); await feedIdle()
    ok('feed pulse: Clear removes the state filter', (await js(`location.search`)) === '' && !(await js(`!!document.querySelector('[data-pulse-tile][aria-pressed="true"]')`)))
    await vp(360, 800, false, true); await send('Page.reload'); await wait(1500); await feedIdle()
    await waitFor(`!!${P}`, 8000); await js(`document.querySelector('[data-pulse-toggle]').click()`); await wait(300)
    ok('feed pulse: no horizontal overflow at 360 with the map open', (await js(`document.documentElement.scrollWidth`)) <= 360)
    ok('feed pulse: reduced motion draws it still (no entrance, sweep or ping)', (await js(`${P}.dataset.motion`)) === 'reduce' && (await js(`(() => { const t = document.querySelector('[data-pulse-tile]'); const s = getComputedStyle(t); return s.opacity === '1' && (s.transform === 'none' || s.transform === 'matrix(1, 0, 0, 1, 0, 0)') })()`)) && !(await js(`!!document.querySelector('[data-feed-pulse] .feed-pulse-sweep, [data-feed-pulse] .feed-pulse-ping')`)))
    await vp(390, 844, false)
  }
  fb.savedCopy = false
}
// ======== end Saved copy ========

// ======== Alerts search and "New since your last visit" on the saved copy (fallback): the API is refused,
// so Nazar's saved copy (/data/snapshot.json) answers searches, and new alerts are counted against it. ========
if (MODE === 'fallback') {
  fb.savedCopy = true
  const searchFor = async (q) => {
    await js(`(() => { const i = document.getElementById('feed-q'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(q)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await wait(450); await waitFor(`document.querySelector('[data-feed]')?.dataset.feedMode === ${JSON.stringify(q ? 'search' : 'list')}`); await feedIdle(); await wait(150)
  }
  await vp(390, 844, true)
  await send('Page.navigate', { url: new globalThis.URL('/feed', URL).href }); await wait(1200)
  await js(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('nazar:onboarded', '1'); localStorage.setItem('theme', 'dark')`)
  await send('Page.reload'); await wait(1500)
  await waitFor(`document.querySelector('[data-feed]')?.dataset.feedSource === 'snapshot'`, 15000); await waitFor(`!!localStorage.getItem('nazar:seen')`, 8000); await wait(400)
  ok('saved search: first visit on the saved copy marks nothing new', !(await js(`!!document.querySelector('[data-new-pill], [data-feed-new]')`)))
  await searchFor('Levcon')
  ok('saved search: "Levcon" finds TG25-2281A in the saved copy, labelled as the saved copy', (await js(`document.querySelector('[data-feed]').dataset.feedSource`)) === 'snapshot' && (await rowTexts()).some(t => t.includes('TG25-2281A')) && !!(await js(`document.querySelector('[data-feed-saved-copy]')?.innerText`)) && (await js(`[...document.querySelectorAll('[data-source]')].some(e => e.dataset.source === 'snapshot')`)))
  ok('saved search: "Levcon" is highlighted', await js(`[...document.querySelectorAll('[data-alert-row]')].every(r => [...r.querySelectorAll('mark[data-hl]')].some(m => m.textContent.toLowerCase() === 'levcon'))`))
  await searchFor('Sresan')
  ok('saved search: a maker finds its alerts, with the maker line highlighted', (await feedRows()) > 0 && (await rowTexts()).some(t => t.includes('COLDRIF')) && (await js(`[...document.querySelectorAll('[data-row-match] mark[data-hl]')].some(m => m.textContent === 'Sresan')`)))
  ok('saved search: ?q= follows the box', (await js(`location.search`)) === '?q=Sresan')
  ok('saved search: no horizontal overflow at 390 with results', (await js(`document.documentElement.scrollWidth`)) <= 390)
  await js(`window.scrollTo(0, document.getElementById('feed-q').getBoundingClientRect().top + scrollY - 70)`); await shot('feat1-search-390-dark')
  await searchFor('TG25-2281A')
  ok('saved search: a batch query offers Check this batch', (await js(`document.querySelector('[data-feed-check-batch]')?.getAttribute('href')`)) === '/?batch=TG25-2281A')
  await searchFor('qqzzx')
  {
    const e = await js(`document.querySelector('[data-feed-search-empty]')?.innerText || ''`)
    ok('saved search: no match is not a safety claim', e.includes('No regulator alert names “qqzzx” in Nazar\'s records.') && e.includes('This is not a safety certificate.') && !/\bsafe\b|genuine|approved/i.test(e.replace('safety certificate', '')), e)
    const green = await js(`(() => { const x = document.createElement('canvas').getContext('2d'); const rgb = v => { x.clearRect(0, 0, 1, 1); x.fillStyle = '#000'; x.fillStyle = v; x.fillRect(0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data }; const el = document.querySelector('[data-feed-search-empty]'); return [el, ...el.querySelectorAll('*')].some(n => { const c = getComputedStyle(n); return [c.color, c.backgroundColor].some(v => { const [r, g, b, a] = rgb(v); return a > 0 && g > r + 40 && g > b + 40 }) }) })()`)
    ok('saved search: the empty result has no green', green === false)
  }
  await js(`document.querySelector('[data-feed-search-clear]').click()`); await wait(300); await feedIdle()

  // Next visit: the alerts on the first three rows were not here last time (their keys are dropped from the device's record).
  const dropped = await js(`fetch('/data/snapshot.json').then(r => r.json()).then(f => { const keyOf = (id) => { const m = /^snap-(.+)-(\\d+)$/.exec(id); const r = f.alerts[m[1]][Number(m[2])]; return (r[0] ?? m[1]).toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + r[16] }; const ids = [...document.querySelectorAll('[data-alert-row]')].map(r => r.dataset.alertRow); const keys = [...new Set(ids.map(keyOf))].slice(0, 3); const s = JSON.parse(localStorage.getItem('nazar:seen')); s.keys = s.keys.filter(k => !keys.includes(k)); localStorage.setItem('nazar:seen', JSON.stringify(s)); sessionStorage.clear(); return { keys, rows: ids.filter(id => keys.includes(keyOf(id))).length } })`)
  await send('Page.navigate', { url: URL }); await wait(1500); await settle()
  await waitFor(`!!document.querySelector('nav[aria-label="Mobile navigation"] [data-nav="alerts"] [data-nav-badge]')`, 10000)
  ok('saved new: the Alerts tab counts 3 unseen alerts', (await js(`document.querySelector('nav[aria-label="Mobile navigation"] [data-nav="alerts"] [data-nav-badge]')?.dataset.count`)) === '3' && (await js(`document.querySelector('nav[aria-label="Mobile navigation"] [data-nav="alerts"]').getAttribute('aria-label')`)) === 'Alerts, 3 new alerts')
  await openFeed(); await waitFor(`document.querySelector('[data-feed]')?.dataset.feedSource === 'snapshot'`, 15000); await wait(500)
  const newRows = await js(`[...document.querySelectorAll('[data-alert-row]')].filter(r => r.querySelector('[data-new-pill]')).length`)
  ok('saved new: those rows carry New pills and the header counts 3 new alerts', newRows === dropped.rows && newRows >= 3 && (await js(`document.querySelector('[data-feed-new]')?.innerText || ''`)).startsWith('3 new alerts since your last visit'), `${newRows} · ${JSON.stringify(dropped)}`)
  ok('saved new: the Alerts badge clears on the Alerts page', !(await js(`!!document.querySelector('[data-nav="alerts"] [data-nav-badge]')`)))
  ok('saved new: no horizontal overflow at 390 with New pills', (await js(`document.documentElement.scrollWidth`)) <= 390)
  await js(`document.querySelector('[data-feed-new]').scrollIntoView({ block: 'start' }); window.scrollBy(0, -80)`); await shot('feat1-new-390-dark')
  await js(`document.querySelector('[data-rss-toggle]').click()`); await wait(300)
  await js(`document.querySelector('[data-rss-panel]').scrollIntoView({ block: 'center' })`); await shot('feat1-rss-390-dark')
  await vp(360, 800, true); await wait(500)
  ok('360: Alerts fits with search box, RSS panel, New pills and the badge bar', (await js(`document.documentElement.scrollWidth`)) <= 360 && (await js(`(() => { const p = document.querySelector('[data-rss-panel]'); return p.scrollWidth <= p.clientWidth + 1 && p.getBoundingClientRect().right <= 360 })()`)))
  const t360 = await js(`Math.min(...[...document.querySelectorAll('[data-feed-search], [data-rss-toggle], [data-rss-panel] button, [data-rss-panel] a, [data-feed-mark-seen]')].filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().height)))`)
  ok('360: search, RSS and Mark all seen controls are at least 44px tall', t360 >= 44, String(t360))
  await js(`document.querySelector('[data-feed-mark-seen]').click()`); await wait(300)
  ok('saved new: Mark all seen clears them', !(await js(`!!document.querySelector('[data-new-pill], [data-feed-new]')`)))
  await searchFor('coldrif')
  ok('360: search results fit', (await js(`document.documentElement.scrollWidth`)) <= 360 && (await feedRows()) > 0)
  await js(`document.querySelector('[data-feed-search-clear]').click()`); await wait(300)
  await vp(390, 844, false)
  fb.savedCopy = false
}
// ======== end Alerts search on the saved copy ========

// ======== Shelf sweep (/sweep): bulk batch check for chemists. Fallback runs it on the site's saved copy
// (no live source), then without any copy; mock has the API confirm only the flagged and look-alike rows. ========
if (MODE === 'fallback' || MODE === 'mock') {
  const SW = MODE === 'fallback' ? 'sweep (saved copy)' : 'sweep (mock)'
  const SHOTS = process.env.SWEEP_SHOTS || OUT
  fs.mkdirSync(SHOTS, { recursive: true })
  const swShot = async (name, delay = 400) => { await wait(delay); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${MODE}-${name}.png`, Buffer.from(r.result.data, 'base64')) }
  const swType = async v => { await js(`(() => { const t = document.getElementById('sweep-input'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(v)}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`); await wait(250) }
  const swPreview = () => js(`document.querySelector('[data-sweep-preview]')?.innerText || ''`)
  const swDone = () => waitFor(`document.querySelector('[data-sweep]')?.dataset.sweepPhase === 'done'`, 20000)
  const swRows = () => js(`[...document.querySelectorAll('[data-sweep-row]')].map(r => ({ batch: r.dataset.batch, state: r.dataset.state, source: r.dataset.source, confirmed: r.dataset.confirmed, text: r.innerText }))`)
  const swClickAt = async sel => { const p = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`); if (!p) return false; for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); await wait(350); return true }
  const swGreen = scope => js(`(() => { const x = document.createElement('canvas').getContext('2d'); const rgb = v => { x.clearRect(0, 0, 1, 1); x.fillStyle = '#000'; x.fillStyle = v; x.fillRect(0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data }; return [...document.querySelectorAll(${JSON.stringify(scope)})].some(el => [el, ...el.querySelectorAll('*')].some(n => { const c = getComputedStyle(n); return [c.color, c.backgroundColor, c.borderTopColor].some(v => { const [r, g, b, a] = rgb(v); return a > 0 && g > r + 40 && g > b + 40 }) })) })()`)
  const RANK = { flagged: 0, retracted: 1, unreadable: 2, no_alert: 3 }
  const plainMock = mockResponse
  const checkCalls = () => requests.filter(u => u.startsWith('http://localhost:8787/v1/check'))
  if (MODE === 'fallback') fb.savedCopy = true
  if (MODE === 'mock') {
    // The live record agrees with the snapshot for the sample's other flagged batches.
    const extra = { tg252281a: { batch: 'TG25-2281A', batchKey: 'tg252281a', brand: 'Levcon-M', product: 'Levcon-M', peds: false, state: 'IN-HP', authority: 'CDSCO', noticeTitle: 'CDSCO NSQ list', category: 'spurious' }, r01gl2523: { batch: 'R01GL2523', batchKey: 'r01gl2523', brand: 'Respifresh TR', product: 'Respifresh TR', state: 'IN-GJ', authority: 'CDSCO', noticeTitle: 'CDSCO alert' } }
    mockResponse = url => { const u = new globalThis.URL(url); const k = (u.searchParams.get('batch') || '').toLowerCase().replace(/[^a-z0-9]/g, ''); if (u.pathname === '/v1/check' && extra[k]) return { state: 'flagged', batch: extra[k].batch, asOf: new Date().toISOString(), alerts: [{ ...MOCK_ALERTS[0], ...extra[k] }], source: 'ledger' }; return plainMock(url) }
  }

  await vp(1440, 900, false)
  await send('Page.navigate', { url: URL }); await wait(1200)
  await js(`localStorage.clear(); localStorage.setItem('nazar:onboarded', '1'); localStorage.setItem('theme', 'light'); new Promise((r) => { const q = indexedDB.deleteDatabase('nazar'); q.onsuccess = q.onerror = q.onblocked = () => r(true) })`)
  await send('Page.reload'); await wait(1500); await settle()
  // The way in from Check, next to the Try chips.
  ok(`${SW}: Check links to Shelf sweep beside the Try chips`, await js(`(() => { const a = document.querySelector('a[data-sweep-link]'); return !!a && a.getAttribute('href') === '/sweep' && /Checking many batches\\? Try Shelf sweep/.test(a.innerText) && a.getBoundingClientRect().height >= 44 && !!a.closest('div')?.querySelector('[data-try-chip]') })()`))
  await js(`window.__spa = 1; document.querySelector('a[data-sweep-link]').click()`); await wait(1500)
  ok(`${SW}: the link opens /sweep in the app (title "Shelf sweep · Nazar", serif headline)`, (await js(`location.pathname`)) === '/sweep' && (await js(`window.__spa`)) === 1 && (await js(`document.title`)) === 'Shelf sweep · Nazar' && (await js(`document.querySelector('h1[data-sweep-hero]')?.innerText.replace(/\\s+/g, ' ').trim()`)) === 'Check a whole shelf, in one go.')
  ok(`${SW}: says the list is processed on the device and only batch numbers go to the API`, /Processed on this device/.test(await body()) && /Only the flagged and look-alike batch numbers go to Nazar.s API/.test(await body()) && /Nothing is uploaded/.test(await body()))
  await wait(1500)

  // Paste parsing: one per line, commas and semicolons; pack labels stripped; duplicates merged by match key.
  await swType('SR-13\nsr13, AB1234\nB.No. SR-13\n??\n\nTG25-2281A;AB-1234')
  ok(`${SW}: paste counts batches, unreadable lines and merged duplicates`, (await swPreview()) === '3 batches · 1 unreadable · 3 duplicates merged', await swPreview())
  await swType('Batch No\nSR-13\nAB1234')
  ok(`${SW}: a pasted header word ("Batch No") is not read as a batch`, (await swPreview()) === '2 batches', await swPreview())
  await swType(Array.from({ length: 520 }, (_, i) => `ZX-${1000 + i}`).join('\n'))
  ok(`${SW}: at most 500 rows; the rest are named as left out`, (await swPreview()) === '500 batches' && /Only the first 500 are checked; 20 more batches left out/.test(await js(`document.querySelector('[data-sweep-over]')?.innerText || ''`)))

  // CSV upload with a header row: the batch column is found, product/qty/expiry kept as context.
  const csv = 'Item Name,Batch No.,Qty,Expiry\n"COLDRIF Syrup, 60 ml",SR-13,12,04/2027\nLevcon-M,TG25-2281A,30,11/2027\nCrocin 500,AB1234,5,01/2028\nDuplicate,sr 13,1,\n'
  await js(`(() => { const i = document.querySelector('input[data-sweep-file]'); const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(csv)}], 'stock.csv', { type: 'text/csv' })); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })) })()`); await wait(500)
  ok(`${SW}: CSV upload finds the batch column and keeps product, qty and expiry`, (await swPreview()) === '3 batches · 1 duplicate merged' && /stock\.csv/.test(await js(`document.querySelector('[data-sweep-file-info]')?.innerText || ''`)) && (await js(`document.querySelector('[data-sweep-columns]')?.innerText || ''`)) === 'Batch column: “Batch No.” · also kept: Item Name, Qty, Expiry', await js(`document.querySelector('[data-sweep-file-info]')?.innerText || ''`))
  await js(`[...document.querySelectorAll('button')].find(b => b.dataset.sweepCheck !== undefined)?.click()`); await swDone(); await wait(300)
  {
    const rows = await swRows()
    const sr = rows.find(r => r.batch === 'SR-13')
    ok(`${SW}: the file's context shows on the row (quoted product with a comma, qty, ×2 lines)`, !!sr && sr.text.includes('COLDRIF Syrup, 60 ml · Qty 12 · Exp 04/2027') && sr.text.includes('×2 lines'), sr?.text)
  }
  await swShot('desktop-light-csv', 200)

  // Empty page, then the sample.
  await js(`document.querySelector('[data-sweep-reset]').click()`); await wait(400)
  ok(`${SW}: New sweep clears the results`, !(await js(`!!document.querySelector('[data-sweep-results]')`)) && (await js(`document.getElementById('sweep-input').value`)) === '')
  await js(`window.scrollTo(0, 0)`); await swShot('desktop-light-empty')

  if (MODE === 'mock') mock.checkDelayMs = 1200
  const callsBefore = checkCalls().length
  const t0 = await js(`performance.now()`)
  await js(`document.querySelector('[data-sweep-sample]').click()`)
  const instant = await js(`new Promise(resolve => { const t = performance.now(); const tick = () => { const r = document.querySelector('[data-sweep-row][data-batch="SR-13"]'); if (r && r.dataset.state === 'flagged') return resolve({ ms: Math.round(performance.now() - t), source: r.dataset.source, confirming: !!r.querySelector('[data-confirming]') }); if (performance.now() - t > 4000) return resolve(null); requestAnimationFrame(tick) }; tick() })`)
  ok(`${SW}: Try a sample fills the box (5 batches · 2 unreadable · 1 duplicate merged)`, (await swPreview()) === '5 batches · 2 unreadable · 1 duplicate merged', await swPreview())
  ok(`${SW}: answers instantly from the on-device snapshot (< 400 ms)`, !!instant && instant.source === 'snapshot' && instant.ms < 400, JSON.stringify(instant))
  if (MODE === 'mock') {
    ok(`${SW}: flagged rows say they are being confirmed, with a progress bar`, !!instant?.confirming && (await js(`!!document.querySelector('[data-sweep-progress="confirming"] [role="progressbar"]')`)))
    await swShot('desktop-light-confirming', 0)
  }
  ok(`${SW}: the sentinel eye scans while checking`, MODE === 'fallback' || (await js(`document.querySelector('[data-sweep] [data-sentinel]')?.dataset.state`)) === 'scanning')
  await swDone(); await wait(400)
  mock.checkDelayMs = 0
  const rows = await swRows()
  const by = b => rows.find(r => r.batch === b)
  ok(`${SW}: every row answered (5 batches + 2 unreadable lines)`, rows.length === 7 && rows.every(r => r.state !== 'pending'), rows.map(r => `${r.batch}:${r.state}`).join(' '))
  ok(`${SW}: flagged first, then Can't tell, then no alert`, rows.every((r, i) => i === 0 || RANK[rows[i - 1].state] <= RANK[r.state]) && rows[0].state === 'flagged', rows.map(r => r.state).join(','))
  ok(`${SW}: SR-13 and TG25-2281A are flagged (and R01GL2523)`, by('SR-13')?.state === 'flagged' && by('TG25-2281A')?.state === 'flagged' && by('R01GL2523')?.state === 'flagged' && by('SR-13').text.includes('COLDRIF') && by('TG25-2281A').text.includes('Levcon-M'))
  ok(`${SW}: 5R-13 is Can't tell with "did you mean SR-13", never a flag`, by('5R-13')?.state === 'unreadable' && /Did you mean\s*SR-13\s*\?/.test(by('5R-13').text) && !/Flagged/.test(by('5R-13').text), by('5R-13')?.text)
  ok(`${SW}: unreadable lines are Can't tell, answered on the device`, by('??')?.state === 'unreadable' && by('smudged #')?.state === 'unreadable' && by('??').source === 'local' && /Couldn.t read this batch number/.test(by('??').text))
  ok(`${SW}: AB1234 is No alert found (slate), with no green anywhere`, by('AB1234')?.state === 'no_alert' && !(await swGreen('[data-sweep-results]')))
  ok(`${SW}: chips count each answer; "No alert found" says it is not a safety certificate`, (await js(`[...document.querySelectorAll('[data-sweep-chip]')].map(c => c.dataset.sweepChip + '=' + c.dataset.count).join(',')`)) === 'flagged=3,retracted=0,unreadable=3,no_alert=1' && /Not a safety certificate/.test(await js(`document.querySelector('[data-sweep-chip="no_alert"]').innerText`)) && /1 look-alike/.test(await js(`document.querySelector('[data-sweep-chip="unreadable"]').innerText`)))
  ok(`${SW}: Child Shield marks SR-13 (a children's syrup)`, !!(await js(`!!document.querySelector('[data-sweep-row][data-batch="SR-13"] [data-child-shield]')`)) && !(await js(`!!document.querySelector('[data-sweep-row][data-batch="TG25-2281A"] [data-child-shield]')`)))
  ok(`${SW}: rows link the regulator notice and View /b/BATCH`, (await js(`document.querySelector('[data-sweep-row][data-batch="SR-13"] a[data-link="notice"]')?.href || ''`)).startsWith('http') && (await js(`document.querySelector('[data-sweep-row][data-batch="SR-13"] a[data-link="view"]')?.getAttribute('href')`)) === '/b/SR-13')
  ok(`${SW}: at 1440 the table fits without sideways scrolling (View links visible)`, await js(`(() => { const t = document.querySelector('[data-sweep-table]'); return !!t && t.scrollWidth <= t.clientWidth + 1 })()`), String(await js(`(() => { const t = document.querySelector('[data-sweep-table]'); return t ? t.scrollWidth + '/' + t.clientWidth : '' })()`)))
  ok(`${SW}: the sentinel eye turns to flagged`, (await js(`document.querySelector('[data-sweep] [data-sentinel]')?.dataset.state`)) === 'flagged')
  ok(`${SW}: never says safe, genuine or approved`, !/\b(safe|genuine|approved)\b/i.test((await body()).replace(/not a safety certificate|never certifies a medicine as safe/gi, '')))
  if (MODE === 'fallback') {
    ok(`${SW}: no live source, so the saved copy's answers stand (no Arkiv proof without an entity key)`, ['SR-13', 'TG25-2281A', 'R01GL2523'].every(b => by(b).source === 'snapshot' && by(b).confirmed === 'false') && !(await js(`!!document.querySelector('[data-sweep-row] a[data-link="arkiv"]')`)))
  } else {
    const calls = checkCalls().slice(callsBefore).map(u => decodeURIComponent(new globalThis.URL(u).searchParams.get('batch') || ''))
    ok(`${SW}: only the flagged and look-alike batches went to the API (AB1234 and unreadable lines never left)`, calls.length === 4 && ['SR-13', 'TG25-2281A', 'R01GL2523', '5R-13'].every(b => calls.includes(b)) && !calls.includes('AB1234'), calls.join(','))
    ok(`${SW}: the API confirmed the flagged rows`, ['SR-13', 'TG25-2281A', 'R01GL2523'].every(b => by(b).source === 'api' && by(b).confirmed === 'true') && by('5R-13').source === 'api')
    ok(`${SW}: a confirmed row links its Arkiv proof (entity key from the API)`, (await js(`document.querySelector('[data-sweep-row][data-batch="SR-13"] a[data-link="arkiv"]')?.href || ''`)).includes(KEY1))
  }
  await js(`window.scrollTo(0, 0)`); await swShot('desktop-light-results', 300)
  await js(`document.querySelector('[data-sweep-results]').scrollIntoView({ block: 'start' })`); await swShot('desktop-light-results-table', 200)

  // Filter by state, and search within the results.
  await js(`document.querySelector('[data-sweep-chip="flagged"]').click()`); await wait(250)
  ok(`${SW}: the Flagged chip filters to flagged rows`, (await swRows()).length === 3 && (await swRows()).every(r => r.state === 'flagged') && (await js(`document.querySelector('[data-sweep-chip="flagged"]').getAttribute('aria-pressed')`)) === 'true')
  await js(`document.querySelector('[data-sweep-chip="flagged"]').click()`); await wait(250)
  await js(`(() => { const i = document.querySelector('[data-sweep-search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'levcon'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await wait(350)
  ok(`${SW}: search finds a row by product`, (await swRows()).length === 1 && (await swRows())[0].batch === 'TG25-2281A')
  await js(`(() => { const i = document.querySelector('[data-sweep-search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await wait(350)

  // Export: the CSV is a Blob made in the browser; the flagged list goes to the clipboard; Print prints the counter sheet.
  await send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})
  await js(`window.__blobs = []; window.__urlHook ??= URL.createObjectURL; URL.createObjectURL = b => { window.__blobs.push(b); return window.__urlHook.call(URL, b) }; window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve() }; window.__printed = 0; window.print = () => { window.__printed++ }`)
  await swClickAt('[data-sweep-export]')
  ok(`${SW}: Export opens a menu (CSV, copy flagged, print)`, await waitFor(`!!document.querySelector('[data-sweep-export-menu] [data-export="csv"]') && !!document.querySelector('[data-export="copy"]') && !!document.querySelector('[data-export="print"]')`, 3000))
  await swShot('desktop-light-export-menu', 300)
  await swClickAt('[data-export="csv"]')
  const csvOut = await js(`(async () => { const b = window.__blobs.at(-1); return b ? { type: b.type, text: await b.text(), bom: [...new Uint8Array(await b.slice(0, 3).arrayBuffer())].join() } : null })()`)
  {
    const lines = (csvOut?.text || '').replace(/^\uFEFF/, '').trim().split(/\r\n/)
    const head = lines[0]?.split(',') || []
    const col = name => head.indexOf(name)
    const cells = l => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c } out.push(cur); return out }
    const data = lines.slice(1).map(cells)
    const row = b => data.find(r => r[col('batch')] === b)
    ok(`${SW}: CSV export is generated in the browser with every row and the required columns`, !!csvOut && csvOut.type.startsWith('text/csv') && csvOut.bom === '239,187,191' && data.length === 7 && ['state', 'product', 'regulator', 'notice_url', 'severity', 'child_shield', 'arkiv_entity_url', 'checked_at', 'checked_at_ist'].every(c => col(c) >= 0), head.join(','))
    ok(`${SW}: CSV is flagged first; SR-13 row has the product, regulator, severity and Child Shield`, data[0]?.[col('state')] === 'Flagged' && row('SR-13')?.[col('state')] === 'Flagged' && /COLDRIF/.test(row('SR-13')?.[col('product')] || '') && !!row('SR-13')?.[col('regulator')] && row('SR-13')?.[col('severity')] === '5' && row('SR-13')?.[col('child_shield')] === 'yes' && /^https?:/.test(row('SR-13')?.[col('notice_url')] || ''))
    ok(`${SW}: CSV checked_at is ISO, with the same moment in IST`, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(row('AB1234')?.[col('checked_at')] || '') && /IST$/.test(row('AB1234')?.[col('checked_at_ist')] || ''))
    ok(`${SW}: CSV says "No alert found" (not a safety certificate) and keeps the look-alike as Can't tell`, row('AB1234')?.[col('state')] === 'No alert found' && /not a safety certificate/i.test(row('AB1234')?.join(' ') || '') && row('5R-13')?.[col('state')] === "Can't tell" && row('5R-13')?.[col('did_you_mean')] === 'SR-13')
    ok(`${SW}: CSV arkiv_entity_url ${MODE === 'mock' ? 'links the confirmed entity' : 'is empty without an entity key'}`, MODE === 'mock' ? (row('SR-13')?.[col('arkiv_entity_url')] || '').includes(KEY1) : data.every(r => !r[col('arkiv_entity_url')]))
    ok(`${SW}: CSV never says safe`, !/\bsafe\b/i.test(csvOut?.text || ''))
  }
  await swClickAt('[data-sweep-export]'); await swClickAt('[data-export="copy"]')
  {
    const copied = await js(`window.__copied || ''`)
    ok(`${SW}: Copy flagged list copies the flagged batches as text, with links`, /^Flagged batches \(3\)/.test(copied) && copied.includes('SR-13') && copied.includes('TG25-2281A') && !copied.includes('AB1234') && !copied.includes('5R-13') && copied.includes('/b/SR-13'), copied.slice(0, 160))
  }
  await swClickAt('[data-sweep-export]'); await swClickAt('[data-export="print"]'); await wait(200)
  ok(`${SW}: Print opens the print dialog`, (await js(`window.__printed`)) === 1)
  await send('Emulation.setEmulatedMedia', { media: 'print' })
  ok(`${SW}: printing shows only the counter sheet (flagged first), not the app or the form`, await js(`(() => { const p = document.querySelector('[data-sweep-print]'); const vis = e => !!e && getComputedStyle(e).display !== 'none'; return vis(p) && !vis(document.querySelector('[data-sweep-results]')) && !vis(document.querySelector('[data-sweep-privacy]')?.parentElement) && !vis(document.querySelector('aside')) && !vis(document.querySelector('nav')) && p.querySelectorAll('tbody tr').length === 7 && p.querySelector('tbody tr').dataset.printState === 'flagged' })()`))
  await vp(1440, 900, false)

  // Phones: cards instead of the table, no sideways scroll at 360; dark screenshots at 390.
  await vp(360, 800, true); await wait(500)
  ok(`${SW}: at 360 the results are cards, not a table, with no overflow`, (await js(`!!document.querySelector('[data-sweep-cards]') && !document.querySelector('[data-sweep-table]')`)) && (await js(`document.documentElement.scrollWidth`)) <= 360, String(await js(`document.documentElement.scrollWidth`)))
  ok(`${SW}: at 360 the row links are 44px targets`, await js(`[...document.querySelectorAll('[data-sweep-cards] a[data-link]')].every(a => a.getBoundingClientRect().height >= 44)`))
  await js(`localStorage.setItem('theme', 'dark'); document.documentElement.classList.add('dark'); document.documentElement.style.colorScheme = 'dark'`)
  await vp(390, 844, true); await wait(500)
  await js(`document.querySelectorAll('[data-sonner-toast]').forEach(t => t.remove())`)
  await js(`document.querySelector('[data-sweep-results]').scrollIntoView({ block: 'start' })`); await swShot('mobile-dark-results', 300)
  await js(`window.scrollBy(0, 640)`); await swShot('mobile-dark-cards', 200)
  ok(`${SW}: no green in dark mode either`, !(await swGreen('[data-sweep-results]')))
  await js(`window.scrollTo(0, 0)`)
  await swClickAt('[data-sweep-export]'); await swShot('mobile-dark-export-menu', 300)
  await escape()
  await js(`document.querySelector('[data-sweep-reset]').click()`); await wait(300); await js(`window.scrollTo(0, 0)`); await swShot('mobile-dark-empty')
  await js(`localStorage.setItem('theme', 'light'); document.documentElement.classList.remove('dark'); document.documentElement.style.colorScheme = ''`)

  if (MODE === 'fallback') {
    // No snapshot at all (the saved copy 404s, the API is refused): never a guess, every batch is Can't tell with Try again.
    fb.savedCopy = false
    await vp(1440, 900, false)
    await js(`new Promise((r) => { const q = indexedDB.deleteDatabase('nazar'); q.onsuccess = q.onerror = q.onblocked = () => r(true) })`)
    await send('Page.reload'); await wait(1500)
    await swType('SR-13\nAB1234\nTG25-2281A')
    await js(`document.querySelector('[data-sweep-check]').click()`); await swDone(); await wait(300)
    const r2 = await swRows()
    ok("sweep (no copy, no API): every batch is Can't tell, never flagged or no alert", r2.length === 3 && r2.every(r => r.state === 'unreadable' && /Couldn.t reach the live record/.test(r.text)), r2.map(r => `${r.batch}:${r.state}`).join(' '))
    ok('sweep (no copy, no API): offers Try again for the unchecked batches', /3 batches couldn.t be checked/.test(await js(`document.querySelector('[data-sweep-unchecked]')?.innerText || ''`)) && (await js(`!!document.querySelector('[data-sweep-retry]')`)))
  }
  if (MODE === 'mock') mockResponse = plainMock
  fb.savedCopy = false
  await js(`new Promise((r) => { const q = indexedDB.deleteDatabase('nazar'); q.onsuccess = q.onerror = q.onblocked = () => r(true) })`)
}
// ======== end Shelf sweep ========

// ---- Hindi (हिन्दी), phase 1 (mock): the header switch, the four states in Hindi, Alerts chrome, and the choice saved on the device.
// Regulator data (product names, reasons, notices) stays as published; the product rules hold in Hindi too.
if (MODE === 'mock') {
  const HI = 'hindi'
  const verdict = () => js(`document.querySelector('section[data-state]')?.innerText || ''`)
  const headlineText = () => js(`document.querySelector('[data-verdict-headline]')?.textContent || ''`)
  const chipText = () => js(`document.querySelector('[data-state-chip]')?.textContent || ''`)
  const barLabels = () => js(`[...document.querySelectorAll('nav a[data-nav]')].filter(a => a.offsetParent).map(a => a.dataset.label).join('|')`)
  const noClaim = (t) => !/सुरक्षित|असली|स्वीकृत/.test(t)
  await vp(390, 844, false); await fresh()
  await js(`localStorage.setItem('nazar:onboarded', '1')`); await send('Page.reload'); await wait(1200); await settle()
  ok(`${HI}: English by default (html lang="en", English nav)`, (await js(`document.documentElement.lang`)) === 'en' && (await barLabels()).startsWith('Check|Alerts'), await barLabels())
  ok(`${HI}: the header switch reads EN | हिं, is 44px tall and named "Language / भाषा"`, await js(`(() => { const b = document.querySelector('[data-lang-toggle]'); return !!b && b.getAttribute('aria-label') === 'Language / भाषा' && b.getBoundingClientRect().height >= 44 && b.innerText.replace(/\\s+/g, ' ').trim() === 'EN | हिं' })()`))

  await js(`document.querySelector('[data-lang-toggle]').click()`); await wait(500)
  ok(`${HI}: switching to हिं sets <html lang="hi"> and data-lang`, (await js(`document.documentElement.lang`)) === 'hi' && (await js(`document.documentElement.dataset.lang`)) === 'hi' && (await js(`localStorage.getItem('nazar:lang')`)) === 'hi')
  ok(`${HI}: nav labels in Hindi`, (await barLabels()) === 'जाँचें|चेतावनियाँ|दवाएँ|AI|और', await barLabels())
  ok(`${HI}: the Check page in Hindi (tagline, hero, button, placeholder)`, (await body()).includes('हर बैच पर नज़र') && (await body()).includes('बैच जाँचें,') && (await js(`document.getElementById('batch').placeholder`)) === 'जैसे SR-13')
  await click('बैच जाँचें'); await wait(200)
  ok(`${HI}: an empty check asks for the batch number in Hindi`, (await js(`document.getElementById('batch-empty').innerText`)) === 'पैक पर लिखा बैच नंबर (B.No.) डालें')

  await typeBatch('SR-13'); await wait(300)
  ok(`${HI}: SR-13 flagged: chip and headline in Hindi`, (await chipText()) === 'चेतावनी जारी' && (await headlineText()) === 'यह बैच सरकारी गुणवत्ता जाँच में फ़ेल हुआ है', `${await chipText()} / ${await headlineText()}`)
  ok(`${HI}: SR-13 what to do: four steps in Hindi`, (await js(`(() => { const t = document.querySelector('section[data-state]').innerText; return ['अब क्या करें', 'इसका इस्तेमाल बंद करें।', 'पैक संभालकर रखें।', 'इसे अपने केमिस्ट को लौटा दें।', 'अगर दवा ले ली है, तो डॉक्टर से बात करें।'].every(s => t.includes(s)) })()`)))
  ok(`${HI}: Child Shield banner in Hindi`, (await verdict()).includes('यह बच्चों की दवा है'))
  ok(`${HI}: regulator data stays as published (COLDRIF, Diethylene glycol), with the as-published note`, (await verdict()).includes('COLDRIF') && (await verdict()).includes('Diethylene glycol') && (await verdict()).includes('सरकारी नोटिस जैसे जारी हुए'))
  ok(`${HI}: the batch number stays in the mono face`, /JetBrains Mono/.test(await js(`getComputedStyle(document.querySelector('[data-batch-pill] .font-mono')).fontFamily`)))
  await js(`document.fonts.ready`)
  ok(`${HI}: Noto Sans Devanagari is in the stack and loaded`, /Noto Sans Devanagari/.test(await js(`getComputedStyle(document.querySelector('[data-verdict-headline]')).fontFamily`)) && (await js(`[...document.fonts].some(f => /Noto Sans Devanagari/.test(f.family) && f.status === 'loaded')`)))
  ok(`${HI}: no tracking on Devanagari text`, (await js(`getComputedStyle(document.querySelector('[data-state-chip]')).letterSpacing`)) === 'normal')

  await typeBatch('AB1234'); await wait(300)
  ok(`${HI}: AB1234 no alert: chip, headline with an Indian (hi-IN) date`, (await chipText()) === 'कोई चेतावनी नहीं मिली' && /^\d{1,2} [ऀ-ॿ]+, \d{1,2}:\d{2}\s[ap]m\sIST तक इस बैच पर कोई सरकारी चेतावनी नहीं मिली$/.test(await headlineText()), await headlineText())
  ok(`${HI}: AB1234 says it is not a safety certificate`, (await js(`document.querySelector('[data-key-message]')?.innerText || ''`)).startsWith('यह सुरक्षा प्रमाणपत्र नहीं है।'))
  ok(`${HI}: never सुरक्षित / असली / स्वीकृत as a claim anywhere on the page`, noClaim(await body()))

  await typeBatch('5R-13'); await wait(300)
  ok(`${HI}: 5R-13 asks "did you mean" in Hindi, amber, never flagged`, (await headlineText()) === 'क्या आपका मतलब SR-13 है?' && (await chipText()) === 'पक्का नहीं कह सकते' && (await js(`document.querySelector('[data-lookalike-check]')?.innerText.replace(/\\s+/g, ' ').trim()`)) === 'SR-13 जाँचें')

  await vp(360, 800, false); await wait(500)
  ok(`${HI}: no sideways overflow at 360 (Check with a result)`, (await js(`document.documentElement.scrollWidth`)) <= 360, String(await js(`document.documentElement.scrollWidth`)))
  ok(`${HI}: bar labels fit their tabs at 360`, await js(`[...document.querySelectorAll('nav[aria-label] a[data-nav] span.truncate')].filter(s => s.offsetParent).every(s => s.scrollWidth <= s.clientWidth + 1)`))
  ok(`${HI}: the header fits at 360 (switch visible inside the viewport)`, await js(`(() => { const r = document.querySelector('[data-lang-toggle]').getBoundingClientRect(); return r.right <= 360 && r.width > 0 })()`))
  {
    const spa = await navTo('चेतावनियाँ'); await feedIdle()
    ok(`${HI}: Alerts reached from the Hindi nav (client-side)`, spa && (await js(`location.pathname`)) === '/feed')
    const b = await body()
    ok(`${HI}: Alerts chrome in Hindi (hero, search, filters, count)`, b.includes('हर चेतावनी,') && b.includes('दवा या कंपनी के नाम से खोजें') && b.includes('गंभीर 4–5') && b.includes('सिर्फ़ चाइल्ड शील्ड') && /चेतावनि/.test(await feedCount()), await feedCount())
    ok(`${HI}: Alerts keeps regulator data as published`, (await rowTexts()).some(t => t.includes('COLDRIF')))
    ok(`${HI}: no sideways overflow at 360 (Alerts)`, (await js(`document.documentElement.scrollWidth`)) <= 360, String(await js(`document.documentElement.scrollWidth`)))
  }

  await send('Page.reload'); await wait(1500); await settle()
  ok(`${HI}: the choice survives a reload (lang, nav, no pending veil)`, (await js(`document.documentElement.lang`)) === 'hi' && (await barLabels()).startsWith('जाँचें|चेतावनियाँ') && !(await js(`document.documentElement.hasAttribute('data-i18n-pending')`)) && (await js(`getComputedStyle(document.body).opacity`)) === '1')
  await send('Page.navigate', { url: URL + 'b/SR-13' }); await wait(1500)
  ok(`${HI}: the share page answers in the saved language`, (await body()).includes('अपना बैच जाँचें') && (await js(`document.documentElement.lang`)) === 'hi')
  await send('Page.navigate', { url: URL + 'more' }); await wait(1500)
  ok(`${HI}: More › Settings offers English / हिन्दी, हिन्दी checked`, (await js(`document.querySelector('[data-lang-option="hi"]')?.getAttribute('aria-checked')`)) === 'true' && (await js(`document.querySelector('[data-lang-option="en"]')?.getAttribute('aria-checked')`)) === 'false')

  await js(`document.querySelector('[data-lang-option="en"]').click()`); await wait(400)
  ok(`${HI}: switching back from Settings restores English`, (await js(`document.documentElement.lang`)) === 'en' && (await js(`localStorage.getItem('nazar:lang')`)) === 'en')
  await vp(390, 844, false); await send('Page.navigate', { url: URL }); await wait(1500); await settle()
  await js(`document.querySelector('[data-lang-toggle]').click()`); await wait(300); await js(`document.querySelector('[data-lang-toggle]').click()`); await wait(300)
  await typeBatch('SR-13')
  ok(`${HI}: back in English, text is exactly as before`, (await barLabels()).startsWith('Check|Alerts') && (await headlineText()) === 'This batch failed a government quality test' && (await chipText()) === 'Flagged' && !(await body()).includes('सरकारी नोटिस जैसे जारी हुए'))
  await js(`localStorage.removeItem('nazar:lang')`)
}
// ======== end Hindi ========

ok('no console errors or warnings', consoleErrors.length === 0, consoleErrors.join(' | '))
for (const r of results) console.log(r.filter(Boolean).join('  '))
console.log(`\n[${MODE}] ${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`)
console.log(`(info) failed network requests logged by the browser: ${netFailures.length}${netFailures.length ? ' → ' + [...new Set(netFailures)].slice(0, 4).join(', ') : ''}`)
ws.close(); process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0)
