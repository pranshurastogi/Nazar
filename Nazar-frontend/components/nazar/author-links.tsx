import { Globe } from 'lucide-react'

import { cn } from '@/lib/utils'

// Who built Nazar, and where to find him. Shown in the sidebar, the footer and More › About.

export const AUTHOR = { name: 'Pranshu Rastogi', site: 'https://pranshurastogi.com' } as const

type Glyph = (p: { className?: string }) => React.ReactElement

const X: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.17h1.7L7.42 4.74H5.6l11.07 14.43Z" />
  </svg>
)
const GitHub: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
  </svg>
)
const LinkedIn: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
  </svg>
)
const YouTube: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M23.5 6.2a3 3 0 0 0-2.12-2.13C19.5 3.56 12 3.56 12 3.56s-7.5 0-9.38.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.12 2.13c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3 3 0 0 0 2.12-2.13A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8ZM9.6 15.57V8.43L15.82 12 9.6 15.57Z" />
  </svg>
)
const Medium: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M13.54 12a6.77 6.77 0 1 1-13.54 0 6.77 6.77 0 0 1 13.54 0Zm7.42 0c0 3.54-1.51 6.42-3.38 6.42S14.2 15.54 14.2 12s1.51-6.42 3.38-6.42S20.96 8.46 20.96 12ZM24 12c0 3.17-.53 5.75-1.19 5.75s-1.19-2.58-1.19-5.75.53-5.75 1.19-5.75S24 8.83 24 12Z" />
  </svg>
)
const Site: Glyph = ({ className }) => <Globe className={className} aria-hidden="true" />

export const SOCIALS: { label: string; handle: string; href: string; Icon: Glyph }[] = [
  { label: 'X', handle: '@pranshurastogii', href: 'https://x.com/pranshurastogii', Icon: X },
  { label: 'GitHub', handle: 'pranshurastogi', href: 'https://github.com/pranshurastogi', Icon: GitHub },
  { label: 'LinkedIn', handle: 'rastogipranshu', href: 'https://www.linkedin.com/in/rastogipranshu/', Icon: LinkedIn },
  { label: 'YouTube', handle: '@pranshurastogi', href: 'https://www.youtube.com/@pranshurastogi', Icon: YouTube },
  { label: 'Medium', handle: 'pranshurastogi', href: 'https://pranshurastogi.medium.com/', Icon: Medium },
  { label: 'Website', handle: 'pranshurastogi.com', href: AUTHOR.site, Icon: Site },
]

/** Icon-only row (sidebar, footer): 44px hit areas, each labelled for screen readers. */
export function SocialIcons({ only, className }: { only?: string[]; className?: string }) {
  const items = only ? SOCIALS.filter((s) => only.includes(s.label)) : SOCIALS
  return (
    <ul className={cn('flex flex-wrap items-center', className)} aria-label={`${AUTHOR.name} online`} data-socials>
      {items.map(({ label, handle, href, Icon }) => (
        <li key={label}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener me"
            aria-label={`${AUTHOR.name} on ${label} (${handle})`}
            title={`${label} · ${handle}`}
            className="grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            data-social={label}
          >
            <Icon className="size-4" />
          </a>
        </li>
      ))}
    </ul>
  )
}

/** Labelled chips (More › About). */
export function SocialChips({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-2', className)} aria-label={`${AUTHOR.name} online`} data-socials>
      {SOCIALS.map(({ label, handle, href, Icon }) => (
        <li key={label}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener me"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border bg-card px-3.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            data-social={label}
          >
            <Icon className="size-4 text-muted-foreground" />
            <span>{label}</span>
            <span className="font-mono text-xs text-muted-foreground">{handle}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
