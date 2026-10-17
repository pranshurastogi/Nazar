// End-to-end check of the Nazar web app over the Chrome DevTools Protocol (no browser-automation dependency).
// Usage: node e2e.mjs <outDir> [fallback|mock|live]
//   fallback: Nazar API unreachable; Arkiv has no Nazar data yet, so demo data answers.
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
const proofText = () => js(`document.querySelector('[role="dialog"]')?.innerText || ''`)
const escape = async () => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(700) }

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable')

// ---- Mock API via Fetch interception
const KEY1 = '0x8b1c2a7e3f9d4c6b5a0e1f2d3c4b5a69788766554433221100ffeeddccbbaa99'
const KEY2 = '0x1f2e3d4c5b6a79881726354453627180a9b8c7d6e5f40312213243546576879a'
const WALLET = '0xd06d85Eb20f126f796E4a341b711B1a757c66bD2'
const TX = '0xabc0000000000000000000000000000000000000000000000000000000000def'
const dto = (o) => ({ rid: 'r-' + o.entityKey.slice(2, 10), caseId: 'c1', batch: 'SR-13', batchKey: 'sr13', brand: 'COLDRIF', product: 'COLDRIF Syrup', generic: 'Paracetamol, Phenylephrine, Chlorpheniramine', form: 'syrup', category: 'adulterated', failures: ['glycol'], reason: 'Diethylene glycol 48.6% w/v', severity: 5, severityRules: ['Toxic glycol: base 5'], ruleVersion: 'sev@1', peds: true, manufacturer: 'Sresan Pharmaceutical, Kancheepuram', manufacturerRole: 'maker', plantId: null, state: 'TN', mfgYm: 202505, expYm: 202704, alertYm: 202510, sourceId: 'x', jurisdiction: 'IN', noticeSha: 'a'.repeat(64), noticeTitle: 'Notice', noticeUrl: 'https://example.org/notice.pdf', noticeDate: '2025-10-13', method: 'text', confidence: 0.97, tier: 'auto', creator: WALLET, txHash: TX, publishedAt: '2025-10-14T00:00:00Z', retracted: false, explorer: { entity: 'https://tiramisu.explorer.arkiv.network/entity/' + o.entityKey, tx: 'https://tiramisu.explorer.arkiv.network/tx/' + TX }, ...o })
const MOCK_ALERTS = [
  dto({ entityKey: KEY1, authority: 'World Health Organization', noticeTitle: 'Medical Product Alert N°5/2025', noticeDate: '2025-10-13', tier: 'auto' }),
  dto({ entityKey: KEY2, authority: 'Tamil Nadu Drugs Control', noticeTitle: 'NSQ list, October 2025', noticeDate: '2025-10-04', alertYm: 202510, tier: 'machine_read', method: 'ocr', confidence: 0.82 }),
]
function mockResponse(url) {
  const u = new globalThis.URL(url)
  if (u.pathname === '/v1/pipeline/status') return { heartbeat: { lastOkMs: Date.now() - 4 * 60_000, entityKey: KEY1 }, runs: [], stats: {}, publisher: { address: WALLET, balanceGlm: 0.4 }, mode: 'live' }
  if (u.pathname === '/v1/alerts') {
    const peds = u.searchParams.get('peds'); const min = Number(u.searchParams.get('minSeverity') || 0)
    const items = [MOCK_ALERTS[0], { ...MOCK_ALERTS[0], rid: 'r-other', batch: 'AX-77', batchKey: 'ax77', brand: 'Example Tabs', peds: false, severity: 4, entityKey: KEY2 }, { ...MOCK_ALERTS[0], rid: 'r-low', batch: 'LW-1', batchKey: 'lw1', brand: 'Low Severity Tabs', peds: false, severity: 2, entityKey: KEY2 }].filter(a => (!peds || a.peds) && a.severity >= min)
    return { items, total: items.length }
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
if (MODE === 'mock') {
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:8787/*' }] })
  handlers.push(async m => {
    if (m.method !== 'Fetch.requestPaused') return
    const data = mockResponse(m.params.request.url)
    await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: data ? 200 : 404, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(data ?? { error: 'not found' })).toString('base64') })
  })
}

if (MODE === 'fallback') {
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
  await clickHas('Feed'); await wait(500); ok('unbuilt tabs show a toast', (await body()).includes('coming in the next build'))
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

  // ---- Desktop
  await vp(1440, 1000, false); await fresh(); await click('Skip'); await wait(600)
  ok('status pill desktop text: Offline · demo data', (await js(`document.querySelector('[data-status]')?.innerText`)) === 'Offline · demo data')
  await shot('desktop-home')
  await typeBatch('SR-13'); await js(`window.scrollTo(0, 330)`); await shot('desktop-flagged')
  await vp(1440, 1000, true); await fresh(true); await click('Skip'); await wait(600); await shot('desktop-dark-home')
}

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
    await shot('mock-proof-machine-read'); await escape()
    await typeBatch('5R-13'); ok('API look-alike → Did you mean, not flagged', (await body()).includes('Did you mean') && !(await body()).includes('This batch failed'))
    await typeBatch('ZZ-404'); ok('API no-alert labelled + not a safety certificate', (await body()).includes('This is not a safety certificate') && (await js(`document.querySelector('section[data-state] [data-source]')?.dataset.source`)) === 'api')
    await vp(360, 800, true); await fresh(true); await click('Skip'); await wait(600); await typeBatch('SR-13'); await js(`document.querySelector('section[data-state]').scrollIntoView({block:'start'})`)
    ok('mock: no horizontal overflow at 360 with timeline', (await js(`document.documentElement.scrollWidth`)) <= 360)
    await shot('mock-mobile-dark-timeline')
    await clickHas('How do we know'); await wait(900)
    ok('mock: proof drawer fits 360', (await js(`(() => { const d = document.querySelector('[role="dialog"]'); return !!d && d.scrollWidth <= d.clientWidth + 1 })()`)))
    await shot('mock-mobile-dark-proof'); await escape()
  }
}

ok('no console errors or warnings', consoleErrors.length === 0, consoleErrors.join(' | '))
for (const r of results) console.log(r.filter(Boolean).join('  '))
console.log(`\n[${MODE}] ${results.filter(r => r[0] === 'PASS').length}/${results.length} passed`)
console.log(`(info) failed network requests logged by the browser: ${netFailures.length}${netFailures.length ? ' → ' + [...new Set(netFailures)].slice(0, 4).join(', ') : ''}`)
ws.close(); process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0)
