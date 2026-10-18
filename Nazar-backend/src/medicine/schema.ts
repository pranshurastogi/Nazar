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
  /** Publishable Nazar alerts whose product names this medicine (by brand or generic name). */
  nazarAlerts: number
  /** Search text the app can use to list those alerts (Feed / search). */
  nazarQuery: string | null
  /** Alerts for the exact batch, when one was given. */
  batchAlerts: number
  cached: boolean
  model: string
  generatedAt: string
}
