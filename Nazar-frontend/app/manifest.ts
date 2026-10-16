import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nazar',
    short_name: 'Nazar',
    description: 'Check any Indian medicine batch against official drug regulator alerts.',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf8f3',
    theme_color: '#1d3fa6',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  }
}
