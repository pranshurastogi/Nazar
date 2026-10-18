import { useSyncExternalStore } from 'react'

import { matchKey, validateBatch, type Answerer, type ResultState } from '@/lib/source'

// The medicine cabinet lives only in this browser's localStorage. Nothing here talks to
// a server: re-checks go through checkBatch one batch number at a time, never the list.

export const CABINET_KEY = 'nazar:cabinet'
export const RECENT_KEY = 'nazar:recent'
const CHANGE_EVENT = 'nazar:cabinet-change'

export const NAME_MAX = 60
export const NOTE_MAX = 80
/** Optional label details (from a photo of the pack, or typed). Older saved items have none. */
export const MAKER_MAX = 80
export const INGREDIENT_MAX = 80
export const INGREDIENTS_MAX = 8

/** What the last re-check said, kept so the list renders before the next one lands. */
export type LastCheck = { state: ResultState; source: Answerer; at: number; brand?: string }

export type CabinetItem = {
  id: string
  name: string
  batch: string
  /** Expiry month printed on the pack, YYYY-MM. */
  expiry: string | null
  note: string
  /** Active ingredients as printed, e.g. "Paracetamol IP 650 mg". Optional. */
  composition?: string[]
  /** Manufacturer as printed on the pack. Optional. */
  maker?: string
  addedAt: number
  last: LastCheck | null
}

export type CabinetDraft = Pick<CabinetItem, 'name' | 'batch' | 'expiry' | 'note'> & Partial<Pick<CabinetItem, 'composition' | 'maker'>>

/** Cleans a typed or read ingredient list: trimmed, de-duplicated, at most INGREDIENTS_MAX entries. */
export function cleanComposition(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,;]+/) : []
  const out: string[] = []
  for (const x of list) {
    if (typeof x !== 'string') continue
    const v = x.replace(/\s+/g, ' ').trim().slice(0, INGREDIENT_MAX)
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v)
    if (out.length >= INGREDIENTS_MAX) break
  }
  return out
}

const STATES = new Set<ResultState>(['flagged', 'retracted', 'no_alert', 'unreadable'])
const ANSWERERS = new Set<Answerer>(['api', 'arkiv', 'demo', 'local', 'snapshot'])
const YM = /^\d{4}-(0[1-9]|1[0-2])$/

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Accepts anything (localStorage, an imported file) and keeps only well-formed items. */
function clean(raw: unknown): CabinetItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, NAME_MAX) : ''
  const v = validateBatch(typeof o.batch === 'string' ? o.batch : '')
  if (!name || !v.ok) return null
  const l = o.last as Record<string, unknown> | null | undefined
  const last: LastCheck | null =
    l && STATES.has(l.state as ResultState) && ANSWERERS.has(l.source as Answerer) && typeof l.at === 'number'
      ? { state: l.state as ResultState, source: l.source as Answerer, at: l.at, ...(typeof l.brand === 'string' ? { brand: l.brand } : {}) }
      : null
  const composition = cleanComposition(o.composition)
  const maker = typeof o.maker === 'string' ? o.maker.replace(/\s+/g, ' ').trim().slice(0, MAKER_MAX) : ''
  return {
    id: typeof o.id === 'string' && o.id ? o.id.slice(0, 64) : newId(),
    name,
    batch: v.batch,
    expiry: typeof o.expiry === 'string' && YM.test(o.expiry) ? o.expiry : null,
    note: typeof o.note === 'string' ? o.note.trim().slice(0, NOTE_MAX) : '',
    // Optional fields are only written when present, so older items round-trip unchanged.
    ...(composition.length ? { composition } : {}),
    ...(maker ? { maker } : {}),
    addedAt: typeof o.addedAt === 'number' ? o.addedAt : Date.now(),
    last,
  }
}

const EMPTY: CabinetItem[] = []
let cached: { raw: string | null; items: CabinetItem[] } = { raw: null, items: EMPTY }

function read(): CabinetItem[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(CABINET_KEY)
  } catch {}
  if (raw === cached.raw) return cached.items
  let items = EMPTY
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) items = parsed.map(clean).filter((x): x is CabinetItem => x !== null)
  } catch {}
  cached = { raw, items }
  return items
}

/** The current cabinet, read synchronously (for event handlers that run before a re-render). */
export const readCabinet = () => read()

function write(items: CabinetItem[]) {
  try {
    localStorage.setItem(CABINET_KEY, JSON.stringify(items))
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => (e.key === null || e.key === CABINET_KEY) && onChange()
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** The cabinet, kept in sync across components and tabs. Empty during server render. */
export function useCabinet() {
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}

/** False during server render and hydration, so stored data never causes a mismatch. */
export function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
}

export const findByBatch = (items: CabinetItem[], batch: string, exceptId?: string) =>
  items.find((i) => i.id !== exceptId && matchKey(i.batch) === matchKey(batch))

export function addItem(draft: CabinetDraft): CabinetItem {
  const item = clean({ ...draft, id: newId(), addedAt: Date.now(), last: null })
  if (!item) throw new Error('Invalid cabinet item')
  write([item, ...read()])
  return item
}

export function updateItem(id: string, patch: Partial<CabinetDraft>) {
  write(read().map((i) => (i.id === id ? (clean({ ...i, ...patch, last: patch.batch && matchKey(patch.batch) !== matchKey(i.batch) ? null : i.last }) ?? i) : i)))
}

export function recordCheck(id: string, last: LastCheck) {
  write(read().map((i) => (i.id === id ? { ...i, last } : i)))
}

export function removeItem(id: string): CabinetItem | undefined {
  const items = read()
  const gone = items.find((i) => i.id === id)
  write(items.filter((i) => i.id !== id))
  return gone
}

/** Puts a removed item back where it was (undo). */
export function restoreItem(item: CabinetItem, index: number) {
  const items = read().filter((i) => i.id !== item.id)
  items.splice(Math.min(index, items.length), 0, item)
  write(items)
}

export function clearCabinet() {
  write([])
}

export function clearRecent() {
  try {
    localStorage.removeItem(RECENT_KEY)
  } catch {}
}

/** The export file: versioned so a future format can still read it. */
export function exportJson(items: CabinetItem[]) {
  return JSON.stringify({ app: 'nazar', kind: 'cabinet', version: 1, exportedAt: new Date().toISOString(), items }, null, 2)
}

/**
 * Merges an exported file into the cabinet. Items are matched by batch number, so
 * importing the same file twice does not duplicate anything.
 */
export function importJson(text: string): { added: number; updated: number; skipped: number } {
  const parsed: unknown = JSON.parse(text)
  const list: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { items?: unknown })?.items) ? (parsed as { items: unknown[] }).items : []
  if (!list.length) throw new Error('No medicines found in this file')
  const items = [...read()]
  let added = 0
  let updated = 0
  let skipped = 0
  for (const raw of list) {
    const item = clean(raw)
    if (!item) {
      skipped++
      continue
    }
    const at = items.findIndex((i) => matchKey(i.batch) === matchKey(item.batch))
    if (at >= 0) {
      items[at] = { ...item, id: items[at]!.id }
      updated++
    } else {
      items.push(item)
      added++
    }
  }
  write(items)
  return { added, updated, skipped }
}

export type ExpiryStatus = { kind: 'expired' | 'soon'; label: string } | null

const SOON_DAYS = 60

/** A pack is usable through the end of its expiry month. */
export function expiryStatus(expiry: string | null, now = new Date()): ExpiryStatus {
  if (!expiry || !YM.test(expiry)) return null
  const [y, m] = expiry.split('-').map(Number) as [number, number]
  const end = new Date(y, m, 1).getTime()
  const left = end - now.getTime()
  if (left <= 0) return { kind: 'expired', label: "Expired – don't use" }
  if (left <= SOON_DAYS * 24 * 60 * 60 * 1000) return { kind: 'soon', label: 'Expires soon' }
  return null
}

/** "Oct 2026" (English) or "अक्टूबर 2026" (Hindi short months read badly, so the full name). */
export function formatExpiry(expiry: string | null, locale: 'en' | 'hi' = 'en') {
  if (!expiry || !YM.test(expiry)) return null
  const [y, m] = expiry.split('-').map(Number) as [number, number]
  return new Date(y, m - 1, 1).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { month: locale === 'hi' ? 'long' : 'short', year: 'numeric' })
}
