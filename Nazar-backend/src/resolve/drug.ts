/**
 * Brand vs generic. Regulator lists write products as
 *   "Calcium Carbonate with Vit. D3 Tablets IP (CALXIA-500)"   generic + brand in brackets
 *   "Telmisartan 40 mg and Amlodipine 5mg tablets IP (TELMA AM)"
 *   "COLDRIF Syrup"                                              brand only
 *   "Albendazole Tablets IP 400mg"                               generic only
 * and Tamil Nadu adds a separate "Brand Name" column, which extractors pass through as
 * "Brand Name: X" in the raw text. We never guess a brand that is not printed.
 */

export interface DrugName {
  /** Display brand; falls back to the product name when no brand is printed. */
  brand: string
  /** Generic (non-proprietary) name, or null when the product line only carries a brand. */
  generic: string | null
  /** True when `brand` is a real printed brand rather than the product-name fallback. */
  hasBrand: boolean
}

const PHARMACOPOEIA = /\b(?:I\.?\s?P\.?|B\.?\s?P\.?|U\.?\s?S\.?\s?P\.?|Ph\.?\s?Eur\.?)(?=$|[\s,.;)(])/
const STRENGTH = /^\s*[\d.,/\s]+\s*(?:mg|mcg|µg|g|gm|ml|iu|i\.u\.|%|w\/v|w\/w|v\/v|lakh|units?)\b/i
const NOT_A_BRAND =
  /^(?:i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?|ph\.?\s?eur\.?|for\s+injection|for\s+oral\s+use|sterile|paediatric|pediatric|oral|vet(?:erinary)?|\d+\s*(?:x|×)\s*\d+.*|.*\b(?:mg|mcg|ml|iu|w\/v)\b.*)$/i
const FORM_WORDS =
  /\b(?:tablets?|tabs?\.?|capsules?|caps?\.?|syrup|syp\.?|suspension|susp\.?|injection|inj\.?|infusion|drops|cream|ointment|gel|lotion|powder|solution|oral|dry|sachets?|granules|softgels?|i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?)\b/gi
const BRAND_LABEL = /\bbrand(?:\s*name)?\s*[:\-–]\s*([^\n;|]{2,60})/i

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/\s+([,.)])/g, '$1').replace(/\(\s+/g, '(').trim()

/** A bracketed tail that looks like a brand (letters, not a strength, pharmacopoeia or route). */
function bracketBrand(product: string): { brand: string; rest: string } | null {
  const m = /^(.*\S)\s*\(([^()]{2,48})\)\s*\.?$/.exec(product.trim())
  if (!m) return null
  const inner = m[2]!.replace(/^brand(?:\s*name)?\s*[:\-–]\s*/i, '').trim()
  if (!/[a-z]{2}/i.test(inner) || STRENGTH.test(inner) || NOT_A_BRAND.test(inner)) return null
  return { brand: tidy(inner), rest: tidy(m[1]!) }
}

/** A product line reads as generic when it carries a pharmacopoeia mark or names several ingredients. */
export function looksGeneric(product: string): boolean {
  if (PHARMACOPOEIA.test(product)) return true
  if (/\b(?:and|with)\b|&|\+/i.test(product) && /[a-z]{4}/.test(product)) return true
  // Mixed or lower case chemical-looking names ("Paracetamol Tablets 500 mg") rather than a SHOUTED brand.
  const firstWord = product.trim().split(/\s+/)[0] ?? ''
  return /^[A-Z][a-z]{5,}/.test(firstWord) && /\b(?:tablets?|capsules?|injection|syrup|suspension|infusion|cream|ointment)\b/i.test(product)
}

export function splitDrug(product: string, rawText = ''): DrugName {
  const clean = tidy(product)
  const labelled = BRAND_LABEL.exec(rawText)?.[1]?.trim()
  if (labelled && !/^(?:n\.?a\.?|nil|none|-+|not\s+\w+)$/i.test(labelled)) {
    const bb = bracketBrand(clean)
    return { brand: tidy(labelled), generic: bb ? bb.rest : clean, hasBrand: true }
  }
  const bb = bracketBrand(clean)
  if (bb) return { brand: bb.brand, generic: bb.rest, hasBrand: true }
  // WHO annexes write "COLDRIF (paracetamol, chlorpheniramine …)": the bracket holds the ingredients.
  const ing = /^(.{2,40}?)\s*\(([^()]{4,})\)$/.exec(clean)
  if (ing && (looksGeneric(ing[2]!) || /^[a-z]/.test(ing[2]!) || ing[2]!.includes(',')) && !looksGeneric(ing[1]!)) return { brand: tidy(ing[1]!), generic: tidy(ing[2]!), hasBrand: true }
  // Brand-only lines lead with a SHOUTED name ("COLDRIF Syrup", "RESPIFRESH TR"); anything else is
  // treated as a generic description, because inventing a brand is worse than showing the product.
  const tokens = clean.split(/\s+/)
  const lead = tokens[0] ?? ''
  const shouted = /^[A-Z][A-Z0-9-]{2,}$/.test(lead) && (clean !== clean.toUpperCase() || tokens.length <= 3)
  if (looksGeneric(clean) || !shouted) return { brand: clean, generic: clean, hasBrand: false }
  // Drop the dosage-form words to get the brand itself.
  const brand = tidy(clean.replace(FORM_WORDS, ' ').replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|iu)\b/gi, ' '))
  return { brand: brand || clean, generic: null, hasBrand: brand.length >= 2 }
}

export const slugify = (s: string | null | undefined, max = 64) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-$/, '')

/**
 * A product line folded for duplicate detection: case, spacing, punctuation and dosage-form words
 * go, so "DIABETIES-ALL POWDER" and "Diabeties -ALL" meet at "diabetiesall". Strengths stay, so a
 * 250 mg and a 500 mg line never fold together.
 */
export const productKey = (product: string) =>
  product
    .normalize('NFKD')
    .toLowerCase()
    .replace(FORM_WORDS, ' ')
    .replace(/[^a-z0-9]+/g, '')
