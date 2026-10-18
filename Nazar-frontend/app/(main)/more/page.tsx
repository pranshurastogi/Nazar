import type { Metadata } from 'next'

import { More } from '@/components/nazar/more'

export const metadata: Metadata = {
  title: 'More · Nazar',
  description: 'How Nazar works, its regulator sources, proof on Arkiv, privacy, settings and about.',
}

export default function MorePage() {
  return <More />
}
