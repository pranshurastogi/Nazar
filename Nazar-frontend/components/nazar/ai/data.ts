import type { SentinelState } from '@/components/ui/sentinel-core'
import sr13 from './fixtures/check-sr-13.json'
import look from './fixtures/check-5r-13.json'
import clean from './fixtures/check-ab1234.json'
import samples from './fixtures/tool-samples.json'

// Everything the /ai page says about Nazar's MCP server, in one place. The chat demo and the
// tool examples are real responses from the live server, saved under ./fixtures (fetched with
//   npx -y @modelcontextprotocol/inspector@0.17.2 --cli <MCP_URL> --transport http \
//     --method tools/call --tool-name check_batch --tool-arg batch=SR-13
// ). Nothing here is invented: replies are built from the fixtures' own fields.

export const MCP_URL = 'https://nazar-api-production.up.railway.app/mcp'
export const FETCHED_ON = '18 Oct 2026'

const json = (o: unknown) => JSON.stringify(o, null, 2)

// ---- setup

export type Snippet = { title: string; file?: string; code: string; label: string; wrap?: boolean }
export type Client = {
  id: string
  label: string
  /** One line: where this goes. */
  where: string
  snippets?: Snippet[]
  steps?: { app: string; steps: string[] }[]
  /** One line: how to see it worked. */
  then: string
}

export const CLAUDE_CODE_CMD = `claude mcp add --transport http nazar ${MCP_URL}`

export const CLIENTS: Client[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    where: 'Run this once in a terminal. It adds Nazar for you in every project.',
    snippets: [{ title: 'Terminal', code: CLAUDE_CODE_CMD, label: 'Claude Code command', wrap: true }],
    then: 'Run /mcp inside Claude Code: nazar should be listed as connected.',
  },
  {
    id: 'mcp-json',
    label: '.mcp.json',
    where: 'Save this at the root of a project, so everyone who opens it gets Nazar.',
    snippets: [{ title: 'Project file', file: '.mcp.json', code: json({ mcpServers: { nazar: { type: 'http', url: MCP_URL } } }), label: '.mcp.json config' }],
    then: 'Claude Code asks you to approve project servers the first time it opens the folder.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    where: 'Add this to your global file, or to .cursor/mcp.json inside one project.',
    snippets: [{ title: 'Cursor', file: '~/.cursor/mcp.json', code: json({ mcpServers: { nazar: { url: MCP_URL } } }), label: 'Cursor config' }],
    then: 'Open Cursor Settings → MCP: nazar appears with its six tools.',
  },
  {
    id: 'vscode',
    label: 'VS Code',
    where: 'Add this file to your workspace.',
    snippets: [{ title: 'VS Code', file: '.vscode/mcp.json', code: json({ servers: { nazar: { type: 'http', url: MCP_URL } } }), label: 'VS Code config' }],
    then: 'Start the server from the file, then ask in Copilot Chat in Agent mode.',
  },
  {
    id: 'apps',
    label: 'Claude & ChatGPT',
    where: 'Add Nazar as a custom connector. Paste the endpoint URL; no sign-in is needed.',
    steps: [
      { app: 'Claude Desktop and claude.ai', steps: ['Settings → Connectors', 'Add custom connector', 'Paste the endpoint URL'] },
      { app: 'ChatGPT', steps: ['Settings → Apps & Connectors → Advanced', 'Turn on Developer mode', 'Create connector', 'Paste the URL, with no authentication'] },
    ],
    then: 'Start a new chat and ask about a batch number.',
  },
]

export const TEST_CURL = `curl -s ${MCP_URL} \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_batch","arguments":{"batch":"SR-13"}}}'`

export const TEST_INSPECTOR = `npx -y @modelcontextprotocol/inspector@0.17.2 --cli ${MCP_URL} --transport http --method tools/list`

export const TROUBLESHOOTING = [
  { q: 'Opening the URL in a browser says 405', a: 'Expected. The server is stateless and only answers JSON-RPC sent with POST, so a plain GET is refused.' },
  { q: '“Rate limited … try again in N s”', a: 'Each client gets 60 tool calls a minute. Wait the seconds it names; nothing else is needed.' },
  { q: 'The client asks for sign-in or OAuth', a: 'Choose no authentication. The server is public and read-only.' },
  { q: 'The tools do not show up', a: 'Check the URL ends in /mcp, then restart the client or reload its window.' },
] as const

// ---- tools

export type ToolName = keyof typeof samples.tools
export type ToolInput = { name: string; type: string; note: string; required?: boolean }

export type ToolDoc = { name: ToolName; title: string; answers: string; body: string; inputs: ToolInput[] }

export const TOOLS: ToolDoc[] = [
  {
    name: 'check_batch',
    title: 'Check a medicine batch',
    answers: 'Is this batch named in an official alert?',
    body: 'One of four states, every matching alert with its regulator notice and Arkiv proof, and a “did you mean” for look-alikes.',
    inputs: [{ name: 'batch', type: 'string', note: 'exactly as printed, e.g. SR-13', required: true }],
  },
  {
    name: 'search_alerts',
    title: 'Search alerts',
    answers: 'Which alerts mention Coldrif, paracetamol or a maker?',
    body: 'Full-text search over brand, product, generic name, manufacturer and the failure reason.',
    inputs: [
      { name: 'query', type: 'string', note: '2–100 characters', required: true },
      { name: 'limit', type: 'number', note: '1–50, default 10' },
    ],
  },
  {
    name: 'recent_alerts',
    title: 'Recent alerts',
    answers: 'What has been flagged lately?',
    body: 'The newest alerts first, filtered by severity, Child Shield, the state where it was made or the regulator.',
    inputs: [
      { name: 'minSeverity', type: '1–5', note: 'at or above' },
      { name: 'childShield', type: 'boolean', note: 'children’s medicines, severity 4+' },
      { name: 'state', type: 'string', note: 'e.g. IN-TN' },
      { name: 'source', type: 'string', note: 'e.g. cdsco-online' },
      { name: 'limit', type: 'number', note: '1–50' },
    ],
  },
  {
    name: 'get_case',
    title: 'Batch Passport',
    answers: 'Which notices named this same batch?',
    body: 'Every notice and regulator that named one batch, oldest first.',
    inputs: [{ name: 'caseId', type: 'hex id', note: 'from another result', required: true }],
  },
  {
    name: 'list_sources',
    title: 'Regulator sources',
    answers: 'Which regulators does Nazar read, and when?',
    body: 'Each source, whether it is on (and why not), its schedule and when it was last checked.',
    inputs: [],
  },
  {
    name: 'arkiv_proof',
    title: 'Verify on Arkiv',
    answers: 'Is this alert genuine and unaltered?',
    body: 'Reads the entity straight from the Arkiv chain, not from Nazar: creator, official-publisher check, flags and expiry.',
    inputs: [{ name: 'entityKey', type: '0x + 64 hex', note: 'arkiv.entityKey of an alert', required: true }],
  },
]

export const TOOL_SAMPLES = samples.tools

/** `check_batch({ batch: "SR-13" })`: how the example call reads on a card. */
export const callLine = (name: ToolName) => {
  const args = Object.entries(TOOL_SAMPLES[name].args)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v.length > 20 ? `${v.slice(0, 10)}…${v.slice(-6)}` : v}"` : v}`)
    .join(', ')
  return `${name}(${args ? `{ ${args} }` : ''})`
}

export const RESOURCES = [
  { uri: 'nazar://about', title: 'About Nazar', body: 'What Nazar is, the four answers, how severity is scored, and what is out of scope.' },
  { uri: 'nazar://schema', title: 'Arkiv data contract', body: 'Entity types, attributes, lifetimes and the queries Nazar runs on Arkiv.' },
] as const

export const PROMPT = {
  name: 'check_my_medicine',
  title: 'Check my medicine',
  body: 'Walks a person through finding “B. No.” on the pack, typing it exactly, and reading the answer honestly.',
  arg: 'medicine (optional)',
}

// ---- the rules (the server's INSTRUCTIONS, verbatim from Nazar-backend/src/mcp/server.ts)

export const INSTRUCTIONS = `Nazar checks Indian medicine batch numbers against official drug-regulator alerts (CDSCO, state drug controllers, WHO Medical Product Alerts) and publishes every alert as a verifiable entity on Arkiv (Tiramisu testnet).

Rules for repeating Nazar's answers to a person:
1. Every check has exactly one of four states: "flagged", "retracted", "no_alert" (say "No alert found") or "unreadable" (say "Can't tell"). Report the state as given; never upgrade or soften it.
2. Never say a medicine or batch is "safe", "genuine", "fine" or "approved". "No alert found" is NOT a safety certificate; always say so.
3. When a batch is flagged, name the regulator, the notice title and date, link the notice URL and the Arkiv entity (explorer link), and give the reason in the regulator's words. Advise: stop using it, keep the pack, return it to the chemist, and see a doctor if it was taken. Do not blame a company beyond what the notice says.
4. A "did you mean" suggestion is never a flag. Ask the person to re-read the batch number on the pack and check again.
5. The same batch number can be used by different manufacturers. Before concluding, confirm the brand and manufacturer on the pack match the alert.
6. Use arkiv_proof to show that an alert can be verified directly on Arkiv, without trusting Nazar.
7. Out of scope: general medicine information, dosing, interactions and medical advice. Point people to a pharmacist or doctor.

All tools are read-only. Limit: 60 tool calls per minute per client.`

// ---- the chat demo

export type DemoState = Extract<SentinelState, 'flagged' | 'unreadable' | 'no_alert'>

/** A paragraph of the reply; **bold** marks the verdict word. `quiet` renders it small and muted. */
export type ReplyPara = { text: string; quiet?: boolean }

export type Scenario = {
  id: DemoState
  tab: string
  batch: string
  question: string
  toolText: string
  reply: ReplyPara[]
  links: { label: string; href: string; detail: string }[]
}

type Check = typeof sr13.structuredContent

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "13 Oct 2025", formatted by hand so the server and the browser always agree. */
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
/** "18 Oct 2026, 17:22 IST": the check's time in India. */
const stamp = (iso: string) => {
  const ist = new Date(Date.parse(iso) + 330 * 60_000).toISOString()
  return `${day(ist)}, ${ist.slice(11, 16)} IST`
}
const shortKey = (k: string) => `${k.slice(0, 6)}…${k.slice(-4)}`

const NOT_ADVICE = 'This is not medical advice. I am repeating what the regulator published, through Nazar.'

function flaggedScenario(r: typeof sr13): Scenario {
  const s: Check = r.structuredContent
  const live = s.alerts.filter((a) => !a.retracted)
  // Cite the alert that states the reason most fully, in the regulator's own words.
  const a = [...live].sort((x, y) => y.reason.length - x.reason.length)[0]
  const brand = a.brand
  return {
    id: 'flagged',
    tab: 'Flagged',
    batch: s.batch,
    question: `Is batch ${s.batch} of Coldrif safe for my child?`,
    toolText: r.content[0].text,
    reply: [
      { text: `**Flagged.** Batch ${s.batch} of ${brand} is named in ${live.length} official regulator ${live.length === 1 ? 'alert' : 'alerts'}.` },
      {
        text: `${a.regulator.authority} listed it in “${a.notice.title}” (${day(a.notice.date)}) as ${a.categoryLabel.toLowerCase()}: “${a.reason}.” Maker on the alert: ${a.manufacturer}. Severity ${a.severity}/5${a.childShield ? ', with Child Shield because it is a children’s medicine' : ''}.`,
      },
      { text: 'First check that the brand and manufacturer on your pack match. If they do: stop giving it, keep the pack, return it to the chemist, and see a doctor if your child has taken it.' },
      { text: NOT_ADVICE, quiet: true },
    ],
    links: [
      { label: `${a.regulator.authority.split(' ')[0]} notice`, href: a.notice.url, detail: day(a.notice.date) },
      { label: 'Arkiv entity', href: a.arkiv.explorer, detail: shortKey(a.arkiv.entityKey) },
    ],
  }
}

function lookalikeScenario(r: typeof look): Scenario {
  const s = r.structuredContent
  return {
    id: 'unreadable',
    tab: 'Can’t tell',
    batch: s.batch,
    question: `Can you check batch ${s.batch}? It’s on the Coldrif bottle.`,
    toolText: r.content[0].text,
    reply: [
      { text: `**Can’t tell.** There is no exact match for ${s.batch}, but an alerted batch looks similar: ${s.suggestion}.` },
      { text: `A look-alike is never a flag: 5 and S are easy to misread. Please re-read the batch number on the pack, letter by letter, and send it to me exactly as printed. I’ll check again.` },
      { text: 'Not medical advice. Nazar only repeats what regulators publish.', quiet: true },
    ],
    links: [],
  }
}

function noAlertScenario(r: typeof clean): Scenario {
  const s = r.structuredContent
  return {
    id: 'no_alert',
    tab: 'No alert',
    batch: s.batch,
    question: `My dad’s BP tablets say batch ${s.batch}. Any alerts?`,
    toolText: r.content[0].text,
    reply: [
      { text: `**No alert found.** No official regulator alert in Nazar’s records names batch ${s.batch} (as of ${stamp(s.asOf)}).` },
      { text: s.notice },
      { text: 'Check the batch number again on the pack, and ask a pharmacist if in doubt.' },
      { text: 'Not medical advice. Nazar only repeats what regulators publish.', quiet: true },
    ],
    links: [],
  }
}

export const SCENARIOS: Scenario[] = [flaggedScenario(sr13), lookalikeScenario(look), noAlertScenario(clean)]

export const STATE_WORD: Record<DemoState, string> = { flagged: 'Flagged', unreadable: 'Can’t tell', no_alert: 'No alert found' }

/** Tailwind classes for each answer: red flagged, amber can't tell, slate no alert (never green). */
export const STATE_TONE: Record<DemoState, { dot: string; pill: string; text: string }> = {
  flagged: { dot: 'bg-flagged', pill: 'border-flagged-border bg-flagged-soft text-flagged', text: 'text-flagged' },
  unreadable: { dot: 'bg-caution', pill: 'border-caution-border bg-caution-soft text-caution', text: 'text-caution' },
  no_alert: { dot: 'bg-quiet', pill: 'border-quiet-border bg-quiet-soft text-quiet', text: 'text-quiet' },
}
