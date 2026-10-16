import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf8f3' }}>
        <svg width="150" height="90" viewBox="0 0 30 18">
          <rect x="0" y="0" width="30" height="18" rx="9" fill="#1d3fa6" />
          <circle cx="15" cy="9" r="7" fill="#fff" />
          <circle cx="15" cy="9" r="4.8" fill="#a7d3f2" />
          <circle cx="15" cy="9" r="2.4" fill="#0e1424" />
        </svg>
      </div>
    ),
    size,
  )
}
