import type { MetadataRoute } from 'next'

// Every page is public and meant to be found, by search engines and by AI assistants alike.
// The same-origin API proxy is left out: its answers live on the batch pages and the public API.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://nazar-nu.vercel.app').replace(/\/+$/, '')

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  }
}
