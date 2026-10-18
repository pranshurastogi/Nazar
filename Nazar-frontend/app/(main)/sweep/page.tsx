import type { Metadata } from 'next'

import { SweepPage } from '@/components/nazar/sweep/sweep-page'

export const metadata: Metadata = {
  title: 'Shelf sweep · Nazar',
  description:
    'Check up to 500 medicine batch numbers at once against CDSCO, state regulator and WHO alerts. For chemists, pharmacies and NGOs: the list is processed on your device, and the answers export as CSV.',
}

export default function ShelfSweepPage() {
  return <SweepPage />
}
