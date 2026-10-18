import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Noto_Sans } from 'next/font/google'

import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

const notoSans = Noto_Sans({ subsets: ['latin'], variable: '--font-noto-sans', display: 'swap' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono', display: 'swap' })

// Absolute URLs for social cards: the production domain unless a deploy says otherwise.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nazar-nu.vercel.app'

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
  authors: [{ name: 'Pranshu Rastogi' }],
  creator: 'Pranshu Rastogi',
  publisher: 'Pranshu Rastogi',
  keywords: ['Nazar', 'CDSCO', 'drug alert', 'batch check', 'NSQ', 'India', 'Arkiv'],
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
    <html lang="en" suppressHydrationWarning className={`${notoSans.variable} ${jetbrainsMono.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  )
}
