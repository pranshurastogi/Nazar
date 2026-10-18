import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Noto_Sans, Noto_Sans_Devanagari } from 'next/font/google'

import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LOCALE_SCRIPT } from '@/lib/i18n/core'
import { LocaleProvider } from '@/lib/i18n/provider'
import './globals.css'

const notoSans = Noto_Sans({ subsets: ['latin'], variable: '--font-noto-sans', display: 'swap' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono', display: 'swap' })
// Hindi mode only (globals.css adds it to the stack under html[data-lang=hi]). Not preloaded, and
// its @font-face covers Devanagari code points only, so English visitors never download it.
const devanagari = Noto_Sans_Devanagari({ subsets: ['devanagari'], variable: '--font-devanagari', display: 'swap', preload: false })

// Absolute URLs for social cards: the production domain unless a deploy says otherwise.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nazar-nu.vercel.app'
const API_ORIGIN = (process.env.NEXT_PUBLIC_NAZAR_API_URL?.startsWith('http') ? process.env.NEXT_PUBLIC_NAZAR_API_URL : 'https://nazar-api-production.up.railway.app').replace(/\/+$/, '')

// Structured data: what Nazar is, for search engines and AI crawlers. It describes the app and its
// sources; it never claims a medicine is safe or that Nazar is a regulator.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      '@id': `${SITE_URL}/#app`,
      name: 'Nazar',
      alternateName: 'Har batch par nazar',
      url: SITE_URL,
      description:
        'Nazar checks any Indian medicine batch number against alerts published by CDSCO, state drug controllers and WHO, and publishes every alert as a verifiable public entity on Arkiv. It reports what a regulator published; it never certifies a medicine as safe.',
      applicationCategory: 'HealthApplication',
      operatingSystem: 'Web, Android, iOS (installable PWA)',
      inLanguage: ['en-IN', 'hi-IN'],
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
      author: { '@id': `${SITE_URL}/#author` },
      featureList: [
        'Batch check with four answers: Flagged, Retracted, No alert found, Can’t tell',
        'Camera and photo scan that reads the batch, brand and salts on the device',
        'Feed of regulator alerts with search and RSS',
        'Medicine cabinet re-checked on every visit',
        'Bulk check for chemists (Shelf sweep)',
        'Proof of every alert on Arkiv',
        'MCP server for AI assistants',
        'English and Hindi',
      ],
      sameAs: ['https://github.com/pranshurastogi/Nazar'],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#site`,
      url: SITE_URL,
      name: 'Nazar',
      potentialAction: { '@type': 'SearchAction', target: `${SITE_URL}/feed?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
    },
    {
      '@type': 'Person',
      '@id': `${SITE_URL}/#author`,
      name: 'Pranshu Rastogi',
      url: 'https://pranshurastogi.com',
      sameAs: [
        'https://x.com/pranshurastogii',
        'https://github.com/pranshurastogi',
        'https://www.linkedin.com/in/rastogipranshu/',
        'https://www.youtube.com/@pranshurastogi',
        'https://pranshurastogi.medium.com/',
      ],
    },
  ],
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Nazar · Har batch par nazar',
  description: 'Check any Indian medicine batch against CDSCO and state drug regulator alerts in seconds, with proof you can verify yourself on Arkiv.',
  // The images come from app/opengraph-image.jpg and app/twitter-image.jpg.
  openGraph: {
    type: 'website',
    siteName: 'Nazar',
    title: 'Nazar · Har batch par nazar',
    description: 'Check any Indian medicine batch against CDSCO and state drug regulator alerts in seconds, with proof you can verify yourself on Arkiv.',
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nazar · Har batch par nazar',
    description: 'Check any Indian medicine batch against regulator alerts in seconds, with proof on Arkiv.',
  },
  applicationName: 'Nazar',
  authors: [{ name: 'Pranshu Rastogi', url: 'https://pranshurastogi.com' }],
  creator: 'Pranshu Rastogi',
  publisher: 'Pranshu Rastogi',
  keywords: [
    'Nazar', 'medicine batch check', 'CDSCO drug alert', 'NSQ drugs India', 'spurious medicine', 'not of standard quality',
    'drug recall India', 'Coldrif SR-13', 'diethylene glycol syrup', 'WHO medical product alert', 'state drug controller',
    'Arkiv', 'verifiable data', 'MCP server', 'दवा बैच जाँच',
  ],
  category: 'health',
  // Feed readers and AI agents discover the alert feeds from here; the docs for agents live at /llms.txt.
  alternates: {
    types: {
      'application/rss+xml': [{ url: `${API_ORIGIN}/v1/alerts.rss`, title: 'Nazar · Indian medicine batch alerts (RSS)' }],
      'application/atom+xml': [{ url: `${API_ORIGIN}/v1/alerts.atom`, title: 'Nazar · Indian medicine batch alerts (Atom)' }],
    },
  },
  appleWebApp: { title: 'Nazar', capable: true, statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f3' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0e18' },
  ],
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The server always renders English with lang="en"; LOCALE_SCRIPT corrects lang/data-lang before
    // first paint and LocaleProvider switches the text before the page is revealed (see lib/i18n).
    <html lang="en" data-lang="en" suppressHydrationWarning className={`${notoSans.variable} ${jetbrainsMono.variable} ${devanagari.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOCALE_SCRIPT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, '\\u003c') }} />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <LocaleProvider>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster position="top-center" />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
