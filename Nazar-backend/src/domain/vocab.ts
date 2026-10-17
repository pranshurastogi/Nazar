/**
 * Closed vocabularies. The pipeline never invents a failure type: free text from a
 * notice is mapped onto these codes, and the original wording is kept alongside.
 */

export const CATEGORIES = ['spurious', 'adulterated', 'misbranded', 'nsq'] as const
export type Category = (typeof CATEGORIES)[number]

export const FAILURES = [
  'spurious',
  'glycol',
  'identification',
  'sterility',
  'endotoxin',
  'particulate',
  'assay',
  'related_substances',
  'dissolution',
  'disintegration',
  'labelling',
  'microbial',
  'description',
  'ph',
  'uniformity',
  'other',
] as const
export type Failure = (typeof FAILURES)[number]

const FAILURE_PATTERNS: [Failure, RegExp][] = [
  ['spurious', /\bspurious\b|not\s+(?:been\s+)?manufactur\w*\s+by\s+(?:them|the\s+firm|us)|impugned\s+batch|(?:fake|counterfeit)/i],
  ['glycol', /di[\s-]?ethylene\s+glycol|\bDEG\b|ethylene\s+glycol|\bEG\b(?=[\s,).]|$)|glycol\s+contamina/i],
  ['identification', /identif(?:ication|y)|does\s+not\s+(?:contain|comply\s+.*identity)|absence\s+of\s+(?:the\s+)?(?:active|api)/i],
  ['sterility', /steril/i],
  ['endotoxin', /endotoxin|pyrogen/i],
  ['particulate', /particulate|visible\s+particles|foreign\s+particles|particulate\s+matter/i],
  ['assay', /\bassay\b|content\s+of\s+[a-z]|potency/i],
  ['related_substances', /related\s+substances?|impurit/i],
  ['dissolution', /dissolution/i],
  ['disintegration', /disintegration/i],
  ['labelling', /label|misbrand/i],
  ['microbial', /microbial|microbiolog|bacterial|fungal|\bTAMC\b|\bTYMC\b|e\.?\s*coli|salmonella/i],
  ['description', /\bdescription\b|appearance|colou?r|odou?r|discolou?r/i],
  ['ph', /\bph\b/i],
  ['uniformity', /uniformity|weight\s+variation|average\s+weight|net\s+(?:content|volume)|fill\s+volume|extractable\s+volume|deliverable\s+volume/i],
]

/** Every failure code mentioned in a reason, most severe first; "other" when none matched. */
export function classifyFailures(reason: string): Failure[] {
  const found = FAILURE_PATTERNS.filter(([, re]) => re.test(reason)).map(([f]) => f)
  return found.length ? found : ['other']
}

export function classifyCategory(reason: string, failures: Failure[] = classifyFailures(reason)): Category {
  if (failures.includes('spurious')) return 'spurious'
  if (failures.includes('glycol') || /adulterat/i.test(reason)) return 'adulterated'
  if (/misbrand/i.test(reason)) return 'misbranded'
  return 'nsq'
}

export const CATEGORY_LABEL: Record<Category, string> = {
  spurious: 'Spurious',
  adulterated: 'Adulterated',
  misbranded: 'Misbranded',
  nsq: 'Not of Standard Quality',
}

export const FAILURE_LABEL: Record<Failure, string> = {
  spurious: 'Spurious: the named maker says it did not make this batch',
  glycol: 'Contaminated with a toxic glycol (DEG/EG)',
  identification: 'Failed identification: active ingredient not found',
  sterility: 'Failed sterility test',
  endotoxin: 'Failed bacterial endotoxin test',
  particulate: 'Particulate matter found',
  assay: 'Wrong strength (assay)',
  related_substances: 'Excess impurities (related substances)',
  dissolution: 'Does not dissolve properly (dissolution)',
  disintegration: 'Does not break down properly (disintegration)',
  labelling: 'Labelling or misbranding problem',
  microbial: 'Microbial contamination',
  description: 'Looks wrong (description)',
  ph: 'pH out of range',
  uniformity: 'Uneven content or weight',
  other: 'Failed a quality test',
}

export const DOSAGE_FORMS = [
  'injection', 'infusion', 'tablet', 'capsule', 'syrup', 'suspension', 'drops', 'solution',
  'cream', 'ointment', 'gel', 'lotion', 'powder', 'inhaler', 'spray', 'suppository', 'device', 'other',
] as const
export type DosageForm = (typeof DOSAGE_FORMS)[number]

const FORM_PATTERNS: [DosageForm, RegExp][] = [
  ['infusion', /infusion|\bi\.?v\.?\s+fluid|\bivf\b|dextrose\s+(?:injection|infusion|\d)|sodium\s+chloride\s+(?:injection|infusion|\d)|ringer/i],
  ['injection', /inj(?:ection|\.)?\b|\bvial\b|ampoule|\bampule|for\s+injection/i],
  ['suspension', /suspension|\bsusp\.?\b|dry\s+syrup/i],
  ['syrup', /syrup|\bsyp\.?\b|linctus|elixir|tonic/i],
  ['drops', /\bdrops?\b/i],
  ['tablet', /tablet|\btab\.?s?\b|\bcaplet/i],
  ['capsule', /capsule|\bcap\.?s?\b|softgel/i],
  ['cream', /\bcream\b/i],
  ['ointment', /ointment|\boint\.?\b/i],
  ['gel', /\bgel\b/i],
  ['lotion', /lotion/i],
  ['powder', /powder|sachet|granules|\bors\b/i],
  ['inhaler', /inhaler|rotacap|respule|nebuli[sz]er/i],
  ['spray', /spray/i],
  ['suppository', /suppositor/i],
  ['solution', /solution|\bsoln\.?\b|mouthwash|gargle/i],
  ['device', /syringe|catheter|cannula|glove|bandage|gauze|suture|condom|stent|\bkit\b/i],
]

export function detectForm(product: string): DosageForm {
  return FORM_PATTERNS.find(([, re]) => re.test(product))?.[0] ?? 'other'
}

/** Explicit paediatric markers on the product name. Dosage form alone is not enough. */
export function isPaediatric(product: string): boolean {
  return /p(?:a)?ediatric|\bpaed\b|\bped\b|\binfant|\bkid|\bjunior\b|\bbaby|\bneonat|for\s+children|\bchild\b|\bdrops?\b.*\boral\b|\boral\s+drops?\b|dry\s+syrup/i.test(product)
}

/** Narrow-therapeutic-index drugs: a wrong-strength failure on these is more dangerous. */
export const NTI_DRUGS = [
  'digoxin', 'warfarin', 'phenytoin', 'carbamazepine', 'lithium', 'levothyroxine', 'thyroxine',
  'theophylline', 'cyclosporine', 'ciclosporin', 'tacrolimus', 'valproate', 'valproic', 'aminophylline',
  'methotrexate', 'gentamicin', 'amikacin', 'vancomycin', 'insulin', 'clozapine',
]

export const isNtiDrug = (text: string) => NTI_DRUGS.some((d) => new RegExp(`\\b${d}`, 'i').test(text))
