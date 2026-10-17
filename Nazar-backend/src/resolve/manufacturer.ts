import { slugify } from './drug.ts'

/**
 * Manufacturer strings arrive as one cell: "M/s. Sresan Pharmaceuticals Pvt. Ltd., No. 787, Bangalore
 * Highway, Sunguvarchathiram, Kancheepuram-602106, Tamil Nadu". We split the firm from the address,
 * normalise legal suffixes (so "Pvt. Ltd." and "Private Limited" meet), read the PIN code and the
 * state, and derive a plant id (firm + PIN) that groups batches made at the same site.
 */

export interface Manufacturer {
  /** Display name with a tidy legal suffix, e.g. "Sresan Pharmaceuticals Pvt Ltd". */
  name: string
  /** Suffix-free slug used for matching and case ids, e.g. "sresan-pharmaceuticals". */
  key: string
  address: string | null
  pin: string | null
  /** ISO 3166-2:IN code, e.g. "IN-TN". */
  state: string | null
  plantId: string | null
}

const UNKNOWN = /^(?:under\s+investigation|not\s+(?:known|mentioned|available|given)|unknown|n\.?\s?a\.?|nil|-+|—)$/i
const PREFIX = /^\s*(?:m\s*\/\s*s\.?|messrs\.?|m\.s\.)\s*/i

const SUFFIXES: [RegExp, string][] = [
  [/\bp(?:vt|rivate)\.?\s*,?\s*l(?:td|imited)\.?/i, 'Pvt Ltd'],
  [/\bl(?:td|imited)\.?(?!\w)/i, 'Ltd'],
  [/\bl\.?\s?l\.?\s?p\.?(?!\w)/i, 'LLP'],
  [/\binc\.?(?!\w)/i, 'Inc'],
  [/\b(?:corporation|corpn\.?)(?!\w)/i, 'Corporation'],
]
const SUFFIX_ANY = /\s*,?\s*\b(?:p(?:vt|rivate)\.?\s*,?\s*l(?:td|imited)\.?|l(?:td|imited)\.?|l\.?\s?l\.?\s?p\.?|inc\.?|\(\s*(?:i|p|india)\s*\)|india)(?!\w)/gi

/** Where the firm name usually stops and the address begins. */
const ADDRESS_START =
  /(?:\s+[-–]\s+|\s*,\s*|\.\s+|\s+)(?=(?:(?:plot|sy\.?|survey|s\.?\s?no|d\.?\s?no|khasra|kh\.?\s?no|vill(?:age)?\.?|at\s*[:&]|at\s*post|door|unit|gat|g\.?i\.?d\.?c|m\.?i\.?d\.?c|sidcul|i\.?i\.?e|industrial|phase|sector|block|near|opp\.?|road|street|nh-?\d|fac\.?|baddi|kala\s+amb|paonta|selaqui|haridwar)\b|\d|#|[A-Z]-\d|no\.?\s*\d))/i

export function splitFirm(raw: string): { name: string; address: string | null } {
  const s = raw.replace(PREFIX, '').replace(/\s+/g, ' ').trim()
  // The legal suffix is the most reliable end of a firm name.
  let end = -1
  for (const [re] of SUFFIXES) {
    const m = re.exec(s)
    if (m && (end < 0 || m.index + m[0].length < end)) end = m.index + m[0].length
  }
  if (end > 0) {
    // "Nikvin Healthcare (I) Pvt. Ltd." keeps the "(I)" that sits before the suffix.
    const name = s.slice(0, end).trim()
    const address = s.slice(end).replace(/^[\s,.;:-]+/, '').trim()
    return { name, address: address || null }
  }
  const m = ADDRESS_START.exec(s)
  if (m && m.index >= 3) {
    return { name: s.slice(0, m.index).replace(/[\s,.;:-]+$/, ''), address: s.slice(m.index).replace(/^[\s,.;:-]+/, '') || null }
  }
  return { name: s.replace(/[\s,.;:-]+$/, ''), address: null }
}

export function displayFirm(name: string): string {
  let out = name.replace(/\s+/g, ' ').trim()
  for (const [re, canon] of SUFFIXES) {
    if (re.test(out)) {
      out = out.replace(re, canon)
      break
    }
  }
  return out.replace(/\s*,\s*(?=(?:Pvt Ltd|Ltd|LLP|Inc)\b)/, ' ').replace(/[\s,.]+$/, '')
}

export function firmKey(name: string): string {
  return slugify(name.replace(PREFIX, '').replace(/\(\s*(?:i|p|india)\s*\)/gi, ' ').replace(SUFFIX_ANY, ' '), 48) || 'unknown'
}

/**
 * Last 6-digit Indian PIN in the text (addresses end with it). First digit is never 0 or 9.
 * Digits glued to another number ("01681-123456", a phone with its STD code) or following a
 * phone/fax label are skipped.
 */
export function extractPin(text: string): string | null {
  const re = /(?<!\d[-\s]?)(?<!\d)([1-8]\d{2})\s?(\d{3})(?![\d-]\d)(?!\d)/g
  let last: string | null = null
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (/(?:tel|ph|phone|mob|mobile|fax|cell)\.?\s*[:.]?\s*[\d\s+-]*$/i.test(text.slice(Math.max(0, m.index - 20), m.index))) continue
    last = `${m[1]}${m[2]}`
  }
  return last
}

/**
 * PIN prefix → state. The first two digits are a postal circle; a few circles span several states,
 * so the third digit refines Goa, Chandigarh, Ladakh, Puducherry, Sikkim, Uttarakhand and the
 * north-east. Best effort: an address that names its state wins when it agrees with the circle.
 */
export function stateFromPin(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return null
  const p2 = Number(pin.slice(0, 2))
  const p3 = Number(pin.slice(0, 3))
  if (p3 === 403) return 'IN-GA'
  if (p3 === 160) return 'IN-CH'
  if (p3 === 194) return 'IN-LA'
  if (p3 === 605) return 'IN-PY'
  if (p3 === 737) return 'IN-SK'
  if (p3 === 744) return 'IN-AN'
  if (p3 === 682 && pin.startsWith('6825')) return 'IN-LD'
  if (p3 === 396 && pin.startsWith('3962')) return 'IN-DH'
  if ([246, 248, 249, 263].includes(p3)) return 'IN-UK'
  if (p3 >= 790 && p3 <= 792) return 'IN-AR'
  if (p3 === 793 || p3 === 794) return 'IN-ML'
  if (p3 === 795) return 'IN-MN'
  if (p3 === 796) return 'IN-MZ'
  if (p3 === 797 || p3 === 798) return 'IN-NL'
  if (p3 === 799) return 'IN-TR'
  if (p2 === 11) return 'IN-DL'
  if (p2 === 12 || p2 === 13) return 'IN-HR'
  if (p2 >= 14 && p2 <= 16) return 'IN-PB'
  if (p2 === 17) return 'IN-HP'
  if (p2 === 18 || p2 === 19) return 'IN-JK'
  if (p2 >= 20 && p2 <= 28) return 'IN-UP'
  if (p2 >= 30 && p2 <= 34) return 'IN-RJ'
  if (p2 >= 36 && p2 <= 39) return 'IN-GJ'
  if (p2 >= 40 && p2 <= 44) return 'IN-MH'
  if (p2 >= 45 && p2 <= 48) return 'IN-MP'
  if (p2 === 49) return 'IN-CG'
  if (p2 === 50) return 'IN-TS'
  if (p2 >= 51 && p2 <= 53) return 'IN-AP'
  if (p2 >= 56 && p2 <= 59) return 'IN-KA'
  if (p2 >= 60 && p2 <= 64) return 'IN-TN'
  if (p2 >= 67 && p2 <= 69) return 'IN-KL'
  if (p2 >= 70 && p2 <= 74) return 'IN-WB'
  if (p2 >= 75 && p2 <= 77) return 'IN-OD'
  if (p2 === 78) return 'IN-AS'
  if (p2 >= 81 && p2 <= 83) return 'IN-JH'
  if (p2 === 80 || p2 === 84 || p2 === 85) return 'IN-BR'
  return null
}

/** States a PIN circle could plausibly belong to (used to let the address text break ties). */
const CIRCLE_ALTERNATIVES: Record<string, string[]> = {
  'IN-UP': ['IN-UK'],
  'IN-UK': ['IN-UP'],
  'IN-BR': ['IN-JH'],
  'IN-JH': ['IN-BR'],
  'IN-PB': ['IN-CH', 'IN-HP'],
  'IN-HR': ['IN-CH'],
  'IN-AP': ['IN-TS'],
  'IN-TS': ['IN-AP'],
  'IN-MP': ['IN-CG'],
  'IN-TN': ['IN-PY'],
  'IN-MH': ['IN-GA', 'IN-DH'],
  'IN-GJ': ['IN-DH'],
  'IN-WB': ['IN-SK'],
  'IN-JK': ['IN-LA'],
  'IN-KL': ['IN-PY'],
}

const STATE_TEXT: [string, RegExp][] = [
  ['IN-TN', /tamil\s*nadu|\bT\.\s?N\.?(?!\w)|kancheepuram|kanchipuram|chennai|coimbatore|madurai|hosur/i],
  ['IN-GJ', /gujarat|\bGuj\.?\b|ahmedabad|ahmadabad|vadodara|baroda|changodar|surendranagar|rajkot|ankleshwar|vapi|surat|gandhinagar|sanand|mehsana/i],
  ['IN-MH', /maharashtra|mumbai|thane|pune|aurangabad|nagpur|nashik|tarapur|bhiwandi|palghar/i],
  ['IN-HP', /himachal|\bH\.\s?P\.?(?!\w)|\bHP\b|baddi|nalagarh|kala\s*amb|paonta\s*sahib|sirmour|sirmaur|solan|barotiwala/i],
  ['IN-UK', /uttarakhand|uttaranchal|\bU\.\s?K\.?(?!\w)|\bUK\b|haridwar|roorkee|dehradun|selaqui|sidcul|rudrapur|kashipur|kotdwar/i],
  ['IN-MP', /madhya\s*pradesh|\bM\.\s?P\.?(?!\w)|\bMP\b|indore|bhopal|pithampur|dewas|gwalior/i],
  ['IN-UP', /uttar\s*pradesh|\bU\.\s?P\.?(?!\w)|\bUP\b|ghaziabad|noida|lucknow|kanpur|meerut|saharanpur|agra/i],
  ['IN-PB', /punjab|mohali|ludhiana|amritsar|derabassi|dera\s*bassi|zirakpur/i],
  ['IN-HR', /haryana|panchkula|gurgaon|gurugram|faridabad|ambala|sonipat|karnal|bahadurgarh/i],
  ['IN-JK', /jammu|kashmir|\bJ\s?&\s?K\b|kathua|samba/i],
  ['IN-TS', /telangana|hyderabad|secunderabad|medak|sangareddy|rangareddy/i],
  ['IN-AP', /andhra\s*pradesh|\bA\.\s?P\.?(?!\w)|visakhapatnam|vizag|vijayawada|guntur|nellore|tirupati/i],
  ['IN-KA', /karnataka|bengaluru|bangalore(?!\s+highway)|mysuru|mysore|hubli|belgaum|belagavi/i],
  ['IN-KL', /kerala|kochi|cochin|thiruvananthapuram|trivandrum|kozhikode|thrissur|palakkad/i],
  ['IN-WB', /west\s*bengal|\bW\.\s?B\.?(?!\w)|kolkata|calcutta|howrah|durgapur/i],
  ['IN-OD', /odisha|orissa|bhubaneswar|cuttack/i],
  ['IN-AS', /assam|guwahati/i],
  ['IN-BR', /bihar|patna|hajipur/i],
  ['IN-JH', /jharkhand|ranchi|jamshedpur|dhanbad/i],
  ['IN-RJ', /rajasthan|jaipur|bhiwadi|neemrana|alwar|udaipur|jodhpur/i],
  ['IN-DL', /\bdelhi\b/i],
  ['IN-GA', /\bgoa\b|verna|margao|ponda/i],
  ['IN-SK', /sikkim|gangtok/i],
  ['IN-CG', /chhattisgarh|chattisgarh|raipur|bilaspur/i],
  ['IN-PY', /puducherry|pondicherry/i],
  ['IN-CH', /chandigarh/i],
  ['IN-DH', /silvassa|dadra|daman|nagar\s*haveli/i],
]

export function stateFromText(text: string): string | null {
  // Last mention wins: addresses end with district, state, PIN.
  let best: { code: string; at: number } | null = null
  for (const [code, re] of STATE_TEXT) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    for (let m = g.exec(text); m; m = g.exec(text)) if (!best || m.index > best.at) best = { code, at: m.index }
  }
  return best?.code ?? null
}

export function resolveState(text: string, pin: string | null): string | null {
  const fromText = stateFromText(text)
  const fromPin = pin ? stateFromPin(pin) : null
  if (!fromPin) return fromText
  if (!fromText || fromText === fromPin) return fromPin
  return CIRCLE_ALTERNATIVES[fromPin]?.includes(fromText) ? fromText : fromPin
}

export function parseManufacturer(raw: string | null | undefined): Manufacturer | null {
  if (!raw) return null
  const s = raw.replace(/\s+/g, ' ').trim()
  if (!s || UNKNOWN.test(s.replace(PREFIX, ''))) return null
  const { name, address } = splitFirm(s)
  if (!name || UNKNOWN.test(name)) return null
  const pin = extractPin(s)
  const key = firmKey(name)
  return {
    name: displayFirm(name),
    key,
    address,
    pin,
    state: resolveState(address ?? s, pin),
    plantId: pin && key !== 'unknown' ? `${key}-${pin}` : null,
  }
}
