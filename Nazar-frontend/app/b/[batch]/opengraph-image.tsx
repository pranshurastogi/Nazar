import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

import { batchFromParam, shareCheck } from '@/lib/source/server-check'
import type { ResultState } from '@/lib/source/types'

// Per-batch social card, in the style of the site card (app/opengraph-image.jpg): light
// blue-white ground, the Nazar mark, then the batch, product, state, authority and date.

// Per request, like the page, so an API outage is not baked into the card; the API answer is cached by the fetch.
export const dynamic = 'force-dynamic'
export const alt = 'Nazar batch check: the current regulator alert status for this batch'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const INK = '#0f172a'
const MUTED = '#475569'

const CHIP: Record<ResultState | 'unavailable', { label: string; fg: string; bg: string; border: string }> = {
  flagged: { label: 'Flagged', fg: '#ffffff', bg: '#c22121', border: '#c22121' },
  retracted: { label: 'Retracted', fg: '#ffffff', bg: '#a35c09', border: '#a35c09' },
  // Slate, never green: no alert is not a safety certificate.
  no_alert: { label: 'No alert found', fg: '#ffffff', bg: '#536177', border: '#536177' },
  unreadable: { label: "Can't tell", fg: '#ffffff', bg: '#a35c09', border: '#a35c09' },
  unavailable: { label: 'Check on Nazar', fg: '#1d3fa6', bg: '#e8eefc', border: '#c7d4f5' },
}

async function markDataUrl(): Promise<string | null> {
  try {
    const png = await readFile(join(process.cwd(), 'public/brand/nazar-mark-256.png'))
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export default async function Image({ params }: { params: Promise<{ batch: string }> }) {
  const batch = batchFromParam((await params).batch)
  const [check, mark] = await Promise.all([shareCheck(batch), markDataUrl()])
  const r = check.kind === 'result' ? check.result : null
  const alert = r && 'alert' in r ? r.alert : undefined
  const chip = CHIP[r?.state ?? 'unavailable']
  const shown = r?.batch || check.batch

  const product = alert ? clip(alert.brand, 48) : r?.state === 'no_alert' ? 'No regulator alert published for this batch' : r?.state === 'unreadable' ? 'Re-read the batch number on the pack' : 'Check this batch against regulator alerts'
  const detail = alert
    ? clip(`${alert.authority} · ${alert.noticeDate}`, 64)
    : r?.state === 'no_alert'
      ? 'Not a safety certificate'
      : 'CDSCO · State regulators · WHO'
  const verify = !!alert?.entityKey

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '56px 72px',
          background: 'linear-gradient(135deg, #f7f9ff 0%, #eef3ff 55%, #e3ebff 100%)',
          color: INK,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {mark ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mark} width={76} height={76} alt="" />
          ) : (
            <div style={{ width: 76, height: 76, borderRadius: 38, background: '#1d3fa6', display: 'flex' }} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1.5 }}>Nazar</div>
            <div style={{ fontSize: 22, color: MUTED }}>Har batch par nazar</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 44, flexGrow: 1 }}>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, color: '#1d3fa6', textTransform: 'uppercase' }}>Batch</div>
          <div style={{ fontSize: shown.length > 12 ? 92 : 128, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, fontFamily: 'monospace' }}>{clip(shown, 20)}</div>
          <div style={{ fontSize: 38, fontWeight: 600, marginTop: 10 }}>{product}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <div
              style={{
                display: 'flex',
                padding: '12px 26px',
                borderRadius: 999,
                fontSize: 30,
                fontWeight: 700,
                color: chip.fg,
                background: chip.bg,
                border: `2px solid ${chip.border}`,
              }}
            >
              {chip.label}
            </div>
            <div style={{ fontSize: 28, color: MUTED }}>{detail}</div>
          </div>
          {verify && (
            <div style={{ display: 'flex', padding: '12px 22px', borderRadius: 16, fontSize: 26, fontWeight: 600, color: '#8a4b14', background: '#fdf0e1' }}>
              Verify on Arkiv
            </div>
          )}
        </div>
      </div>
    ),
    {
      ...size,
      // Shared cards are re-fetched by crawlers; a real answer is reused for 5 minutes, the fallback card for 1.
      headers: { 'Cache-Control': `public, max-age=${r ? 300 : 60}, s-maxage=${r ? 300 : 60}, stale-while-revalidate=600` },
    },
  )
}
