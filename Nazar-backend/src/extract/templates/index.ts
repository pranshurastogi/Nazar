import { cdscoLegacy } from './cdsco-legacy.ts'
import { cdscoModern } from './cdsco-modern.ts'
import type { Template, TemplateId } from './common.ts'
import { generic } from './generic.ts'
import { tnNsq } from './tn-nsq.ts'
import { tnRecall } from './tn-recall.ts'
import { whoAnnex } from './who-annex.ts'

export const TEMPLATES: Record<TemplateId, Template> = {
  'cdsco-modern': cdscoModern,
  'cdsco-legacy': cdscoLegacy,
  'tn-nsq': tnNsq,
  'tn-recall': tnRecall,
  'who-annex': whoAnnex,
  generic,
}
