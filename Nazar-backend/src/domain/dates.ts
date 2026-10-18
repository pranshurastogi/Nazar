/** Dates on Indian regulator notices, normalised to YYYYMM integers for range queries on Arkiv. */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

const year = (y: string) => {
  const n = Number(y)
  if (y.length === 2) return n + 2000
  return n
}

const ym = (y: number, m: number) => (m >= 1 && m <= 12 && y >= 1990 && y <= 2099 ? y * 100 + m : null)

/**
 * Parses "05/2025", "5-25", "May-2025", "MAY.25", "May 2025", "2025-05", "15.05.2025", "15/05/2025".
 * Returns YYYYMM or null when the value is missing ("N.A.", "--") or unrecognisable.
 */
export function parseYm(raw: string | null | undefined): number | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[’']/g, '')
  if (!s || /^(n\.?\s*a\.?|nil|not\s+\w+|--?|—)$/.test(s)) return null

  let m: RegExpExecArray | null
  // dd/mm/yyyy or dd.mm.yy
  if ((m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s))) return ym(year(m[3]!), Number(m[2]))
  // yyyy-mm
  if ((m = /^(\d{4})[/.\-](\d{1,2})$/.exec(s))) return ym(Number(m[1]), Number(m[2]))
  // mm/yyyy or mm/yy
  if ((m = /^(\d{1,2})\s*[/.\-]\s*(\d{2}|\d{4})$/.exec(s))) return ym(year(m[2]!), Number(m[1]))
  // Mon-yyyy, Mon.yy, Mon yyyy, Mon,yyyy, Mon'25
  if ((m = /^([a-z]{3,9})\.?\s*[/.\-, ]?\s*(\d{2}|\d{4})$/.exec(s))) {
    const mon = MONTHS[m[1]!]
    return mon ? ym(year(m[2]!), mon) : null
  }
  // dd Mon yyyy, dd-Mon-yy
  if ((m = /^(\d{1,2})\s*[/.\- ]\s*([a-z]{3,9})\.?\s*[/.\-, ]\s*(\d{2}|\d{4})$/.exec(s))) {
    const mon = MONTHS[m[2]!]
    return mon ? ym(year(m[3]!), mon) : null
  }
  return null
}

/** Finds the first month-year in free text, e.g. a notice title "Drug Alert for September 2025". */
export function findYmInText(text: string): number | null {
  const t = text.toLowerCase()
  const m = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s,.\-']*(\d{4})\b/.exec(t)
  if (m) return ym(Number(m[2]), MONTHS[m[1]!] ?? 0)
  const n = /\b(\d{1,2})[/.\-](\d{4})\b/.exec(t)
  if (n) return ym(Number(n[2]), Number(n[1]))
  return null
}

export const formatYm = (v: number | null | undefined) => {
  if (!v) return null
  const y = Math.floor(v / 100)
  const m = v % 100
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`
}

export const ymOf = (d: Date) => d.getUTCFullYear() * 100 + d.getUTCMonth() + 1

/** Last moment of a YYYYMM month, in UTC. */
export function endOfYm(v: number): Date {
  const y = Math.floor(v / 100)
  const m = v % 100
  return new Date(Date.UTC(y, m, 0, 23, 59, 59))
}

/**
 * Issue on rows from pages that print no publication date (Maharashtra): the alert month is the
 * month Nazar first saw the row, not a date the regulator gave. Resolve reads it to mark the alert
 * `dateKnown: false`, so lists can sort it after dated alerts and the app can say "date not given".
 */
export const FIRST_SEEN_ISSUE = 'date not published; first seen'
export const isFirstSeenIssue = (issue: string) => issue.startsWith(FIRST_SEEN_ISSUE)
