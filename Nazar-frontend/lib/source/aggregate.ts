import type { SnapshotIndex } from './snapshot'

// Read-only counts over the on-device snapshot for the Feed's "India pulse" visual. Nothing here
// is hard-coded: every number comes from the snapshot the device holds, and the caller shows its
// generatedAt as "as of". Field order is Nazar-backend/src/api/snapshot.ts (see snapshot.ts).

/** One snapshot row, flattened to what the visual counts. */
type Fact = {
  state: string | null
  severity: number
  peds: boolean
  /** spurious or adulterated (toxic glycol): the gravest categories. */
  grave: boolean
  failure: string
  source: string
  ym: number
  /** false when the regulator gave no date (ym is only when Nazar first saw the row). */
  dated: boolean
  medicine: boolean
}

const facts = new WeakMap<SnapshotIndex, Fact[]>()

/** Flattens a snapshot once; retractions are left out, as in the feed. */
function factsOf(s: SnapshotIndex): Fact[] {
  const hit = facts.get(s)
  if (hit) return hit
  const out: Fact[] = []
  for (const rows of Object.values(s.file.alerts)) {
    for (const r of rows) {
      if (r[19] === 1) continue
      out.push({
        state: r[13],
        severity: r[9],
        peds: r[10] === 1,
        grave: r[6] === 'spurious' || r[6] === 'adulterated',
        failure: r[7],
        source: s.file.notices[r[1]]?.[4] ?? '',
        ym: r[16],
        dated: r[20] !== 0,
        medicine: (r[21] ?? 'medicine') === 'medicine',
      })
    }
  }
  facts.set(s, out)
  return out
}

/** The Feed filters the visual follows (all but the state, which the map itself sets). */
export type PulseFilter = { minSeverity?: number; peds?: boolean; source?: string; medicinesOnly?: boolean }

export type Tally = { total: number; sev5: number; serious: number; peds: number; grave: number }

export type StateTally = Tally & { code: string; topFailure: [string, number] | null }

export type MonthTally = {
  ym: number
  /** count per severity, index 0 = severity 1 … index 4 = severity 5. */
  bySeverity: [number, number, number, number, number]
  total: number
  peds: number
  grave: number
}

export type Pulse = {
  asOf: Date
  /** Totals for the current view (state included). */
  tally: Tally
  /** Per state, ignoring the state filter so every tile keeps its count. */
  states: Map<string, StateTally>
  /** Rows (state filter ignored) whose maker's state is not known. */
  noState: number
  /** Busiest state for these filters (ignoring the state filter). */
  maxState: number
  /** Every month from the first dated alert to the last, empty months included. */
  months: MonthTally[]
  /** Rows in the current view with no regulator date: never placed on the timeline. */
  undated: number
  /** Cosmetics and hygiene rows hidden by medicinesOnly (0 when shown). */
  hiddenNonMedicine: number
  /** Cosmetics and hygiene rows in the current view (shown or not). */
  nonMedicine: number
  /** Every alert in the snapshot, before any filter (retractions left out): "N alerts in Nazar's ledger". */
  ledgerTotal: number
}

const emptyTally = (): Tally => ({ total: 0, sev5: 0, serious: 0, peds: 0, grave: 0 })

function add(t: Tally, f: Fact) {
  t.total++
  if (f.severity >= 5) t.sev5++
  if (f.severity >= 4) t.serious++
  if (f.peds) t.peds++
  if (f.grave) t.grave++
}

const nextYm = (ym: number) => (ym % 100 === 12 ? ym + 89 : ym + 1)

/** Counts for the visual. `state` narrows the totals and timeline but not the per-state tiles. */
export function aggregate(s: SnapshotIndex, f: PulseFilter, state = ''): Pulse {
  const tally = emptyTally()
  const states = new Map<string, StateTally>()
  const failures = new Map<string, Map<string, number>>()
  const byMonth = new Map<number, MonthTally>()
  let noState = 0
  let undated = 0
  let hiddenNonMedicine = 0
  let nonMedicine = 0

  for (const x of factsOf(s)) {
    if (f.minSeverity && x.severity < f.minSeverity) continue
    if (f.peds && !x.peds) continue
    if (f.source && x.source !== f.source) continue
    const inState = !state || x.state === state
    if (!x.medicine && inState) nonMedicine++
    if (f.medicinesOnly && !x.medicine) {
      if (inState) hiddenNonMedicine++
      continue
    }

    if (x.state) {
      let st = states.get(x.state)
      if (!st) states.set(x.state, (st = { ...emptyTally(), code: x.state, topFailure: null }))
      add(st, x)
      let fm = failures.get(x.state)
      if (!fm) failures.set(x.state, (fm = new Map()))
      fm.set(x.failure, (fm.get(x.failure) ?? 0) + 1)
    } else noState++

    if (!inState) continue
    add(tally, x)
    if (!x.dated) {
      undated++
      continue
    }
    let m = byMonth.get(x.ym)
    if (!m) byMonth.set(x.ym, (m = { ym: x.ym, bySeverity: [0, 0, 0, 0, 0], total: 0, peds: 0, grave: 0 }))
    m.bySeverity[Math.min(5, Math.max(1, x.severity)) - 1]++
    m.total++
    if (x.peds) m.peds++
    if (x.grave) m.grave++
  }

  for (const [code, fm] of failures) {
    let best: [string, number] | null = null
    for (const e of fm) if (e[0] !== 'other' && (!best || e[1] > best[1])) best = e
    states.get(code)!.topFailure = best
  }

  // A continuous month axis, so a quiet month reads as a gap rather than vanishing.
  const months: MonthTally[] = []
  const keys = [...byMonth.keys()].sort((a, b) => a - b)
  if (keys.length) {
    for (let ym = keys[0]; ym <= keys[keys.length - 1] && months.length < 240; ym = nextYm(ym)) {
      months.push(byMonth.get(ym) ?? { ym, bySeverity: [0, 0, 0, 0, 0], total: 0, peds: 0, grave: 0 })
    }
  }

  let maxState = 0
  for (const st of states.values()) maxState = Math.max(maxState, st.total)

  return { asOf: s.generatedAt, tally, states, noState, maxState, months, undated, hiddenNonMedicine, nonMedicine, ledgerTotal: factsOf(s).length }
}

const nice = (v: number) => (v < 10 ? Math.round(v) : v < 100 ? Math.round(v / 5) * 5 : Math.round(v / 10) * 10)

/**
 * Lower bounds of the shading steps for a map whose busiest tile has `max` alerts: 1, then
 * log-spaced, rounded to friendly numbers. At most four steps; fewer when counts are small.
 */
export function shadeSteps(max: number): number[] {
  if (max <= 0) return [1]
  const steps = [1]
  for (const k of [1, 2, 3]) {
    const v = Math.max(1, nice(Math.pow(max, k / 4)))
    if (v > steps[steps.length - 1] && v <= max) steps.push(v)
  }
  return steps
}

/** Plain names for the failure codes, for the short readout ("most often: wrong strength"). */
const FAILURE_SHORT: Record<string, string> = {
  assay: 'wrong strength',
  dissolution: 'does not dissolve',
  description: 'wrong appearance',
  identification: 'ingredient not found',
  labelling: 'labelling',
  sterility: 'not sterile',
  particulate: 'particles found',
  disintegration: 'does not break down',
  uniformity: 'uneven dose',
  ph: 'wrong pH',
  spurious: 'spurious',
  microbial: 'microbial contamination',
  related_substances: 'excess impurities',
  glycol: 'toxic glycol',
  endotoxin: 'endotoxin',
}

export const failureShort = (code: string) => FAILURE_SHORT[code] ?? code.replace(/_/g, ' ')
