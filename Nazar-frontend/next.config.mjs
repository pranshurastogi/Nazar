/**
 * Same-origin API proxy. When NAZAR_API_ORIGIN (server-only) is set, the browser calls
 * /api/nazar/* on this site and Vercel forwards it to the Nazar API: no cross-origin request,
 * no CORS preflight for POSTs, and GET responses are cached at Vercel's edge according to the
 * API's Cache-Control / CDN-Cache-Control (s-maxage, stale-while-revalidate). Methods, bodies
 * and the client's X-Forwarded-For pass through unchanged, so POST /v1/medicine/explain and its
 * per-IP limits keep working. Without it, the app calls NEXT_PUBLIC_NAZAR_API_URL directly.
 */
const trimSlash = (s) => s.replace(/\/+$/, '')
const apiOrigin = (() => {
  const o = process.env.NAZAR_API_ORIGIN?.trim()
  return o && /^https?:\/\//.test(o) ? trimSlash(o) : null
})()
export const API_PROXY_PATH = '/api/nazar'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a second build (e.g. a test run) sit beside a running one without clobbering it.
  ...(process.env.NAZAR_DIST_DIR ? { distDir: process.env.NAZAR_DIST_DIR } : {}),
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  env: {
    // Read by lib/source/config.ts; inlined at build time like any NEXT_PUBLIC_ value.
    NEXT_PUBLIC_NAZAR_API_PROXY: apiOrigin ? API_PROXY_PATH : '',
  },
  async rewrites() {
    return apiOrigin ? [{ source: `${API_PROXY_PATH}/:path*`, destination: `${apiOrigin}/:path*` }] : []
  },
  async headers() {
    return [
      // The service worker must always be revalidated so a new deploy takes over promptly.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, max-age=0' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ]
  },
}

export default nextConfig
