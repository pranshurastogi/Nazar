import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nazar',
    short_name: 'Nazar',
    description: 'Check any Indian medicine batch against official drug regulator alerts.',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf8f3',
    theme_color: '#0b1220',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
