'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { CircleHelp, Languages, Laptop, Moon, Sun, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useShell } from '@/components/nazar/app-shell'
import { clearCabinet, clearRecent, RECENT_KEY, useCabinet, useHydrated } from '@/lib/cabinet'
import { useT, type Locale } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { panel, Section } from './shared'

/** English or Hindi for the whole app, saved on this device. Labels are in both scripts so either reader finds it. */
function LanguageSetting({ row }: { row: string }) {
  const { t, locale, setLocale } = useT()
  const hydrated = useHydrated()
  const options: { value: Locale; label: string; lang: string }[] = [
    { value: 'en', label: t('lang.optionEn'), lang: 'en' },
    { value: 'hi', label: t('lang.optionHi'), lang: 'hi' },
  ]
  return (
    <div className={row} data-language-setting>
      <div>
        <p className="text-sm font-semibold" id="language-label">
          {t('lang.settingTitle')} <span className="font-normal text-muted-foreground">· {locale === 'hi' ? 'Language' : 'भाषा'}</span>
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{t('lang.settingHint')}</p>
      </div>
      <div role="radiogroup" aria-labelledby="language-label" className="grid h-12 grid-cols-2 overflow-hidden rounded-xl border bg-background sm:w-80">
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            lang={o.lang}
            aria-checked={hydrated ? locale === o.value : false}
            data-lang-option={o.value}
            onClick={() => setLocale(o.value)}
            className={cn(
              'flex h-full items-center justify-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
              hydrated && locale === o.value && 'bg-primary/10 text-primary hover:text-primary',
            )}
          >
            <Languages className="size-4" aria-hidden="true" /> {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Settings() {
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()
  const shell = useShell()
  const cabinet = useCabinet()
  const [recentCount, setRecentCount] = useState(0)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    try {
      const r: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
      setRecentCount(Array.isArray(r) ? r.length : 0)
    } catch {}
  }, [])

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Laptop },
  ]
  const current = hydrated ? (theme ?? 'system') : null

  const row = 'flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between'

  return (
    <Section id="settings" kicker="Settings" title="Make Nazar yours">
      <div className={cn(panel, 'divide-y px-5 sm:px-6')}>
        <div className={row}>
          <div>
            <p className="text-sm font-semibold" id="theme-label">Theme</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">System follows your phone or computer.</p>
          </div>
          <div role="radiogroup" aria-labelledby="theme-label" className="grid h-12 grid-cols-3 overflow-hidden rounded-xl border bg-background sm:w-80">
            {themes.map((t) => (
              <button
                key={t.value}
                role="radio"
                aria-checked={current === t.value}
                data-theme-option={t.value}
                onClick={() => setTheme(t.value)}
                className={cn(
                  'flex h-full items-center justify-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
                  current === t.value && 'bg-primary/10 text-primary hover:text-primary',
                )}
              >
                <t.icon className="size-4" aria-hidden="true" /> {t.label}
              </button>
            ))}
          </div>
        </div>

        <LanguageSetting row={row} />

        <div className={row}>
          <div>
            <p className="text-sm font-semibold">Guide</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">The four-step tour from your first visit.</p>
          </div>
          <Button variant="outline" className="h-12 px-4 sm:w-56" onClick={shell.openGuide}>
            <CircleHelp /> Replay the guide
          </Button>
        </div>

        <div className={row}>
          <div>
            <p className="text-sm font-semibold">Recent checks</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {recentCount ? `${recentCount} saved on this device.` : 'Nothing saved yet.'}
            </p>
          </div>
          <Button
            variant="outline"
            className="h-12 px-4 sm:w-56"
            disabled={!recentCount}
            onClick={() => {
              clearRecent()
              setRecentCount(0)
              toast.success('Recent checks cleared')
            }}
          >
            <Trash2 /> Clear recent checks
          </Button>
        </div>

        <div className={row} data-clear-cabinet>
          <div>
            <p className="text-sm font-semibold">Medicine cabinet</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {!hydrated ? ' ' : cabinet.length ? `${cabinet.length} ${cabinet.length === 1 ? 'medicine' : 'medicines'} saved on this device.` : 'Empty.'}{' '}
              {hydrated && cabinet.length > 0 && (
                <Link href="/cabinet" className="font-medium text-primary underline-offset-2 hover:underline">Open cabinet</Link>
              )}
            </p>
          </div>
          {!confirming ? (
            <Button variant="destructive" className="h-12 px-4 sm:w-56" disabled={!hydrated || !cabinet.length} onClick={() => setConfirming(true)}>
              <Trash2 /> Clear cabinet
            </Button>
          ) : (
            <div role="group" aria-label="Confirm clearing the cabinet" className="rounded-xl border border-flagged-border bg-flagged-soft p-3 sm:max-w-sm">
              <p className="text-[13px] font-medium">
                Remove all {cabinet.length} {cabinet.length === 1 ? 'medicine' : 'medicines'} from this device? This can&apos;t be undone. Export first if you want a copy.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" className="h-11 flex-1" onClick={() => setConfirming(false)} autoFocus>
                  Cancel
                </Button>
                <Button
                  className="h-11 flex-1 bg-flagged font-semibold text-white hover:bg-flagged/90 dark:text-background"
                  onClick={() => {
                    clearCabinet()
                    setConfirming(false)
                    toast.success('Cabinet cleared')
                  }}
                >
                  Yes, clear it
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}
