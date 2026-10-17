import type { Metadata } from 'next'

import { Feed } from '@/components/nazar/feed'

export const metadata: Metadata = {
  title: 'Alert feed · Nazar',
  description: 'Every medicine batch alert from CDSCO, state drug regulators and WHO, newest first, with proof.',
}

export default function FeedPage() {
  return <Feed />
}
