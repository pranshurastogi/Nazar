// Nazar service worker: opens the app and answers checks offline.
//   pages and RSC payloads – network first (3 s), then the last good copy, then the cached Check page;
//   /_next/static, brand assets – cache first (file names are content-hashed or versioned);
//   API reads (/v1/*) – network first, then the last good copy, so Feed and the snapshot work offline.
// Never touched: non-GET requests (POST /v1/medicine/explain, Arkiv RPC), /v1/check (the on-device
// snapshot answers offline), and other origins' non-API requests.
// Bump VERSION to drop every old cache on the next visit.
const VERSION = 'nazar-sw-v1'
const SHELL = `${VERSION}-shell`
const STATIC = `${VERSION}-static`
const DATA = `${VERSION}-data`
const PRECACHE = ['/', '/feed', '/cabinet', '/more', '/manifest.webmanifest', '/brand/icon-192.png', '/brand/icon-512.png', '/brand/nazar-mark-256.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // One missing page must not block the install; the rest still gets cached.
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nazar-sw-') && !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))

/** Fresh when the network answers within `ms`; else the last good copy; else keep waiting for the network. */
async function networkFirst(request, cacheName, ms, fallbackUrl) {
  const cache = await caches.open(cacheName)
  const net = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone()).catch(() => {})
    return res
  })
  net.catch(() => {})
  try {
    return await Promise.race([net, timeout(ms)])
  } catch {
    const hit = (await cache.match(request)) || (await caches.match(request))
    if (hit) return hit
    try {
      return await net
    } catch (err) {
      const shell = fallbackUrl && (await caches.match(fallbackUrl))
      if (shell) return shell
      throw err
    }
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) (await caches.open(STATIC)).put(request, res.clone()).catch(() => {})
  return res
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin
  const api = /^(\/api\/nazar)?\/v1\//.test(url.pathname)

  if (api) {
    if (/\/v1\/(check|pipeline\/status)/.test(url.pathname) || /\/v1\/medicine\//.test(url.pathname)) return
    event.respondWith(networkFirst(request, DATA, 8000))
    return
  }
  if (!sameOrigin) return
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/brand/') || url.pathname.startsWith('/scan/')) {
    event.respondWith(cacheFirst(request))
    return
  }
  if (request.mode === 'navigate' || request.headers.get('RSC') === '1') {
    event.respondWith(networkFirst(request, SHELL, 3000, request.mode === 'navigate' ? '/' : undefined))
  }
})
