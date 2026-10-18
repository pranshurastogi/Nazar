// Whole-label grammar for Indian medicine packs: product name, composition, dosage form, pack size,
// manufacturer and address, manufacturing licence, MRP and Schedule H/H1 warnings, read from OCR text.
// Batch and dates come from labels.ts (merged in read.ts). Pure and import-free so it runs under
// `node --test` (see lib/scan/parsers.test.mjs); every field carries a confidence, 0-1.

import type { LabelDate } from './labels'

export type PackField<T = string> = { value: T; confidence: number }

export type PackLabel = {
  /** Brand name as printed, e.g. "DOLO-650", "Crocin Advance". The big word on the front, never an ingredient. */
  brand?: PackField
  /** The product line, usually the generic description ("Paracetamol Tablets IP 650 mg"); may equal the brand when no generic line is printed. */
  product?: PackField
  /** One entry per active ingredient, e.g. "Paracetamol IP 500 mg". */
  composition: PackField[]
  form?: PackField
  packSize?: PackField
  manufacturer?: PackField
  manufacturerAddress?: PackField
  /** Indian state or UT named in the manufacturer's address. */
  manufacturerState?: PackField
  marketedBy?: PackField
  licence?: PackField
  batch?: PackField
  mfg?: PackField<LabelDate>
  expiry?: PackField<LabelDate>
  /** Rupees, as printed. */
  mrp?: PackField
  /** "H", "H1", "X" or "G" when a Schedule line or the Rx retail warning is printed. */
  schedule?: PackField
  rawText: string
}

const FORMS: [RegExp, string][] = [
  [/\btab(?:let)?s?\b/i, 'tablet'],
  [/\bcap(?:sule)?s?\b/i, 'capsule'],
  [/\bsyrup\b/i, 'syrup'],
  [/\bsuspension\b/i, 'suspension'],
  [/\binjection\b|\binj\.?\b/i, 'injection'],
  [/\b(?:eye|ear|nasal)?\s?drops\b/i, 'drops'],
  [/\boral\s+solution\b|\bsolution\b/i, 'solution'],
  [/\bointment\b/i, 'ointment'],
  [/\bcream\b/i, 'cream'],
  [/\bgel\b/i, 'gel'],
  [/\blotion\b/i, 'lotion'],
  [/\binhaler\b|\brotacaps?\b/i, 'inhaler'],
  [/\bsachets?\b|\bgranules\b/i, 'sachet'],
  [/\bpowder\b/i, 'powder'],
  [/\bspray\b/i, 'spray'],
]

const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Jammu & Kashmir', 'Puducherry', 'Pondicherry', 'Chandigarh', 'Daman', 'Dadra', 'Sikkim',
]
const STATE_ABBR: Record<string, string> = { 'H.P.': 'Himachal Pradesh', 'U.P.': 'Uttar Pradesh', 'M.P.': 'Madhya Pradesh', 'A.P.': 'Andhra Pradesh', 'T.N.': 'Tamil Nadu', 'W.B.': 'West Bengal', 'J&K': 'Jammu and Kashmir' }

/** Words that start a different part of the label, so a captured value stops before them. */
const STOP =
  /\b(?:excipients?|colou?rs?\b|flavou?r|dosage|directions?|store|storage|keep|warning|caution|schedule|mfd\.?\s*by|manufactured|mfg\.?\s*by|marketed|mkt|mktd|distributed|b\.?\s?no|batch|lot\b|mfg\.?\s*(?:dt|date)|mfd\.?\s*(?:dt|date)|exp(?:iry)?(?![a-z])|m\.?\s?r\.?\s?p|price|lic(?:ence|ense)?\.?\s*no|regd|for\s+use|use\s+before|read\s+the|protect)/i

// ---- Ingredients. Common salts on Indian packs, so a brand is never taken for an ingredient and a
// composition line is recognised even when its "Each tablet contains" heading was misread.
const SALTS = `paracetamol acetaminophen ibuprofen diclofenac aceclofenac naproxen mefenamic nimesulide etoricoxib piroxicam ketorolac
tramadol aspirin acetylsalicylic caffeine serratiopeptidase thiocolchicoside chlorzoxazone trypsin chymotrypsin bromelain
amoxicillin amoxycillin clavulanic clavulanate ampicillin cloxacillin azithromycin clarithromycin erythromycin roxithromycin
cefixime cefpodoxime cefuroxime ceftriaxone cefadroxil cephalexin cefalexin cefdinir ciprofloxacin ofloxacin levofloxacin
moxifloxacin norfloxacin ornidazole metronidazole tinidazole doxycycline tetracycline minocycline linezolid nitrofurantoin
cotrimoxazole sulfamethoxazole trimethoprim rifampicin isoniazid pyrazinamide ethambutol fluconazole itraconazole terbinafine
clotrimazole ketoconazole miconazole luliconazole albendazole mebendazole ivermectin acyclovir aciclovir valacyclovir
oseltamivir hydroxychloroquine chloroquine artemether lumefantrine cetirizine levocetirizine fexofenadine loratadine
desloratadine chlorpheniramine chlorphenamine pheniramine diphenhydramine promethazine hydroxyzine montelukast bilastine
phenylephrine pseudoephedrine dextromethorphan ambroxol bromhexine guaifenesin guaiphenesin terbutaline salbutamol
levosalbutamol budesonide formoterol theophylline doxofylline codeine noscapine menthol pantoprazole omeprazole esomeprazole
rabeprazole lansoprazole ranitidine famotidine domperidone ondansetron metoclopramide itopride levosulpiride sucralfate
simethicone dimethicone dicyclomine drotaverine hyoscine loperamide racecadotril lactulose bisacodyl mesalamine ursodeoxycholic
magaldrate metformin glimepiride gliclazide glibenclamide sitagliptin vildagliptin teneligliptin dapagliflozin empagliflozin
pioglitazone voglibose acarbose insulin amlodipine telmisartan losartan olmesartan valsartan ramipril enalapril lisinopril
atenolol metoprolol bisoprolol carvedilol propranolol nebivolol hydrochlorothiazide chlorthalidone indapamide furosemide
frusemide torsemide spironolactone cilnidipine nifedipine clonidine prazosin atorvastatin rosuvastatin simvastatin fenofibrate
clopidogrel prasugrel ticagrelor warfarin apixaban rivaroxaban dabigatran isosorbide nitroglycerin ranolazine trimetazidine
digoxin levothyroxine thyroxine carbimazole prednisolone methylprednisolone dexamethasone hydrocortisone betamethasone
deflazacort sertraline escitalopram fluoxetine paroxetine amitriptyline nortriptyline duloxetine venlafaxine mirtazapine
alprazolam clonazepam lorazepam diazepam etizolam zolpidem olanzapine risperidone quetiapine aripiprazole haloperidol lithium
valproate divalproex levetiracetam phenytoin carbamazepine oxcarbazepine lamotrigine topiramate gabapentin pregabalin
methylcobalamin mecobalamin donepezil cholecalciferol ergocalciferol vitamin calcitriol folic cyanocobalamin pyridoxine
thiamine riboflavin niacinamide nicotinamide ascorbic biotin ferrous ferric lycopene tamsulosin sildenafil tadalafil
finasteride dutasteride alfuzosin solifenacin tolterodine mifepristone misoprostol progesterone dydrogesterone norethisterone
letrozole clomiphene estradiol povidone iodine mupirocin fusidic sulfadiazine neomycin gentamicin tobramycin framycetin
beclomethasone clobetasol mometasone fluticasone permethrin lidocaine lignocaine benzocaine oxymetazoline xylometazoline
naphazoline carboxymethylcellulose dextrose electrolytes heparin enoxaparin methotrexate hydroxyurea tacrolimus cyclosporine
azathioprine febuxostat allopurinol colchicine benfotiamine inositol pancreatin cinnarizine betahistine meclizine dimenhydrinate
tranexamic ethamsylate mefloquine primaquine nystatin silymarin sodium potassium calcium magnesium zinc iron`
  .split(/\s+/)
  .filter(Boolean)

/** Salt forms and qualifiers that are part of an ingredient name, never a brand. */
const SALT_PARTS = `hydrochloride hcl maleate trihydrate monohydrate dihydrate hyclate besylate besilate succinate tartrate citrate sulphate
sulfate phosphate acetate bromide hydrobromide mesylate fumarate propionate dipropionate valerate furoate xinafoate gluconate
carbonate oxide chloride lactate diluted anhydrous acid dried purified light liquid sesquihydrate pentahydrate hemihydrate
dihydrochloride disodium alendronate`.split(/\s+/)

const INGREDIENT_WORDS = new Set([...SALTS, ...SALT_PARTS])
const SALT_LIST = SALTS.filter((s) => s.length >= 6)
/** OCR confuses l, i and 1 (and rn with m) all the time; compare words with those folded together. */
const fold = (w: string) => w.replace(/rn/g, 'm').replace(/[l1]/g, 'i').replace(/0/g, 'o')
const FOLDED = new Map([...SALT_LIST, ...SALT_PARTS.filter((x) => x.length >= 7)].map((x) => [fold(x), x]))

/** Edit distance of at most 1 (one OCR slip: Paracetamo1, Amoxicilin). */
function nearlyEqual(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/** The known spelling of an ingredient word misread by one letter ("Hydrochlofide" -> "Hydrochloride"), else the word. */
function snapIngredient(word: string): string {
  const w = word.toLowerCase()
  if (w.length < 7 || !/^[a-z]+$/.test(w) || INGREDIENT_WORDS.has(w)) return word
  const folded = FOLDED.get(fold(w))
  const hits = folded ? [folded] : [...SALT_LIST, ...SALT_PARTS.filter((x) => x.length >= 7)].filter((x) => nearlyEqual(x, w))
  if (hits.length !== 1) return word
  const fix = hits[0]!
  return word === word.toUpperCase() ? fix.toUpperCase() : word[0] === word[0]!.toUpperCase() ? fix[0]!.toUpperCase() + fix.slice(1) : fix
}

/** True when the word is a known active ingredient or salt form (allowing one OCR slip on long words). */
export function isIngredientWord(word: string): boolean {
  const w = word.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l').replace(/[^a-z]/g, '')
  if (w.length < 3) return false
  if (INGREDIENT_WORDS.has(w) || FOLDED.has(fold(w))) return true
  return w.length >= 6 && SALT_LIST.some((s) => nearlyEqual(s, w))
}

const UNIT = String.raw`(?:mg|mcg|µg|g|gm|ml|iu|i\.u\.|units?|%\s?w\/[vw]|%)`
const PHARMACOPOEIA = String.raw`(?:I\.?P|B\.?P|U\.?S\.?P|Ph\.?\s?Eur)\.?(?![A-Za-z])`
/** One word of an ingredient name ("Paracetamol", "D3", "Amoxycillin"), never a pharmacopoeia mark or "eq. to". */
const NAME_WORD = String.raw`(?!(?:I\.?P|B\.?P|U\.?S\.?P|eq|equivalent|to|each|contains?)(?![A-Za-z]))[A-Za-z][A-Za-z0-9'\-]*`
const INGREDIENT = new RegExp(
  String.raw`(${NAME_WORD}(?:\s+${NAME_WORD}){0,4}(?:\s*\([^()\n]{1,30}\))?)\s*(${PHARMACOPOEIA})?\s*(?:\(?\s*(?:eq\.?|equivalent)\s+to\s+(?:anhydrous\s+)?[A-Za-z\-\s]+?(?:${PHARMACOPOEIA})?\s*\)?)?\s*[:.\-]?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(${UNIT})(?![a-z])`,
  'gi',
)
/** "Composition:", "Each film-coated tablet contains:", "Each 5 ml contains", "Active ingredients:" (OCR may read i as l or 1). */
const COMPOSITION_HEAD =
  /\b(?:composition\s*(?:[:\-]|\n)|active\s+ingredients?\s*[:\-]|each[\s'’.,]+(?:[a-z0-9.()'\-]+\s+){0,5}?conta[il1]ns?)\s*[:.\-]?/i
/** Words before the ingredient that belong to the heading or the sentence, not the name. */
const NAME_NOISE = new Set(['each', 'contains', 'contain', 'and', 'with', 'of', 'the', 'plus', 'per', 'active', 'ingredients', 'ingredient', 'composition'])
/** Words a name may start with before the ingredient word itself ("Vitamin D3", "Ferrous Ascorbate"). */
const NAME_PREFIX = new Set(['vitamin', 'sodium', 'potassium', 'calcium', 'magnesium', 'ferrous', 'ferric', 'folic', 'zinc', 'light', 'liquid', 'dried', 'diluted', 'purified', 'anhydrous', 'dl', 'l', 'd', 'methyl', 'ascorbic', 'mefenamic', 'tranexamic', 'fusidic', 'clavulanic', 'ursodeoxycholic', 'silver', 'isosorbide', 'acetylsalicylic'])
const FORM_WORD =
  /^(?:tab(?:let)?s?|cap(?:sule)?s?|caplets?|syrups?|suspensions?|injections?|inj|drops|solutions?|ointments?|creams?|gels?|lotions?|sachets?|granules|powders?|sprays?|oral|film|coated|film-coated|uncoated|chewable|dispersible|effervescent|sustained|extended|prolonged|modified|release|sr|er|xr|mr|cr|enteric|soft|hard|gelatin|softgels?|liquid|elixir|strip)$/i

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,.:;\-–]+|[\s,.;:\-–]+$/g, '').trim()
const titleish = (s: string) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.replace(/\B[A-Z]+/g, (m) => m.toLowerCase()) : s)

/**
 * Common OCR slips in strengths and units: O read for 0 and l/I for 1 inside numbers ("65O mg", "lO mg"),
 * "rng"/"mq" for mg, "mcq" for mcg, "1P"/"LP" for IP. Only touches a token that sits right before a unit.
 */
export function fixOcrStrengths(s: string): string {
  return s
    .replace(/(\d)['’`](?=\s*(?:mg|mcg|g|ml|iu)\b)/gi, '$1 ')
    .replace(/(?<![A-Za-z0-9])([0-9OoIl]{1,6}(?:[.,][0-9OoIl]{1,3})?)(?=\s*(?:mg|mcg|µg|g|gm|ml|iu|i\.u\.|units?|%|rng|mq|nig|mcq|rnl)(?![a-z]))/gi, (tok) =>
      /\d/.test(tok) || /^[Il][Oo0]+$/.test(tok) ? tok.replace(/[Oo]/g, '0').replace(/[Il]/g, '1') : tok,
    )
    .replace(/(\d)\s*(?:rng|mq|nig)(?![a-z])/gi, '$1 mg')
    .replace(/(\d)\s*mcq(?![a-z])/gi, '$1 mcg')
    .replace(/(\d)\s*rnl(?![a-z])/gi, '$1 ml')
    .replace(/(\d)\s*[1l]U\b/g, '$1 IU')
    .replace(/(?<=[a-z]\s)P\.?(?=\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|IU)\b)/g, 'IP')
    .replace(/(?<=[a-z]\s)(?:1|L|l)\.?P\.?(?=\s*\d)/g, 'IP')
}

const PHARM_NORM = (p: string) => {
  const k = p.replace(/[\s.]/g, '').toUpperCase()
  return k === 'PHEUR' ? 'Ph. Eur.' : k
}

/** "Paracetamol Tablets" -> "Paracetamol"; drops heading words before the name and form words after it. */
function cleanIngredientName(raw: string): string {
  let words = clean(raw.replace(/\s*\(\s*as\s+[^)]*\)/gi, '')).split(' ')
  while (words.length > 1 && NAME_NOISE.has(words[0]!.toLowerCase())) words.shift()
  const firstIngredient = words.findIndex((w) => isIngredientWord(w))
  if (firstIngredient > 0) {
    let start = firstIngredient
    while (start > 0 && NAME_PREFIX.has(words[start - 1]!.toLowerCase().replace(/[^a-z]/g, ''))) start--
    words = words.slice(start)
  }
  while (words.length > 1 && FORM_WORD.test(words[words.length - 1]!.replace(/[^A-Za-z-]/g, ''))) words.pop()
  const name = titleish(words.map(snapIngredient).join(' '))
  return /^[a-z]{3}/.test(name) ? name[0]!.toUpperCase() + name.slice(1) : name
}

function ingredientsIn(body: string, requireKnown: boolean): string[] {
  const out: string[] = []
  for (const m of fixOcrStrengths(body).matchAll(INGREDIENT)) {
    const name = cleanIngredientName(m[1]!)
    const letters = name.replace(/[^a-z]/gi, '').length
    if (!name || letters < 3 || /^(?:q\.?s|qs|excipients?|colou?rs?)$/i.test(name) || FORM_WORD.test(name)) continue
    if (NAME_NOISE.has(name.toLowerCase()) || /^(?:net|vol|wt|weight|qty|contents?|pack|strip|each|mrp|rs)\b/i.test(name)) continue
    if (requireKnown && !name.split(/\s+/).some(isIngredientWord)) continue
    let unit = m[4]!.toLowerCase().replace(/\s/g, '').replace('gm', 'g').replace('µg', 'mcg')
    if (unit === 'iu' || unit === 'i.u.') unit = 'IU'
    else if (unit.startsWith('%w/')) unit = `% ${unit.slice(1)}`
    const amount = m[3]!.replace(/,(?=\d{3}\b)/g, '')
    const item = `${name}${m[2] ? ' ' + PHARM_NORM(m[2]) : ''} ${amount}${unit.startsWith('%') ? '' : ' '}${unit}`
    const key = (v: string) => v.toLowerCase().replace(/\b(?:ip|bp|usp|ph\. eur\.)\b/g, '').replace(/[^a-z0-9.%]/g, '')
    if (!out.some((o) => key(o) === key(item))) out.push(item)
    if (out.length >= 8) break
  }
  return out
}

/**
 * Active ingredients, e.g. ["Paracetamol IP 500 mg", "Caffeine IP 30 mg"]. Read after a "Composition:" /
 * "Each tablet contains:" heading; without one (or when the heading was misread), only lines that name a
 * known ingredient with a strength count, so a stray "500 mg" never becomes an ingredient.
 */
export function parseCompositionDetailed(text: string): { items: string[]; headed: boolean } {
  const head = COMPOSITION_HEAD.exec(text)
  if (head) {
    let body = text.slice(head.index + head[0].length)
    const stop = STOP.exec(body)
    if (stop) body = body.slice(0, stop.index)
    const items = ingredientsIn(body.slice(0, 500), false)
    if (items.length) return { items, headed: true }
  }
  const lines = text
    .split('\n')
    .filter((l) => !/\b(?:mfd|mfg|manufactured|marketed|mkt|b\.?\s?no|batch|exp|m\.?\s?r\.?\s?p|price|lic|store|keep|dosage|directions)(?![a-z])/i.test(l))
  return { items: ingredientsIn(lines.join('\n'), true), headed: false }
}

/** Active ingredients (see parseCompositionDetailed). */
export function parseComposition(text: string): string[] {
  return parseCompositionDetailed(text).items
}

export function detectForm(text: string): string | undefined {
  for (const [re, form] of FORMS) if (re.test(text)) return form
  return undefined
}

/** "10 Tablets", "1 x 10 Tablets", "Strip of 15 capsules", "100 ml" (never the "Each 5 ml" dose volume). */
export function parsePackSize(text: string): string | undefined {
  let m = /\b(\d{1,3})\s?[x×]\s?(\d{1,3})\s*(tablets?|capsules?|tabs?|caps?)?\b/i.exec(text)
  if (m) return `${m[1]} x ${m[2]}${m[3] ? ' ' + normCount(m[3]) : ''}`
  m = /\bstrip\s+of\s+(\d{1,3})\s*(tablets?|capsules?)?/i.exec(text)
  if (m) return `${m[1]} ${normCount(m[2] ?? 'tablets')}`
  for (const x of text.matchAll(/(\b\w+\s+)?\b(\d{1,3})\s*(tablets|capsules|tabs|caps)\b/gi)) {
    if (!/^(each|per)\s/i.test(x[1] ?? '')) return `${x[2]} ${normCount(x[3]!)}`
  }
  for (const x of text.matchAll(/(\b\w+\s+)?\b(\d{1,4}(?:\.\d+)?)\s?(ml|g|gm)\b(?!\s*contains)/gi)) {
    if (!/^(each|per|in|to)\s/i.test(x[1] ?? '') && Number(x[2]) >= 5) return `${x[2]} ${x[3]!.toLowerCase().replace('gm', 'g')}`
  }
  return undefined
}
const normCount = (w: string) => (/^cap/i.test(w) ? 'capsules' : 'tablets')

const MAKER = /\b(?:mfd\.?|mfg\.?|manufactured)\s*(?:in\s+india\s+)?by\s*[:.\-]?\s*/i
const MARKETER = /\b(?:marketed|mkt\.?|mktd\.?|distributed)\s*by\s*[:.\-]?\s*/i

function party(text: string, label: RegExp): { name: string; address: string } | undefined {
  const m = label.exec(text)
  if (!m) return undefined
  const rest = text.slice(m.index + m[0].length).split('\n')
  const first = rest[0] ?? ''
  // The company name ends at the first comma (address follows) or at the end of the line.
  const comma = first.indexOf(',')
  const name = clean((comma > 2 ? first.slice(0, comma) : first).replace(/^m\/s\.?\s*/i, ''))
  if (!/[a-z]{3}/i.test(name)) return undefined
  const addressParts = [comma > 2 ? first.slice(comma + 1) : '']
  for (const line of rest.slice(1, 3)) {
    if (!line.trim() || STOP.test(line) || MARKETER.test(line) || MAKER.test(line)) break
    addressParts.push(line)
  }
  const address = clean(addressParts.join(', ').replace(/,\s*,/g, ','))
  const stop = STOP.exec(address)
  return { name: name.slice(0, 80), address: (stop ? clean(address.slice(0, stop.index)) : address).slice(0, 160) }
}

export function stateOf(address: string): string | undefined {
  const s = STATES.find((st) => new RegExp(`\\b${st.replace(/[&.]/g, (c) => '\\' + c)}\\b`, 'i').test(address))
  if (s) return s === 'Pondicherry' ? 'Puducherry' : s === 'Jammu & Kashmir' ? 'Jammu and Kashmir' : s
  for (const [abbr, full] of Object.entries(STATE_ABBR)) if (address.toUpperCase().includes(abbr)) return full
  return undefined
}

export function parseLicence(text: string): string | undefined {
  const m = /\b(?:(?:mfg|mfd|manufacturing|drug)\.?\s*)?(?:lic(?:ence|ense)?|l)\.?\s*no\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-/.()]{1,20}(?:[ \t][A-Z0-9][A-Z0-9\-/]{0,12})?)/i.exec(text) ?? /\bM\.?\s?L\.?\s*(?:No\.?)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-/]{2,20})/.exec(text)
  if (!m) return undefined
  const v = m[1]!.replace(/[.\-/]+$/, '').trim()
  return /\d/.test(v) ? v.toUpperCase() : undefined
}

export function parseMrp(text: string): string | undefined {
  const m = /\bM\.?\s?R\.?\s?P\.?\s*(?:\(?incl[^)]*\)?)?\s*(?:Rs\.?|₹|INR)?\s*[:.\-]?\s*(?:Rs\.?|₹|INR)?\s*(\d{1,5}(?:[.,]\d{1,2})?)/i.exec(text) ?? /(?:Rs\.?|₹)\s*(\d{1,5}(?:[.,]\d{1,2})?)/i.exec(text)
  return m ? m[1]!.replace(',', '.') : undefined
}

export function parseSchedule(text: string): string | undefined {
  const m = /\bschedule\s*[-‐]?\s*(H\s?1|H|X|G)\b/i.exec(text)
  if (m) return m[1]!.replace(/\s/g, '').toUpperCase()
  if (/prescription\s+of\s+a\s+registered\s+medical\s+practitioner/i.test(text)) return 'H'
  return undefined
}

/**
 * A dosage form on its own, never a medicine name: "Tablet", "TABLETS", "15 Capsules", "Syrup IP",
 * "Film-coated tablets I.P. 650 mg". A strip often prints the form on a line of its own, and a cropped
 * camera read can see only that line, so the product name must never fall back to it.
 */
const FORM_ONLY = new RegExp(
  String.raw`^(?:\d+\s*(?:[x×]\s*\d+\s*)?)?(?:(?:film|sugar|enteric)[\s-]?coated\s+|uncoated\s+|chewable\s+|dispersible\s+|effervescent\s+|oral\s+|eye\s+|ear\s+|nasal\s+|(?:soft|hard)\s+gelatin\s+|(?:sustained|extended|prolonged|modified)[\s-]release\s+)*(?:tab(?:let)?s?|cap(?:sule)?s?|caplets?|syrups?|suspensions?|injections?|inj|drops|solutions?|ointments?|creams?|gels?|lotions?|inhalers?|rotacaps?|sachets?|granules|powders?|sprays?|liquids?|elixirs?|vials?|ampoules?|medicines?|other|unknown)\.?(?:\s*${PHARMACOPOEIA})?(?:\s*\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|%))?[\s.]*$`,
  'i',
)

/** True when the text is only a dosage form (see FORM_ONLY), not a name. */
export const isBareForm = (s: string | null | undefined) => !!s && FORM_ONLY.test(s.replace(/\s+/g, ' ').trim())

const LABEL_WORDS = /\b(?:composition|contains|each|mfd|mfg|manufactured|marketed|mkt|batch|b\.?\s?no|exp|expiry|m\.?r\.?p|store|keep|schedule|warning|caution|lic|regd|dosage|directions|rx|use before|price|incl|taxes)\b/i

// ---- Brand name. On an Indian strip or carton the brand ("DOLO-650", "CROCIN", "Azithral-500") is the
// biggest, boldest word on the front, often with ® or ™, usually alone on its line and just above the
// generic line or the composition. It is never an ingredient, a dosage form, a unit, a company name or a
// regulatory word. Every signal adds to a score; only a clear winner becomes the brand.

/** One line of the OCR layout: its text, the height of its letters in pixels and Tesseract's confidence (0-100). */
export type OcrLine = { text: string; height: number; confidence: number }

const COMPANY =
  /\b(?:ltd|limited|pvt|private|pharma|pharmaceuticals?|laborator(?:y|ies)|labs?|healthcare|life\s?sciences?|remedies|industries|inc|corp(?:oration)?|biotech|formulations|biologicals|llp|enterprises|marketing|distributors?|co\.)(?![a-z])/i
const BRAND_STOP = new Set(
  `schedule rx ip bp usp ph eur mfd mfg exp expiry lic licence license batch lot regd mrp price rs inr incl taxes net qty quantity wt weight
vol volume contents content each contains contain composition ingredients ingredient active excipients colour color approved flavour flavoured
dosage directions direction store storage keep protect warning caution only use for not drug drugs prescription retail registered medical
practitioner doctor children reach sterile shake well before after oral external internal made india product of manufactured marketed
distributed by and the with new strip pack tablets tablet tab tabs capsules capsule cap caps caplets syrup suspension injection inj drops
solution ointment cream gel lotion inhaler sachet sachets granules powder spray liquid elixir film coated uncoated chewable dispersible
effervescent sustained extended prolonged modified release enteric softgel softgels vial ampoule mg mcg ml gm iu units unit kg date dt
no address plot road industrial area estate dist district village phase sector nagar gidc sidco sipcot midc tel fax email www customer
care helpline toll free see leaflet insert read carefully information side effects dose adult adults paediatric pediatric veterinary vet
human sugar base qs equivalent eq to per day daily times hours tamil nadu himachal pradesh gujarat maharashtra uttarakhand sikkim goa
punjab haryana telangana karnataka kerala delhi mumbai hyderabad ahmedabad baddi ayurvedic homoeopathic homeopathic
proprietary medicine medicines generic trade mark brand improved formula indications indication contraindications`.split(/\s+/),
)
/** Brand suffixes that stay with the name: "MOXIKIND-CV", "Montair LC", "Pan D", "Crocin Advance". */
const BRAND_SUFFIX = /^(?:CV|LC|DS|SR|XR|MR|ER|CR|OD|DSR|XL|LS|AM|HT|MT|AF|LA|D|Plus|PLUS|Forte|FORTE|Duo|DUO|Advance|ADVANCE|Kid|KID|Kids|KIDS|Junior|JUNIOR|Max|MAX|Extra|EXTRA|Active|ACTIVE|Cold|COLD|Total|TOTAL|Fast|FAST|Rapid|RAPID|Neo|NEO|Gold|GOLD|Nasal|NASAL)$/
const MARKS = /®|™|©|\((?:R|TM)\)|(?<=[A-Za-z0-9])@/

/** Digits misread as letters inside a number part: "65O" -> "650", "l0" -> "10". Words are left alone. */
const fixDigits = (token: string) =>
  token
    .split('-')
    .map((part) => (/\d/.test(part) && /^[0-9OoIl]+$/.test(part) ? part.replace(/[Oo]/g, '0').replace(/[Il]/g, '1') : part))
    .join('-')

const layoutKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The brand, from OCR text and (when available) the OCR layout's line heights. Returns undefined when no
 * word on the label looks enough like a brand; it never falls back to an ingredient or a form.
 */
export function parseBrand(text: string, layout?: OcrLine[]): { value: string; confidence: number } | undefined {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => /[A-Za-z]{2}/.test(l))
    .slice(0, 18)
  const heights = (layout ?? []).filter((l) => l.height > 0 && /[A-Za-z]{2}/.test(l.text)).map((l) => l.height).sort((a, b) => a - b)
  const median = heights.length >= 2 ? heights[Math.floor((heights.length - 1) / 2)]! : 0
  const tallest = heights[heights.length - 1] ?? 0
  const lineOf = (line: string) => {
    const k = layoutKey(line)
    if (k.length < 3) return undefined
    return layout?.find((l) => layoutKey(l.text) === k) ?? layout?.find((l) => layoutKey(l.text).length >= 4 && (layoutKey(l.text).includes(k) || k.includes(layoutKey(l.text))))
  }
  const compAt = lines.findIndex((l) => COMPOSITION_HEAD.test(l))
  let best: { value: string; score: number } | undefined

  lines.forEach((line, i) => {
    const marked = MARKS.test(line.slice(0, 32))
    const l = line
      .replace(/\s?(?:®|™|©|\((?:R|TM)\))/g, ' ')
      .replace(/(?<=[A-Za-z0-9])@/g, ' ')
      .replace(/^(?:Rx|℞)\s+/i, '')
      .replace(/([A-Za-z])\s*-\s+(?=\d)|([A-Za-z])\s+-\s*(?=\d)/g, '$1$2-')
      .replace(/\s+/g, ' ')
      .trim()
    if (COMPANY.test(l) || /\b\d{6}\b/.test(l) || (LABEL_WORDS.test(l) && !marked)) return
    const tokens = l.split(' ')
    let k = 0
    while (k < tokens.length - 1 && (tokens[k]!.replace(/[^A-Za-z0-9]/g, '').length === 0 || (tokens[k]!.length === 1 && !/\d/.test(tokens[k]!)))) k++
    const head = fixDigits((tokens[k] ?? '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').replace(/(?<=[-\s]|^)([A-Z])\.(?=[A-Z](?:\.|\b))/g, '$1').replace(/(?<=[A-Z])\.$/, ''))
    if (!/^[A-Z][A-Za-z0-9]*(?:[-'][A-Za-z0-9]+)*$/.test(head) || head.length < 3 || head.length > 20) return
    const alpha = head.replace(/[^A-Za-z]/g, '')
    if (alpha.length < 3 && !(head.includes('-') && alpha.length >= 2)) return
    const first = head.split(/[-']/)[0]!.toLowerCase()
    if (BRAND_STOP.has(first) || BRAND_STOP.has(alpha.toLowerCase()) || isIngredientWord(first) || isIngredientWord(alpha)) return
    // A batch-like code (DOBS4410, AB1234) is not a brand.
    if (/^[A-Z]{1,5}\d{3,}[A-Z0-9]*$/.test(head)) return
    const caps = alpha === alpha.toUpperCase()

    const phrase = [head]
    let j = k + 1
    while (j < tokens.length && phrase.length < 4) {
      const t = fixDigits(tokens[j]!.replace(/[,;:.]+$/, ''))
      if (/^\d{2,4}$/.test(t) && !phrase.some((p) => /^\d+$/.test(p)) && !/-\d/.test(head)) phrase.push(t)
      else if (BRAND_SUFFIX.test(t)) phrase.push(t)
      else if (caps && phrase.length === 1 && /^[A-Z]{3,10}$/.test(t) && !BRAND_STOP.has(t.toLowerCase()) && !isIngredientWord(t)) phrase.push(t)
      else break
      j++
    }
    const value = phrase.join(' ')
    const rest = tokens.slice(j).join(' ')

    let score = 1 + Math.max(0, 2 - i * 0.25)
    if (marked) score += 4
    score += caps ? 1 : 0.5
    if (/\d/.test(value)) score += 0.75
    if (!rest || isBareForm(rest)) score += 1.5
    else if (isIngredientWord(rest.split(' ')[0]!) || /^\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml)\b/i.test(rest)) score += 1
    else if (rest.split(' ').length > 2) score -= 1.5
    // The brand is often printed again (front and back, or on every strip pocket).
    if ((text.match(new RegExp(`\\b${escapeRe(head.split(/[-']/)[0]!)}`, 'gi')) ?? []).length >= 2) score += 1.5
    // Just above the generic line or the composition block.
    const below = lines.slice(i + 1, i + 3)
    if ((compAt > i && compAt <= i + 2) || below.some((n) => isIngredientWord(n.split(' ')[0] ?? ''))) score += 1
    const layoutLine = lineOf(line)
    if (layoutLine && median) {
      const r = layoutLine.height / median
      score += r >= 1.6 ? 3 : r >= 1.3 ? 2 : r >= 1.12 ? 1 : r < 0.9 ? -1 : 0
      if (r > 1.1 && layoutLine.height >= tallest * 0.98) score += 1
    }
    if (layoutLine && layoutLine.confidence < 50) score -= 1
    if (!best || score > best.score) best = { value, score }
  })
  if (!best || best.score < 4) return undefined
  const b = best as { value: string; score: number }
  return { value: b.value.slice(0, 40), confidence: b.score >= 8 ? 0.9 : b.score >= 6.5 ? 0.8 : b.score >= 5 ? 0.7 : 0.55 }
}

/** True when the generic line adds something the brand does not already say ("COLDRIF Syrup" adds nothing to "COLDRIF"). */
export function genericOf(pack: Pick<PackLabel, 'brand' | 'product'> | null | undefined): string | undefined {
  const product = pack?.product?.value
  if (!product) return undefined
  const brand = pack?.brand?.value
  if (!brand) return product
  const b = layoutKey(brand)
  const p = layoutKey(product)
  if (p === b || b.startsWith(p)) return undefined
  if (p.startsWith(b)) {
    // "DOLO-650 Paracetamol Tablets IP 650 mg": the part after the brand is the generic, unless it is only a form.
    const rest = product.replace(new RegExp(`^\\W*${brand.split(/[^A-Za-z0-9]+/).filter(Boolean).map(escapeRe).join('[^A-Za-z0-9]*')}\\W*`, 'i'), '').trim()
    return rest && rest !== product && !isBareForm(rest) && /[A-Za-z]{3}/.test(rest) ? rest : undefined
  }
  return product
}

/** Product name: an early, mostly-letters line, preferring one that names a dosage form or a brand in capitals. */
export function parseProduct(text: string): { value: string; confidence: number } | undefined {
  const lines = text
    .split('\n')
    .map((l) =>
      clean(
        l
          .replace(/^\s*(?:Rx|℞)\s+/i, '')
          .replace(/\s?(?:®|™|\((?:R|TM)\))/g, ' ')
          // OCR specks at either end of a line: "f Sodium & ...", "+. Azithromycin ...", "... Syrup a".
          .replace(/^\s*(?:[^A-Za-z0-9\s(]+|[a-z])(?:\s+(?:[^A-Za-z0-9\s(]+|[a-z]))*\s+(?=[A-Za-z0-9])/, '')
          .replace(/\s+(?:[^A-Za-z0-9\s)%]+|[a-z])$/, ''),
      ),
    )
    .filter(Boolean)
  const compAt = lines.findIndex((l) => COMPOSITION_HEAD.test(l))
  let best: { value: string; score: number } | undefined
  lines.slice(0, 12).forEach((raw, i, all) => {
    let line = raw
    // A form printed on its own line ("TABLETS") is never the name; it may finish the line above ("Paracetamol" / "Tablets IP").
    if (isBareForm(line)) {
      const prev = all[i - 1]
      if (!prev || /^\d/.test(line) || isBareForm(prev) || LABEL_WORDS.test(prev) || prev.length > 40 || !/^[A-Za-z][A-Za-z0-9 .+&-]*$/.test(prev)) return
      line = `${prev} ${line}`
    }
    if (LABEL_WORDS.test(line) || line.length < 3 || line.length > 60) return
    const letters = line.replace(/[^a-z]/gi, '').length
    if (letters < 3 || letters / line.length < 0.5) return
    let score = 4 - i * 0.4
    if (detectForm(line)) score += 2.5
    if (/\b[A-Z][A-Z0-9-]{2,}\b/.test(line)) score += 1
    if (new RegExp(`\\b${PHARMACOPOEIA}`).test(line)) score += 0.5
    if (/\d+\s?(?:mg|ml)\b/i.test(line)) score += 0.5
    // The generic line names an ingredient and a form ("Paracetamol Tablets IP 650 mg").
    if (isIngredientWord(line.split(' ')[0]!) && detectForm(line)) score += 1.5
    // Lines inside the composition block are ingredients, not the product.
    if (compAt >= 0 && i > compAt) score -= 2
    if (!best || score > best.score) best = { value: line, score }
  })
  if (!best) return undefined
  return { value: best.value.slice(0, 80), confidence: best.score >= 5 ? 0.75 : best.score >= 3 ? 0.55 : 0.35 }
}

/**
 * Structured label from OCR text. `ocrConfidence(value)` (0-100) lowers a field's confidence when the
 * words it came from were read poorly; without it the grammar's own certainty is used.
 */
export function parsePackLabel(text: string, ocrConfidence?: (value: string) => number, layout?: OcrLine[]): PackLabel {
  const t = text.replace(/\r/g, '').replace(/[|]/g, ' ')
  const f = (value: string | undefined, grammar: number): PackField | undefined => {
    if (!value) return undefined
    const ocr = ocrConfidence ? Math.max(0, Math.min(100, ocrConfidence(value))) / 100 : 1
    return { value, confidence: Math.round(Math.min(grammar, ocr) * 100) / 100 }
  }
  const out: PackLabel = { composition: [], rawText: text }
  const brand = parseBrand(t, layout)
  if (brand) out.brand = f(brand.value, brand.confidence)
  const product = parseProduct(t)
  if (product) out.product = f(product.value, product.confidence)
  const composition = parseCompositionDetailed(t)
  out.composition = composition.items.map((c) => f(c, composition.headed ? 0.85 : 0.6)!)
  out.form = f(detectForm(product?.value ?? '') ?? detectForm(t), product && detectForm(product.value) ? 0.85 : 0.6)
  out.packSize = f(parsePackSize(t), 0.7)
  const maker = party(t, MAKER)
  const marketer = party(t, MARKETER)
  const who = maker ?? marketer
  if (who) {
    out.manufacturer = f(who.name, maker ? 0.85 : 0.6)
    if (who.address) out.manufacturerAddress = f(who.address, 0.7)
    const st = stateOf(who.address || who.name)
    if (st) out.manufacturerState = f(st, 0.8)
  }
  if (maker && marketer) out.marketedBy = f(marketer.name, 0.8)
  out.licence = f(parseLicence(t), 0.85)
  out.mrp = f(parseMrp(t), 0.8)
  out.schedule = f(parseSchedule(t), 0.9)
  for (const k of Object.keys(out) as (keyof PackLabel)[]) if (out[k] === undefined) delete out[k]
  return out
}

/** True when the label names the medicine well enough to ask about it. */
export const knowsMedicine = (p: Pick<PackLabel, 'brand' | 'product' | 'composition'> | null | undefined) =>
  !!p && (!!p.brand?.value || !!p.product?.value || p.composition.length > 0)

/** The name people use for this pack: the brand when one was read, else the product line. */
export const packName = (p: Pick<PackLabel, 'brand' | 'product'> | null | undefined) => p?.brand?.value ?? p?.product?.value

const PHARM_TOKEN = /\s*\b(?:I\.?P|B\.?P|U\.?S\.?P|Ph\.?\s?Eur)\.?(?![A-Za-z])/g

/** A short ingredient line for a headline: "Paracetamol 650 mg", "Amoxycillin Trihydrate 500 mg + Potassium Clavulanate Diluted 125 mg". */
export function shortComposition(items: string[]): string | undefined {
  const short = items.map((c) => c.replace(/\s*\([^)]*\)/g, '').replace(PHARM_TOKEN, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!short.length) return undefined
  return short.length > 3 ? `${short.slice(0, 2).join(' + ')} + ${short.length - 2} more` : short.join(' + ')
}

/** "Micro Labs Limited" -> "Micro Labs"; "Example Health Pvt. Ltd." -> "Example Health". */
export function shortMaker(name: string | undefined): string | undefined {
  const v = name?.replace(/[\s,.]*\b(?:pvt|private|ltd|limited|inc|llp|co|corp|corporation)\b\.?/gi, '').replace(/\s+/g, ' ').trim()
  return v || name?.trim() || undefined
}

/** One line that names the pack: "DOLO-650 · Paracetamol 650 mg · Micro Labs". The brand leads when there is one. */
export function packSummary(pack: Pick<PackLabel, 'brand' | 'product' | 'composition' | 'manufacturer'> | null | undefined): { name?: string; detail?: string } {
  if (!pack) return {}
  const name = pack.brand?.value ?? (isBareForm(pack.product?.value) ? undefined : pack.product?.value)
  const generic = shortComposition(pack.composition.map((c) => c.value)) ?? (pack.brand ? genericOf(pack) : undefined)
  const detail = [generic, shortMaker(pack.manufacturer?.value)].filter(Boolean).join(' · ') || undefined
  return { name, detail }
}
