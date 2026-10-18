import type { Metadata } from 'next'

import { Cabinet } from '@/components/nazar/cabinet'

export const metadata: Metadata = {
  title: 'My medicine cabinet · Nazar',
  description: 'Save the medicines you keep at home and re-check every batch against regulator alerts. Stored only on your device.',
}

export default function CabinetPage() {
  return <Cabinet />
}
