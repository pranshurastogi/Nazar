import { isBareForm, type PackLabel } from '@/lib/scan/pack'
import type { MedicineQuery } from '@/lib/source/api'
import type { Alert, CheckResult } from '@/lib/source'

// What "About this medicine" asks about: the name and ingredients only. The batch rides along so
// the server can count Nazar's alerts for it; the server never passes it to the model.

const clip = (s: string | undefined, n: number) => {
  const v = s?.replace(/\s+/g, ' ').trim()
  return v ? v.slice(0, n) : undefined
}

/**
 * A usable medicine name, or undefined. A dosage form on its own ("Tablet", "Capsules IP") is not a
 * name: a camera read of one strip line can see only that word, and "general notes about Tablet"
 * would be wrong.
 */
export const realName = (v: string | undefined | null) => (v && /[a-z]{3}/i.test(v) && !isBareForm(v) ? v : undefined)

/**
 * The name to show and ask about: the brand first (people know "DOLO-650", not "Paracetamol Tablets IP 650 mg"),
 * then the product line, else the first ingredient; null when the label named no medicine.
 */
export const nameOf = (q: MedicineQuery) => realName(q.brand) ?? realName(q.product) ?? realName(q.composition?.[0]) ?? null

export function queryFromPack(pack: PackLabel | null | undefined, batch?: string): MedicineQuery | null {
  if (!pack) return null
  const composition = pack.composition.map((c) => clip(c.value, 150)!).filter(Boolean).slice(0, 8)
  const product = realName(clip(pack.product?.value, 110))
  const brand = realName(clip(pack.brand?.value, 110))
  const rest = { form: clip(pack.form?.value, 40), manufacturer: clip(pack.manufacturer?.value, 190), batch: clip(batch, 40) }
  if (!product && !brand && !composition.length) {
    // The label was read but names no medicine (only "Tablet", say): the card asks the person for the name first.
    return pack.product || pack.form ? rest : null
  }
  return { ...(brand ? { brand } : {}), product, composition: composition.length ? composition : undefined, ...rest }
}

function queryFromAlert(a: Alert): MedicineQuery | null {
  const brand = a.brand && !/^unnamed product$/i.test(a.brand) ? realName(clip(a.brand, 110)) : undefined
  const generic = realName(clip(a.drug, 150))
  if (!brand && !generic) return null
  const form = a.form && a.form.toLowerCase() !== 'other' ? clip(a.form.toLowerCase(), 40) : undefined
  return { product: brand, composition: generic && generic !== brand ? [generic] : undefined, form, batch: clip(a.batch, 40) }
}

/** The query for a check result: the alert's product when there is one, the scanned label otherwise. */
export function queryForResult(result: CheckResult, pack?: PackLabel | null): MedicineQuery | null {
  if (result.state === 'unreadable') return null
  const fromPack = queryFromPack(pack, result.batch)
  if (result.state === 'flagged' || result.state === 'retracted') {
    const fromAlert = queryFromAlert(result.alert)
    // The printed composition is more precise than an alert's generic line, when we have both.
    if (fromAlert) return { ...fromAlert, ...(fromPack?.composition ? { composition: fromPack.composition } : {}) }
  }
  return fromPack
}
