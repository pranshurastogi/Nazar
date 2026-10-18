import type { Metadata } from 'next'

import { AiPage } from '@/components/nazar/ai/ai-page'

export const metadata: Metadata = {
  title: 'Nazar for AI assistants',
  description:
    "Connect Claude, ChatGPT, Cursor, VS Code or any MCP client to Nazar's read-only MCP server: check Indian medicine batches against regulator alerts, cite the notice and verify it on Arkiv.",
}

export default function AiAssistantPage() {
  return <AiPage />
}
