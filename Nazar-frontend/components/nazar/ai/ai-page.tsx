import { ChatDemo } from './chat-demo'
import { Connect } from './connect'
import { AiHero } from './hero'
import { Limits } from './limits'
import { Rules } from './rules'
import { Setup } from './setup'
import { Tools } from './tools'
import './ai.css'

// /ai: Nazar for AI assistants. The story runs top to bottom: what it is (hero), what it looks
// like in a chat (the demo, from real server responses), how a question travels, how to set it
// up, what each tool answers, the rules the assistant must follow, and what the server can see.

export function AiPage() {
  return (
    <div className="pt-2 md:pt-4" data-ai-page>
      <AiHero />

      <section className="mt-10 sm:mt-14" aria-labelledby="ai-demo-title" data-ai-demo>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="max-w-[60ch]">
            <h2 id="ai-demo-title" className="text-[1.625rem] leading-tight font-semibold tracking-[-0.03em] text-balance sm:text-3xl">
              Three questions, three honest answers.
            </h2>
            <p className="mt-2 text-[15px] leading-7 text-pretty text-muted-foreground">
              Each reply is built from Nazar&rsquo;s real response. Watch the assistant call <code className="font-mono text-[13px] text-foreground">check_batch</code>, then switch questions.
            </p>
          </div>
        </div>
        <ChatDemo />
      </section>

      <div className="mt-6 divide-y border-t sm:mt-10">
        <Connect />
        <Setup />
        <Tools />
        <Rules />
        <Limits />
      </div>
    </div>
  )
}
