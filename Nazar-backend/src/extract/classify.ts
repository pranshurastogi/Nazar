import type { RawDoc } from '../domain/types.ts'
import { TEMPLATE_IDS, type TemplateId } from './templates/common.ts'

/**
 * Picks the parser profile. A source adapter that knows its documents passes
 * hints.template; otherwise the first page's wording identifies the layout.
 */
export function classify(doc: Pick<RawDoc, 'hints'>, firstPagesText: string): TemplateId {
  const hint = doc.hints?.template
  if (hint && (TEMPLATE_IDS as readonly string[]).includes(hint)) return hint as TemplateId
  const t = firstPagesText
  if (/Medical\s+Product\s+Alert/i.test(t)) return 'who-annex'
  if (/NSQ\s+RECALL/i.test(t) || (/\bZONE\b/.test(t) && /RECALLED/i.test(t))) return 'tn-recall'
  if (/Tamil\s*Nadu\s+NSQ/i.test(t) || /NSQ\s+Category/i.test(t)) return 'tn-nsq'
  if (/B\s*\.?\s*No\s*\.?\s*:/i.test(t) && /Drawn\s+By/i.test(t)) return 'cdsco-legacy'
  if (/(NOT\s+OF\s+STANDARD\s+QUALITY|declared\s+as\s+Spurious)/i.test(t) && /Batch\s*No/i.test(t)) return 'cdsco-modern'
  return 'generic'
}
