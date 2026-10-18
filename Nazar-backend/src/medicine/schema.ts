import { z } from 'zod'

/**
 * Wire contract for POST /v1/medicine/explain. The request carries only what is printed on a pack
 * (no images, no personal data). The answer is general reference information written by an LLM,
 * shaped by a strict schema so the web app can render it without guessing.
 */

export const MAX_BODY_BYTES = 2048

const text = (max: number) => z.string().trim().max(max)

export const ExplainInput = z
  .object({
    product: text(120).optional(),
    brand: text(120).optional(),
    composition: z.array(text(160)).max(8).optional(),
    form: text(40).optional(),
    manufacturer: text(200).optional(),
    /** Used only to look the batch up in Nazar's own alerts; never sent to the model. */
    batch: text(40).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.product || v.brand || v.composition?.some((c) => c.length > 0)), {
    message: 'give a product, brand or composition',
  })
export type ExplainInput = z.infer<typeof ExplainInput>

/**
 * What the model must return. Every field is required (empty arrays allowed) so structured outputs
 * can enforce the whole shape; lengths are trimmed afterwards by the guard.
 */
export const MedicineInfo = z.object({
  name: z.string().describe('Medicine name as commonly known, e.g. "Paracetamol 500 mg tablet" or the brand.'),
  genericNames: z.array(z.string()).describe('Active ingredients by generic name, no strengths.'),
  drugClass: z.string().describe('Plain-language drug class, e.g. "Pain reliever and fever reducer (analgesic)". "unknown" if unsure.'),
  whatItIsFor: z.array(z.string()).describe('2-4 plain-language uses.'),
  howItWorks: z.string().describe('One short sentence.'),
  commonSideEffects: z.array(z.string()).describe('2-4 common side effects.'),
  seriousWarnings: z.array(z.string()).describe('2-4 signs that mean "get medical help now".'),
  whoShouldBeCareful: z.array(z.string()).describe('2-4 groups who should ask a doctor first (pregnancy, liver disease, children...). No doses.'),
  interactions: z.array(z.string()).describe('0-3 common, general interactions.'),
  storage: z.string().describe('One short sentence on storage.'),
  prescriptionStatus: z.string().describe('e.g. "Usually prescription-only in India (Schedule H)", "Usually sold without prescription in India", or "unknown".'),
  lookAlikeNames: z.array(z.string()).describe('0-3 brand or generic names easily confused with this one.'),
  confidence: z.enum(['high', 'medium', 'low']),
})
export type MedicineInfo = z.infer<typeof MedicineInfo>

export const DISCLAIMER = 'General information, not medical advice. Ask your doctor or pharmacist before you start, stop or change a medicine.'

export interface ExplainResponse {
  medicine: MedicineInfo & { notMedicalAdvice: true }
  disclaimer: string
  aiGenerated: true
  /** Publishable Nazar alerts for this brand (any batch). Same as brandAlerts; kept for older clients. */
  nazarAlerts: number
  /** The brand those alerts were matched on, or null for an unbranded/generic product. */
  brandName: string | null
  /** Publishable alerts whose own brand matches this pack's brand (any batch). */
  brandAlerts: number
  /** Main ingredient used for the broader count, e.g. "Paracetamol". */
  ingredientName: string | null
  /**
   * Alerts for OTHER products that contain the same ingredient (other makers, other brands).
   * Context only: these are not about the user's pack and must be labelled that way.
   */
  ingredientAlerts: number
  /** Search text the app can use to list the brand alerts (falls back to the ingredient). */
  nazarQuery: string | null
  /** Alerts for the exact batch, when one was given. */
  batchAlerts: number
  cached: boolean
  model: string
  generatedAt: string
}

// ---- POST /v1/medicine/identify: guess a medicine from text OCR'd off a pack label (never the image).

export const IDENTIFY_MAX_BODY_BYTES = 8192
export const IDENTIFY_MAX_TEXT = 4000

export const IdentifyInput = z
  .object({
    /** OCR text from the label, read on the device. */
    text: z.string().trim().min(3).max(IDENTIFY_MAX_TEXT),
    /** What the on-device Pack Reader already parsed. Context for the model only; never used as evidence. */
    hints: z
      .object({
        product: text(120).optional(),
        batch: text(40).optional(),
        expiry: text(20).optional(),
        manufacturer: text(200).optional(),
        composition: z.array(text(160)).max(8).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type IdentifyInput = z.infer<typeof IdentifyInput>

export const IDENTIFY_FIELDS = ['product', 'brand', 'composition', 'form', 'manufacturer', 'batch', 'expiry'] as const
export type IdentifyField = (typeof IDENTIFY_FIELDS)[number]

/**
 * What the model must return. Unknown text fields are "" (not null) so one flat schema works for
 * every provider's structured output; the server turns "" into null after grounding.
 */
export const IdentifyAnswer = z.object({
  product: z.string().describe('Product name as printed, with obvious OCR errors fixed, e.g. "Dolo 650 Tablets". "" if not found.'),
  brand: z.string().describe('Brand name only, e.g. "Dolo 650". "" for an unbranded generic or if not found.'),
  composition: z.array(z.string()).describe('Active ingredients with strengths as printed, e.g. "Paracetamol IP 650 mg". Empty if none are printed.'),
  form: z.string().describe('Dosage form, e.g. "tablet", "capsule", "syrup", "injection". "" if not printed.'),
  manufacturer: z.string().describe('Manufacturer or marketer as printed, e.g. "Micro Labs Limited". "" if not found.'),
  batch: z.string().describe('Batch or lot number exactly as printed after "B. No." or "Batch". "" if not printed. Never guess.'),
  expiry: z.string().describe('Expiry month as YYYY-MM, only if an expiry date is printed. "" otherwise.'),
  evidence: z
    .array(
      z.object({
        field: z.enum(IDENTIFY_FIELDS),
        quote: z.string().describe('The exact characters from the label text that support this field, copied as they appear, OCR errors included.'),
      }),
    )
    .describe('At least one quote for every field you filled.'),
  confidence: z.enum(['high', 'medium', 'low']),
})
export type IdentifyAnswer = z.infer<typeof IdentifyAnswer>

export interface IdentifyGuess {
  product: string | null
  brand: string | null
  composition: string[]
  form: string | null
  manufacturer: string | null
  batch: string | null
  /** YYYY-MM. */
  expiry: string | null
}

export interface IdentifyEvidence {
  field: IdentifyField
  /** The span of the submitted label text that backs the field, exactly as submitted. */
  quote: string
}

export interface IdentifyResponse {
  guess: IdentifyGuess
  confidence: 'high' | 'medium' | 'low'
  evidence: IdentifyEvidence[]
  aiGenerated: true
  model: string
  cached: boolean
}
