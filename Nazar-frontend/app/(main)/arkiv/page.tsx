import type { Metadata } from 'next'

import { ArkivDirectory } from '@/components/nazar/arkiv/directory'

export const metadata: Metadata = {
  title: 'Arkiv directory · Nazar',
  description: 'Explore every alert, notice and heartbeat Nazar has published on Arkiv, with the exact query behind each view.',
}

export default function ArkivPage() {
  return <ArkivDirectory />
}
