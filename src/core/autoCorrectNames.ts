/**
 * Auto-correct for camera and lens names (Dave, 27 Nov), like a word processor's autocorrect: "NIKON Z5_2" shows as
 * "Nikon Z5 II", "SONY ILCE-7RM5" as "Sony α7R V", "NIKKOR Z 100-400mm f/4.5-5.6 VR S" as
 * "Nikkor Z 100–400mm f/4.5–5.6 VR S". Display only: nothing is written to a file or to exported metadata, and search
 * still matches the raw EXIF value. Pure and unit-tested.
 *
 * The raw camera value is the catalogue's own label (src/core/exifParser.ts formatCameraLabel): EXIF Make and Model,
 * with the make left off when the model already names it ("NIKON Z 8", "Canon EOS R5", "SONY ILCE-7RM5").
 *
 * A rule is a Replace → With pair that can be turned off. Built-in rules come with InFlight; "Yours" are added by the
 * person (one-click Rename on a name seen in their photos). Yours win over built-in. A code no rule knows is left as it
 * is: a name is never guessed.
 */
export type NameKind = 'camera' | 'lens';

export interface NameRule {
  id: string;
  kind: NameKind;
  /**
   * What the rule matches:
   * - 'whole': the entire raw value (case and spacing ignored). Every "Yours" rule is a whole-value rule.
   * - 'make': the maker at the start of a camera value.
   * - 'model': a camera model after the maker.
   * - 'pattern': a family of model codes (a regular expression on the model), for codes like ILCE-7RM5.
   * - 'tidy': the general lens tidying (title case for brand words, en dash in ranges, consistent f/).
   */
  scope: 'whole' | 'make' | 'model' | 'pattern' | 'tidy';
  replace: string;
  with: string;
  on: boolean;
  source: 'builtin' | 'yours';
  /** For a model or pattern rule: the friendly maker it belongs to. */
  make?: string;
}

const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const roman = (n: string) => ROMAN[Number(n)] ?? n;

// --- Built-in rules -------------------------------------------------------------------------------------------------

/** Makers as cameras write them, longest first so "NIKON CORPORATION" wins over "NIKON". */
const MAKES: [string, string][] = [
  ['NIKON CORPORATION', 'Nikon'], ['NIKON', 'Nikon'],
  ['Canon', 'Canon'],
  ['SONY', 'Sony'],
  ['FUJIFILM', 'Fujifilm'],
  ['OM Digital Solutions', 'OM System'], ['OLYMPUS IMAGING CORP.', 'Olympus'], ['OLYMPUS CORPORATION', 'Olympus'], ['OLYMPUS', 'Olympus'],
  ['Panasonic', 'Panasonic'],
  ['LEICA CAMERA AG', 'Leica'], ['Leica Camera AG', 'Leica'], ['LEICA', 'Leica'],
  ['RICOH IMAGING COMPANY, LTD.', 'Ricoh'], ['PENTAX Corporation', 'Pentax'], ['PENTAX', 'Pentax'], ['RICOH', 'Ricoh'],
  ['Hasselblad', 'Hasselblad'],
  ['DJI', 'DJI'],
  ['Apple', 'Apple'], ['Google', 'Google'], ['samsung', 'Samsung'],
];

/** Models whose code reads differently from the camera's own name, by friendly maker. */
const MODELS: Record<string, [string, string][]> = {
  Nikon: [['Z 8', 'Z8'], ['Z 9', 'Z9'], ['Z5_2', 'Z5 II'], ['Z 5', 'Z5'], ['Z 6', 'Z6'], ['Z 6_2', 'Z6 II'], ['Z 6_3', 'Z6 III'], ['Z6_3', 'Z6 III'],
    ['Z 7', 'Z7'], ['Z 7_2', 'Z7 II'], ['Z f', 'Zf'], ['Z fc', 'Zfc'], ['Z 50', 'Z50'], ['Z50_2', 'Z50 II'], ['Z 30', 'Z30']],
  Olympus: [['E-M1MarkIII', 'OM-D E-M1 Mark III'], ['E-M1MarkII', 'OM-D E-M1 Mark II'], ['E-M1X', 'OM-D E-M1X'], ['E-M5MarkIII', 'OM-D E-M5 Mark III'], ['E-M10MarkIV', 'OM-D E-M10 Mark IV']],
};

/** Families of codes, by friendly maker: [pattern on the model, replacement]. */
const PATTERNS: Record<string, [string, string][]> = {
  // ILCE-7RM5 → α7R V, ILCE-7M4 → α7 IV, ILCE-1 → α1, ILCE-6700 → α6700, ILCE-7CM2 → α7C II.
  Sony: [['^ILCE-(\\d+)([A-Z]*)M(\\d)$', 'α$1$2 $R3'], ['^ILCE-(\\d+)([A-Z]*)$', 'α$1$2'],
    ['^DSC-(RX\\d+)M(\\d)$', '$1 $R2'], ['^DSC-(RX\\d+)$', '$1']],
  // DC-S5M2 → Lumix S5 II, DC-GH6 → Lumix GH6.
  Panasonic: [['^DC-([A-Z]+\\d+[A-Z]*)M(\\d)$', 'Lumix $1 $R2'], ['^DC-([A-Z]+\\d+[A-Z]*)$', 'Lumix $1']],
};

export const BUILTIN_RULES: readonly NameRule[] = Object.freeze([
  ...MAKES.map(([replace, to]): NameRule => ({ id: `make:${replace}`, kind: 'camera', scope: 'make', replace, with: to, on: true, source: 'builtin' })),
  ...Object.entries(MODELS).flatMap(([make, pairs]) => pairs.map(([replace, to]): NameRule =>
    ({ id: `model:${make}:${replace}`, kind: 'camera', scope: 'model', replace, with: to, on: true, source: 'builtin', make }))),
  ...Object.entries(PATTERNS).flatMap(([make, pairs]) => pairs.map(([replace, to]): NameRule =>
    ({ id: `pattern:${make}:${replace}`, kind: 'camera', scope: 'pattern', replace, with: to, on: true, source: 'builtin', make }))),
  { id: 'tidy:lens', kind: 'lens', scope: 'tidy', replace: 'NIKKOR Z 100-400mm F4.5-5.6', with: 'Nikkor Z 100–400mm f/4.5–5.6', on: true, source: 'builtin' },
]);

// --- Applying them --------------------------------------------------------------------------------------------------

function whole(rules: readonly NameRule[], kind: NameKind, raw: string): string | null {
  const key = norm(raw);
  // Yours first, then built-in.
  for (const source of ['yours', 'builtin'] as const) {
    const hit = rules.find((rule) => rule.on && rule.kind === kind && rule.scope === 'whole' && rule.source === source && norm(rule.replace) === key);
    if (hit) return hit.with;
  }
  return null;
}

function applyPattern(model: string, pattern: string, to: string): string | null {
  let match: RegExpMatchArray | null;
  try { match = model.match(new RegExp(pattern)); } catch { return null; }
  if (!match) return null;
  // $n is the captured text; $Rn the captured number as a Roman numeral (5 → V).
  return to.replace(/\$R(\d)/g, (_, n: string) => roman(match![Number(n)] ?? '')).replace(/\$(\d)/g, (_, n: string) => match![Number(n)] ?? '');
}

/** The friendly camera name for a raw value, with the rules given (built-in and the person's own). */
export function friendlyCamera(raw: string | undefined, rules: readonly NameRule[] = BUILTIN_RULES): string {
  const value = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return value;
  const own = whole(rules, 'camera', value);
  if (own !== null) return own;
  // The maker at the start (longest first), its friendly name, and the model after it.
  const makes = rules.filter((rule) => rule.on && rule.kind === 'camera' && rule.scope === 'make')
    .sort((a, b) => b.replace.length - a.replace.length);
  const lower = value.toLowerCase();
  let make: string | null = null;
  let model = value;
  for (const rule of makes) {
    const prefix = rule.replace.toLowerCase();
    if (lower === prefix || lower.startsWith(`${prefix} `)) { make = rule.with; model = value.slice(rule.replace.length).trim(); break; }
  }
  // A model that names its maker again ("LEICA Q3", "PENTAX K-3 Mark III" under Ricoh) says it once.
  if (make) {
    const again = makes.find((rule) => model.toLowerCase().startsWith(`${rule.replace.toLowerCase()} `));
    if (again) { make = again.with; model = model.slice(again.replace.length).trim(); }
  } else {
    return value;
  }
  if (!model) return make;
  const exact = rules.find((rule) => rule.on && rule.kind === 'camera' && rule.scope === 'model' && rule.make === make && norm(rule.replace) === norm(model));
  if (exact) return `${make} ${exact.with}`;
  for (const rule of rules) {
    if (!rule.on || rule.kind !== 'camera' || rule.scope !== 'pattern' || rule.make !== make) continue;
    const named = applyPattern(model, rule.replace, rule.with);
    if (named !== null) return `${make} ${named}`;
  }
  return `${make} ${model}`;
}

/** Brand words cameras and lenses write in capitals, in their usual form. Trade names styled in capitals stay. */
const BRAND_WORDS: [RegExp, string][] = [
  [/\bNIKKOR\b/g, 'Nikkor'], [/\bLUMIX\b/g, 'Lumix'], [/\bSIGMA\b/g, 'Sigma'], [/\bTAMRON\b/g, 'Tamron'],
  [/\bTOKINA\b/g, 'Tokina'], [/\bSAMYANG\b/g, 'Samyang'], [/\bLEICA\b/g, 'Leica'], [/\bVILTROX\b/g, 'Viltrox'], [/\bLAOWA\b/g, 'Laowa'],
];
/** Mounts written against the focal length ("RF100-500mm", "XF16-55mm"): a space after them. */
const MOUNT_PREFIX = /\b(RF-S|RF|EF-S|EF-M|EF|XF|XC|GF|FE)(?=\d)/g;
const NUMBER = '\\d+(?:\\.\\d+)?';

/** The general lens tidying: brand words, mount spacing, f/ for apertures, en dash in ranges. */
export function tidyLens(raw: string): string {
  let value = raw.replace(/\s+/g, ' ').trim();
  for (const [word, to] of BRAND_WORDS) value = value.replace(word, to);
  value = value.replace(MOUNT_PREFIX, '$1 ');
  // Apertures: "mmF2.8", " F4", "1:4.5-5.6" and "f2.8" all become "f/".
  value = value.replace(new RegExp(`mm\\s*F(${NUMBER})`, 'g'), 'mm f/$1')
    .replace(new RegExp(`\\s1:(${NUMBER})`, 'g'), ' f/$1')
    .replace(new RegExp(`\\s[Ff](${NUMBER})(?=[\\s-]|$)`, 'g'), ' f/$1')
    .replace(new RegExp(`\\bf(${NUMBER})(?=[\\s-]|$)`, 'g'), 'f/$1');
  // Ranges of focal length and aperture take an en dash.
  value = value.replace(new RegExp(`(${NUMBER})-(${NUMBER})(?=mm)`, 'g'), '$1–$2')
    .replace(new RegExp(`f\\/(${NUMBER})-(${NUMBER})`, 'g'), 'f/$1–$2');
  return value;
}

/** The friendly lens name for a raw value. */
export function friendlyLens(raw: string | undefined, rules: readonly NameRule[] = BUILTIN_RULES): string {
  const value = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return value;
  const own = whole(rules, 'lens', value);
  if (own !== null) return own;
  const tidy = rules.some((rule) => rule.on && rule.kind === 'lens' && rule.scope === 'tidy');
  return tidy ? tidyLens(value) : value;
}

/** A "Yours" rule that renames one raw value (the one-click Rename). */
export function renameRule(kind: NameKind, raw: string, to: string): NameRule {
  return { id: `yours:${kind}:${norm(raw)}`, kind, scope: 'whole', replace: raw.replace(/\s+/g, ' ').trim(), with: to.trim(), on: true, source: 'yours' };
}

/**
 * The rules in use: built-in ones (with the person's on/off choices), then the person's own. Saved settings carry only
 * the person's rules and the ids of built-in rules they turned off, so new built-in rules arrive with updates.
 */
export function rulesInUse(saved: { yours?: readonly NameRule[]; builtinOff?: readonly string[] } | null | undefined): NameRule[] {
  const off = new Set(saved?.builtinOff ?? []);
  const yours = (saved?.yours ?? []).filter((rule) => rule && typeof rule.replace === 'string' && typeof rule.with === 'string' && rule.with.trim())
    .map((rule) => ({ ...rule, scope: 'whole' as const, source: 'yours' as const }));
  return [...BUILTIN_RULES.map((rule) => (off.has(rule.id) ? { ...rule, on: false } : rule)), ...yours];
}
