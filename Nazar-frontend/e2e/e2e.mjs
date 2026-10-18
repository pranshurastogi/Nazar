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
const navTo = async label => { await js(`window.__spa = 1; [...document.querySelectorAll('nav a')].find(a => a.textContent.trim() === ${JSON.stringify(label)} && a.offsetParent)?.click()`); await wait(900); return js(`window.__spa === 1`) }
const openFeed = async () => { const spa = await navTo('Feed'); await feedIdle(); return spa }
const ARKIV_RPC = 'https://rpc.tiramisu.db-chain.testnet.arkiv.network'
const proofText = () => js(`document.querySelector('[role="dialog"]')?.innerText || ''`)
const escape = async () => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(700) }

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable')

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

function mockResponse(url) {
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
  if (u.pathname === '/v1/check') {
    const b = (u.searchParams.get('batch') || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const asOf = new Date().toISOString()
    if (b === 'sr13') return { state: 'flagged', batch: 'SR-13', asOf, alerts: MOCK_ALERTS, source: 'ledger' }
    if (b === '5r13') return { state: 'unreadable', batch: '5R-13', asOf, alerts: [], suggestion: 'SR-13', source: 'ledger' }
    return { state: 'no_alert', batch: u.searchParams.get('batch'), asOf, alerts: [], source: 'ledger' }
  }
  return null
}
const mock = { apiDown: false, arkiv429: false, arkivHits: 0 }
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
    const data = mockResponse(m.params.request.url)
    await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: data ? 200 : 404, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(data ?? { error: 'not found' })).toString('base64') })
  })
}

if (MODE === 'fallback') {
  // Refuse the Nazar API even if one is running locally, so answers are deterministic.
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:8787/*' }] })
  handlers.push(m => { if (m.method === 'Fetch.requestPaused') send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'ConnectionRefused' }) })

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

  // Loading state: slow the network so the in-flight card is visible.
  await send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 })
  await js(`window.__busy = null; window.__mo = new MutationObserver(() => { const s = document.querySelector('section[aria-busy="true"]'); if (s && !window.__busy) window.__busy = { text: s.innerText, label: s.getAttribute('aria-label'), btn: document.querySelector('button[aria-busy="true"]')?.innerText || '' } }); window.__mo.observe(document.body, { subtree: true, childList: true })`)
  await js(`(() => { const i = document.getElementById('batch'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'R01GL2523'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
  await waitFor(`!!window.__busy`, 4000); await js(`document.querySelector('section[aria-busy="true"]')?.scrollIntoView({block:'center'})`); await shot('mobile-loading', 0)
  await waitIdle()
  const busy = await js(`window.__busy`)
  ok('loading card shows with aria-busy while checking', !!busy && busy.label === 'Checking batch R01GL2523' && /Checking batch R01GL2523/.test(busy.text), JSON.stringify(busy))
  ok('loading card names the stage (Arkiv)', !!busy && busy.text.includes('Arkiv'))
  ok('check button shows Checking while busy', !!busy && busy.btn.includes('Checking'))
  ok('R01GL2523 lands as flagged (Respifresh TR, Rednex)', (await body()).includes('Respifresh TR · Rednex Pharmaceutical Pvt Ltd, Ahmedabad, Gujarat'))
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await typeBatch('LSL25160'); ok('LSL25160 flagged (ReLife, Shape Pharma)', (await body()).includes('ReLife · Shape Pharma Pvt Ltd, Surendranagar, Gujarat'))

  await typeBatch('demo-rt1'); ok('retracted state', (await body()).includes('An alert on this batch was withdrawn'))
  await typeBatch('!!'); ok("can't tell state for bad input", (await body()).includes("We couldn't read the batch number clearly"))
  ok('bad input is answered on the device', (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'local')
  await typeBatch('(N)25567'); ok('CDSCO-style batch (N)25567 is readable, not "can\'t tell"', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'no_alert' && !(await body()).includes("We couldn't read the batch number clearly"))
  await typeBatch('5R-13'); ok('look-alike suggests SR-13, not flagged', (await body()).includes('Did you mean') && !(await body()).includes('This batch failed'))
  await click('SR-13'); await waitIdle(); ok('suggestion click checks SR-13', (await body()).includes('This batch failed a government quality test'))
  await typeBatch('AB1234'); const b = await body()
  ok('no alert state + not a safety certificate', b.includes('No official alert for this batch as of') && b.includes('This is not a safety certificate'))
  const green = await js(`(() => { const el = document.querySelector('[aria-live="polite"]'); const all = [el, ...el.querySelectorAll('*')]; return all.some(n => { const c = getComputedStyle(n); return [c.color, c.backgroundColor, c.borderColor].some(v => { const m = v.match(/\\d+(\\.\\d+)?/g); if (!m) return false; const [r,g,bl] = m.map(Number); return g > r + 40 && g > bl + 40 }) }) })()`)
  ok('no-alert card uses no green', green === false)
  ok('never says safe', !/\bsafe\b/i.test((await body()).replace(/not a safety certificate|never certifies a medicine as safe/gi, '')))

  ok('no horizontal overflow at 390', (await js(`document.documentElement.scrollWidth`)) <= 390)

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
  await typeBatch('SR-13'); await clickHas('How do we know'); await wait(900)
  ok('proof drawer fits 360 without horizontal scroll', (await js(`(() => { const d = document.querySelector('[role="dialog"]'); return !!d && d.scrollWidth <= d.clientWidth + 1 })()`)))
  await shot('mobile-360-proof'); await escape()
  await vp(430, 932, false); await send('Page.reload'); await wait(1500); await settle()
  ok('no horizontal overflow at 430', (await js(`document.documentElement.scrollWidth`)) <= 430)

  // ---- Reduced motion: loading card animations are off
  await vp(390, 844, false, true); await send('Page.reload'); await wait(1500); await settle()
  await send('Network.emulateNetworkConditions', { offline: false, latency: 600, downloadThroughput: -1, uploadThroughput: -1 })
  await js(`window.__anim = null; new MutationObserver(() => { const s = document.querySelector('section[aria-busy="true"] svg circle:last-child'); if (s && window.__anim === null) window.__anim = getComputedStyle(s).animationName }).observe(document.body, { subtree: true, childList: true })`)
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
  ok('feed: URL is /feed and nav marks Feed current', (await js(`location.pathname`)) === '/feed' && (await js(`[...document.querySelectorAll('nav a[aria-current="page"]')].some(a => a.textContent.trim() === 'Feed')`)))
  ok('feed: loads demo alerts, labelled Demo data', (await feedRows()) === 3 && (await js(`document.querySelector('[data-feed]').dataset.feedSource`)) === 'demo' && (await feedCount()).startsWith('3 alerts') && (await body()).includes('Demo data: the Nazar API and Arkiv could not answer'))
  ok('feed: retracted demo alert is not in the feed', !(await rowTexts()).some(t => t.includes('DEMO-RT1')))
  ok('feed: no Load more at the end of demo data', (await body()).includes('End of the feed') && !(await body()).includes('Load more alerts'))
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
  const fill = async (f) => { await js(`(() => { const ins = [...document.querySelectorAll('[data-cabinet-form] input')]; const v = ${JSON.stringify(f)}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; [['name',0],['batch',1],['expiry',2],['note',3]].forEach(([k,i]) => { if (v[k] === undefined) return; set.call(ins[i], v[k]); ins[i].dispatchEvent(new Event('input', { bubbles: true })) }) })()`); await wait(100) }
  const submit = async () => { await js(`document.querySelector('[data-cabinet-form] button[type="submit"]').click()`); await wait(500) }
  const ym = (offsetMonths) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offsetMonths); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
  /** Toasts sit over the header; screenshots wait for them to leave. */
  const noToasts = () => waitFor(`!document.querySelector('[data-sonner-toast]')`, 8000)

  // ---- Navigation: Cabinet and More are real routes (desktop)
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  ok('nav: Cabinet link routes client-side', await navTo('Cabinet'))
  ok('nav: /cabinet with Cabinet marked current', (await js(`location.pathname`)) === '/cabinet' && (await js(`[...new Set([...document.querySelectorAll('nav a[aria-current="page"]')].map(a => a.textContent.trim()))].join()`)) === 'Cabinet')
  ok('nav: no "coming soon" toast any more', !(await body()).includes('coming in the next build'))

  // ---- Cabinet: empty state, validation, add
  ok('cabinet: empty state with ring motif and SR-13 hint', await js(`!!document.querySelector('[data-cabinet-empty] svg circle')`) && (await body()).includes('Your cabinet is empty') && (await js(`[...document.querySelectorAll('[data-cabinet-empty] button')].some(b => b.textContent.replace(/\\s+/g, ' ').trim() === 'Try adding SR-13')`)))
  ok('cabinet: says it is private and never sent to a server', (await body()).includes('never sent to any server'))
  await click('Add a medicine'); await wait(500)
  ok('cabinet: Add opens the form', await formOpen())
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
  ok('nav: More link routes client-side', await navTo('More'))
  ok('more: /more with More marked current', (await js(`location.pathname`)) === '/more' && (await js(`[...new Set([...document.querySelectorAll('nav a[aria-current="page"]')].map(a => a.textContent.trim()))].join()`)) === 'More')
  ok('more: renders every section', (await js(`[...document.querySelectorAll('[data-more-section]')].map(s => s.id).join()`)) === 'how,sources,proof,privacy,settings,about')
  const mb = await body()
  ok('more: How it works lists the pipeline and four answers', ['Regulator documents', 'Read', 'Resolved', 'Published on Arkiv', 'You check', 'Four honest answers', 'Flagged', 'Retracted', 'No alert found', "Can't tell"].every(t => mb.includes(t)))
  await waitFor(`document.querySelector('[data-sources-from]')?.dataset.sourcesFrom !== 'loading'`)
  ok('more: sources fall back to the built-in list', (await js(`document.querySelector('[data-sources-from]').dataset.sourcesFrom`)) === 'static' && (await js(`document.querySelectorAll('[data-source-row]').length`)) === 9)
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

  // ---- 360px dark: nav reaches each route, no overflow; screenshots with flagged + expired + no-alert items
  await vp(360, 800, true); await js(`localStorage.setItem('theme', 'dark'); localStorage.setItem('nazar:cabinet', JSON.stringify(${JSON.stringify(parsed?.items ?? [])}))`)
  await send('Page.navigate', { url: URL }); await wait(1500); await settle()
  ok('360: Cabinet tab in the bottom nav', await navTo('Cabinet') && (await js(`location.pathname`)) === '/cabinet' && (await js(`[...document.querySelectorAll('nav[aria-label="Mobile navigation"] a[aria-current="page"]')].map(a => a.textContent.trim()).join()`)) === 'Cabinet')
  await cabinetIdle(); await wait(400)
  ok('360: cabinet fits without horizontal scroll', (await js(`document.documentElement.scrollWidth`)) <= 360)
  const minCab = await js(`Math.min(...[...document.querySelectorAll('[data-cabinet-item] button[aria-expanded], main > div button')].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().height)))`)
  ok('360: cabinet buttons are at least 44px tall', minCab >= 44, String(minCab))
  await js(`window.scrollTo(0, 0)`); await shot('cabinet-360-dark')
  await js(`document.querySelector('[data-cabinet-banner]')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -12)`); await shot('cabinet-360-dark-list')
  await click('Review alert'); await wait(900)
  ok('360: open flagged item fits', (await js(`document.documentElement.scrollWidth`)) <= 360)
  await shot('cabinet-360-dark-open')
  ok('360: More tab in the bottom nav', await navTo('More') && (await js(`location.pathname`)) === '/more')
  ok('360: More fits without horizontal scroll', (await js(`document.documentElement.scrollWidth`)) <= 360)
  await js(`window.scrollTo(0, 0)`); await shot('more-360-dark')
  await js(`document.getElementById('proof').scrollIntoView({ block: 'start' })`); await shot('more-360-dark-proof')
  await js(`document.getElementById('settings').scrollIntoView({ block: 'start' })`); await shot('more-360-dark-settings')
  ok('360: Check tab returns home', await navTo('Check') && (await js(`location.pathname`)) === '/')
  await vp(360, 800, false, true); await js(`localStorage.setItem('theme', 'light')`); await send('Page.navigate', { url: URL + 'cabinet' }); await wait(1500); await cabinetIdle()
  ok('reduced motion: cabinet renders and settles', (await items()).length === 3)
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
    ok('proof sheet: creator equal to the configured publisher is "Official Nazar publisher"', (await js(`document.querySelector('[role="dialog"] [data-publisher-check]')?.dataset.publisherCheck`)) === 'official' && p.includes('Official Nazar publisher'))
    await shot('mock-proof-machine-read'); await escape()
    await typeBatch('5R-13'); ok('API look-alike → Did you mean, not flagged', (await body()).includes('Did you mean') && !(await body()).includes('This batch failed'))
    await typeBatch('(N)25567'); ok('API: (N)25567 is sent to the API, not rejected as unreadable', (await js(`document.querySelector('section[data-state]')?.dataset.state`)) === 'no_alert' && requests.some(u => u.includes('/v1/check?batch=(N)25567') || u.includes('/v1/check?batch=%28N%2925567')))
    await typeBatch('ZZ-404'); ok('API no-alert labelled + not a safety certificate', (await body()).includes('This is not a safety certificate') && (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'api')
    await vp(360, 800, true); await fresh(true); await click('Skip'); await wait(600); await typeBatch('SR-13'); await js(`document.querySelector('section[data-state]').scrollIntoView({block:'start'})`)
    ok('mock: no horizontal overflow at 360 with timeline', (await js(`document.documentElement.scrollWidth`)) <= 360)
    await shot('mock-mobile-dark-timeline')
    await clickHas('How do we know'); await wait(900)
    ok('mock: proof drawer fits 360', (await js(`(() => { const d = document.querySelector('[role="dialog"]'); return !!d && d.scrollWidth <= d.clientWidth + 1 })()`)))
    await shot('mock-mobile-dark-proof'); await escape()
  }
}

// ---- Feed against the API (mock contract or the real backend)
if (MODE === 'mock' || MODE === 'live') {
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  ok('feed: nav link routes client-side (no reload)', await openFeed())
  ok('feed: answered by the API, labelled Live · Nazar API', (await js(`document.querySelector('[data-feed]').dataset.feedSource`)) === 'api' && (await js(`[...document.querySelectorAll('[data-source]')].some(e => e.innerText === 'Live · Nazar API')`)))
  const allCount = await feedCount(); const firstRows = await feedRows()
  ok('feed: first page has rows and a count', firstRows > 0 && /^[\d,]+ alerts?/.test(allCount), `${firstRows} rows · ${allCount}`)
  ok('feed: rows with an entity key carry a Live on Arkiv badge', (await js(`document.querySelectorAll('[data-live-arkiv]').length`)) === firstRows)
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
    ok("feed: Maharashtra rows say \"Listed on the regulator's page · first seen\" instead of a date", t.every(x => x.includes("Listed on the regulator's page · first seen Sep 2025") || x.includes("Listed on the regulator's page · first seen Aug 2025")), t[0])
    await js(`document.querySelector('[data-alert-row]').click()`); await wait(800)
    await js(`[...document.querySelectorAll('[data-feed] button')].find(b => b.textContent.includes('How do we know'))?.click()`); await wait(900)
    const p = await proofText()
    ok('feed: Maharashtra proof shows the honest date line', p.includes("Listed on the regulator's page · first seen"), p.slice(0, 160))
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

// ---- More › Sources from the API (mock)
if (MODE === 'mock') {
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  await navTo('More'); await waitFor(`['api','static'].includes(document.querySelector('[data-sources-from]')?.dataset.sourcesFrom)`)
  ok('more: sources come live from GET /v1/sources', (await js(`document.querySelector('[data-sources-from]').dataset.sourcesFrom`)) === 'api' && (await js(`document.querySelectorAll('[data-source-row]').length`)) === 2)
  ok('more: API source shows its last run; disabled one its reason', (await js(`document.querySelector('[data-source-row="cdsco-online"]').innerText`)).includes('Last run 5 min ago') && (await js(`document.querySelector('[data-source-row="tg-dca"]').innerText`)).includes('refuses connections from outside India'))
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
  ok('429: status pill falls back to Offline · demo data', (await js(`document.querySelector('[data-status]')?.dataset.status`)) === 'offline')
  ok('429: home lists fall back to demo data', (await js(`document.querySelector('[aria-label="High-severity alerts"]')?.parentElement.querySelector('[data-source]')?.dataset.source`)) === 'demo')
  await typeBatch('SR-13')
  // On a loaded machine the first call can time out instead (a shorter network backoff), so the bound is on the whole phase.
  ok('429: checks during the backoff answer from demo data, no retry storm', (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'demo' && mock.arkivHits <= 4, `${hits} → ${mock.arkivHits}`)
  await openFeed()
  ok('429: feed during the backoff uses demo data, no retry storm', (await js(`document.querySelector('[data-feed]').dataset.feedSource`)) === 'demo' && mock.arkivHits <= 4, `${hits} → ${mock.arkivHits}`)
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

ok('no console errors or warnings', consoleErrors.length === 0, consoleErrors.join(' | '))
for (const r of results) console.log(r.filter(Boolean).join('  '))
console.log(`\n[${MODE}] ${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`)
console.log(`(info) failed network requests logged by the browser: ${netFailures.length}${netFailures.length ? ' → ' + [...new Set(netFailures)].slice(0, 4).join(', ') : ''}`)
ws.close(); process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0)
