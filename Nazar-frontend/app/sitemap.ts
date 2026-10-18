import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MetadataRoute } from 'next'

// The app's pages, plus one public /b/<batch> page for every flagged batch in Nazar's saved snapshot
// (public/data/snapshot.json, refreshed on every build), so a search for a batch or brand can land
// on its verifiable page. Built at build time; no request-time work.

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://nazar-nu.vercel.app').replace(/\/+$/, '')

type Row = [string | null, ...unknown[]]
type Snapshot = { generatedAt?: string; alerts?: Record<string, Row[]> }

function flaggedBatches(): { batch: string; lastModified?: Date }[] {
  try {
    const snap = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'snapshot.json'), 'utf8')) as Snapshot
    const at = snap.generatedAt ? new Date(snap.generatedAt) : undefined
    const out: { batch: string; lastModified?: Date }[] = []
    for (const [key, rows] of Object.entries(snap.alerts ?? {})) {
      // Row[19] is "retracted"; a batch whose only alerts were withdrawn gets no page here.
      const live = rows.filter((r) => r[19] !== 1)
      if (!live.length) continue
      const printed = (live[0][0] ?? key.toUpperCase()).trim()
      if (printed) out.push({ batch: printed, lastModified: at })
    }
    return out
  } catch {
    return []
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/feed`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE}/arkiv`, lastModified: now, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${SITE}/ai`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE}/more`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE}/sweep`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE}/cabinet`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
  ]
  const batches = flaggedBatches().map(({ batch, lastModified }) => ({
    url: `${SITE}/b/${encodeURIComponent(batch)}`,
    lastModified,
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }))
  return [...pages, ...batches]
}
