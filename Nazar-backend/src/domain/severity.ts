import { isNtiDrug, type Category, type DosageForm, type Failure } from './vocab.ts'

/**
 * Severity is data, not judgement: a versioned rule table, capped at 5.
 * The result keeps the fired rules so the app can explain "why severity 5".
 */
export const SEVERITY_RULE_VERSION = 'sev-2026.10.1'

const BASE: Record<Failure, number> = {
  spurious: 5,
  glycol: 5,
  identification: 4,
  sterility: 4,
  endotoxin: 4,
  particulate: 4,
  assay: 3,
  related_substances: 3,
  microbial: 3,
  dissolution: 2,
  disintegration: 2,
  labelling: 2,
  description: 1,
  ph: 1,
  uniformity: 1,
  other: 2,
}

const BASE_TEXT: Record<Failure, string> = {
  spurious: 'Spurious batch',
  glycol: 'Adulterated with a toxic glycol',
  identification: 'Active ingredient not identified',
  sterility: 'Not sterile',
  endotoxin: 'Bacterial endotoxins',
  particulate: 'Particulate matter',
  assay: 'Wrong strength',
  related_substances: 'Excess impurities',
  microbial: 'Microbial contamination',
  dissolution: 'Dissolution failure',
  disintegration: 'Disintegration failure',
  labelling: 'Labelling problem',
  description: 'Description failure',
  ph: 'pH out of range',
  uniformity: 'Content or weight uniformity',
  other: 'Failed a quality test',
}

export interface SeverityInput {
  failures: Failure[]
  category: Category
  form: DosageForm
  peds: boolean
  product: string
}

export interface SeverityResult {
  severity: 1 | 2 | 3 | 4 | 5
  rules: string[]
  version: string
}

export function scoreSeverity(input: SeverityInput): SeverityResult {
  const failures: Failure[] = input.category === 'spurious' && !input.failures.includes('spurious') ? ['spurious', ...input.failures] : input.failures
  let top: Failure = failures[0] ?? 'other'
  for (const f of failures) if (BASE[f] > BASE[top]) top = f
  let score = BASE[top]
  const rules = [`${BASE_TEXT[top]}: base ${BASE[top]}`]

  if (input.peds) {
    score += 1
    rules.push('Paediatric formulation: +1')
  }
  if (input.form === 'injection' || input.form === 'infusion') {
    score += 1
    rules.push('Injectable: +1')
  }
  if (failures.includes('assay') && isNtiDrug(input.product)) {
    score += 1
    rules.push('Narrow-therapeutic-index drug with wrong strength: +1')
  }
  if (score > 5) {
    rules[rules.length - 1] += ' (capped at 5)'
    score = 5
  }
  return { severity: Math.max(1, score) as SeverityResult['severity'], rules, version: SEVERITY_RULE_VERSION }
}
