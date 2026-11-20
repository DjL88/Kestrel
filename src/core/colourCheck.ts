/**
 * Colour check: what the colours in a photo are, and what may be wrong with them, said in words, never shown by colour
 * alone. Built for colour-blind photographers in particular, who can't always see a cast, an over-strong red or two
 * colours that will look alike to many viewers.
 *
 * Pure and offline: it works on the editor's small preview (sRGB, 8 bits per channel) and returns codes and numbers.
 * The words come from the translation layer, so the same check reads naturally in every language.
 *
 * Colour maths uses OKLab (Björn Ottosson, 2020), where distances match how different two colours look, and colour
 * vision deficiency is simulated with the Machado, Oliveira and Fernandes (2009) matrices at full severity.
 */

export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

/** Plain colour names. "brown" is a dark orange or yellow; "grey", "black" and "white" have hardly any colour. */
export type ColourFamily =
  | 'red' | 'orange' | 'brown' | 'yellow' | 'lime' | 'green' | 'teal' | 'blue' | 'purple' | 'pink'
  | 'grey' | 'black' | 'white';
export type Lightness = 'veryDark' | 'dark' | 'mid' | 'light' | 'veryLight';
export type Strength = 'none' | 'muted' | 'moderate' | 'strong' | 'veryStrong';

export interface ColourName { family: ColourFamily; lightness: Lightness; strength: Strength }

/** One area of similar colour in the photo, largest first. `share` is of the whole picture (0 to 1). */
export interface PaletteEntry { family: ColourFamily; share: number; strength: Strength }

export type CastDirection = 'warm' | 'cool' | 'green' | 'magenta';

export type ColourFinding =
  /** Much of the picture is intensely coloured. `families` says which colours. */
  | { id: 'strongColour'; severity: 'warning' | 'tip'; share: number; families: ColourFamily[] }
  /** Strong colours have run out of range on screen and lost their detail (flat patches). */
  | { id: 'clippedColour'; severity: 'warning'; share: number; families: ColourFamily[] }
  /** Things that should be neutral (grey, white) lean towards one colour. */
  | { id: 'cast'; severity: 'tip'; direction: CastDirection; amount: 'slight' | 'clear' }
  /** Hardly any colour at all, but not black and white. Said as information, not as a fault. */
  | { id: 'muted'; severity: 'info' }
  /** Two large areas differ mainly by red against green, so they look alike to many colour-blind viewers. */
  | { id: 'redGreenAlike'; severity: 'tip'; families: [ColourFamily, ColourFamily] }
  /** How the edit changed colour strength overall (only with a before picture). `change` is a ratio minus 1. */
  | { id: 'editChange'; severity: 'info'; change: number }
  /** The main subject's colour compared with its surroundings (only with a subject outline). */
  | { id: 'subjectColour'; severity: 'info'; subject: ColourFamily; subjectStrength: Strength; surroundings: ColourFamily };

export interface ColourReport {
  /** The main colours, largest first, at most five, each at least 3% of the picture. */
  palette: PaletteEntry[];
  findings: ColourFinding[];
  /** True when the picture has almost no colour (black and white, or nearly). */
  monochrome: boolean;
}

export interface ColourCheckInput {
  after: Pixels;
  /** The picture before editing, to say what the edit did. */
  before?: Pixels;
  /** The main subject, 0–1 per pixel, at the same size as `after`. */
  subject?: Float32Array;
  /** True when the person chose black and white: then a lack of colour is intended, not a fault. */
  blackAndWhite?: boolean;
}

// ---- Colour maths ----------------------------------------------------------------------------------------------

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB 0–255 to OKLab: L 0–1, a and b about −0.4 to 0.4. */
export function toOklab(r8: number, g8: number, b8: number): [number, number, number] {
  return linearToOklab(LINEAR[r8 | 0], LINEAR[g8 | 0], LINEAR[b8 | 0]);
}

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Hue in degrees (0–360) and chroma from OKLab a and b. */
const hueOf = (a: number, b: number) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const chromaOf = (a: number, b: number) => Math.hypot(a, b);

// Chroma bands in OKLab, chosen so everyday photos read as people would describe them.
const GREY_BELOW = 0.025;
const MUTED_BELOW = 0.06;
const MODERATE_BELOW = 0.12;
const STRONG_BELOW = 0.2;

export function strengthOf(chroma: number): Strength {
  if (chroma < GREY_BELOW) return 'none';
  if (chroma < MUTED_BELOW) return 'muted';
  if (chroma < MODERATE_BELOW) return 'moderate';
  if (chroma < STRONG_BELOW) return 'strong';
  return 'veryStrong';
}

function lightnessOf(L: number): Lightness {
  if (L < 0.3) return 'veryDark';
  if (L < 0.5) return 'dark';
  if (L < 0.7) return 'mid';
  if (L < 0.87) return 'light';
  return 'veryLight';
}

/** The colour family for an OKLab colour. Hue boundaries are in OKLCH degrees. */
export function familyOf(L: number, a: number, b: number): ColourFamily {
  const chroma = chromaOf(a, b);
  if (chroma < GREY_BELOW) return L < 0.25 ? 'black' : L > 0.93 ? 'white' : 'grey';
  const hue = hueOf(a, b);
  if (hue < 15 || hue >= 350) return 'pink';
  if (hue < 40) return 'red';
  if (hue < 75) return L < 0.6 ? 'brown' : 'orange';
  if (hue < 105) return L < 0.55 ? 'brown' : 'yellow';
  if (hue < 125) return 'lime';
  if (hue < 165) return 'green';
  if (hue < 215) return 'teal';
  if (hue < 285) return 'blue';
  if (hue < 325) return 'purple';
  return 'pink';
}

/** Name one colour in words, e.g. a pointer readout: "dark, muted brown". */
export function nameColour(r: number, g: number, b: number): ColourName {
  const [L, A, B] = toOklab(r, g, b);
  return { family: familyOf(L, A, B), lightness: lightnessOf(L), strength: strengthOf(chromaOf(A, B)) };
}

// Machado et al. 2009, severity 1.0, applied to linear RGB.
const PROTAN = [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998];
const DEUTAN = [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881];
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** OKLab of a linear RGB colour as seen with protanopia or deuteranopia. */
function simulated(matrix: number[], r: number, g: number, b: number): [number, number, number] {
  return linearToOklab(
    clamp01(matrix[0] * r + matrix[1] * g + matrix[2] * b),
    clamp01(matrix[3] * r + matrix[4] * g + matrix[5] * b),
    clamp01(matrix[6] * r + matrix[7] * g + matrix[8] * b),
  );
}

const distance = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// ---- The check -------------------------------------------------------------------------------------------------

interface Bucket { family: ColourFamily; count: number; L: number; a: number; b: number; r: number; g: number; bl: number }

/** Mean colour strength (OKLab chroma) of a picture, ignoring near-black pixels where colour means little. */
function meanChroma(pixels: Pixels): number {
  let total = 0;
  let counted = 0;
  const { data } = pixels;
  for (let i = 0; i < data.length; i += 4) {
    const [L, A, B] = toOklab(data[i], data[i + 1], data[i + 2]);
    if (L < 0.15) continue;
    total += chromaOf(A, B);
    counted += 1;
  }
  return counted ? total / counted : 0;
}

export function checkColour({ after, before, subject, blackAndWhite = false }: ColourCheckInput): ColourReport {
  const { data } = after;
  const pixelCount = Math.floor(data.length / 4);
  if (pixelCount === 0) return { palette: [], findings: [], monochrome: false };
  const buckets = new Map<ColourFamily, Bucket>();
  let veryStrong = 0;
  let strongCounted = 0;
  const strongFamilies = new Map<ColourFamily, number>();
  let clipped = 0;
  const clippedFamilies = new Map<ColourFamily, number>();
  let neutralCount = 0;
  let neutralA = 0;
  let neutralB = 0;
  let coloured = 0;
  const subjectTotals = { weight: 0, a: 0, b: 0, L: 0 };
  const surroundTotals = { weight: 0, a: 0, b: 0, L: 0 };

  for (let p = 0; p < pixelCount; p += 1) {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    const [L, A, B] = toOklab(r, g, b);
    const chroma = chromaOf(A, B);
    const family = familyOf(L, A, B);
    let bucket = buckets.get(family);
    if (!bucket) { bucket = { family, count: 0, L: 0, a: 0, b: 0, r: 0, g: 0, bl: 0 }; buckets.set(family, bucket); }
    bucket.count += 1;
    bucket.L += L; bucket.a += A; bucket.b += B;
    bucket.r += LINEAR[r]; bucket.g += LINEAR[g]; bucket.bl += LINEAR[b];

    if (L >= 0.15) {
      strongCounted += 1;
      if (chroma >= STRONG_BELOW) {
        veryStrong += 1;
        strongFamilies.set(family, (strongFamilies.get(family) ?? 0) + 1);
      }
    }
    if (chroma >= GREY_BELOW) coloured += 1;
    // Out of range on screen: one channel at its limit while the colour is strong. Such patches lose their detail.
    const atLimit = r === 255 || g === 255 || b === 255 || r === 0 || g === 0 || b === 0;
    if (atLimit && chroma >= MODERATE_BELOW && Math.max(r, g, b) - Math.min(r, g, b) > 120) {
      clipped += 1;
      clippedFamilies.set(family, (clippedFamilies.get(family) ?? 0) + 1);
    }
    // Near-neutral, mid-tone pixels show a cast best (grey world on things that are probably grey).
    if (chroma < 0.05 && L > 0.25 && L < 0.92) {
      neutralCount += 1;
      neutralA += A;
      neutralB += B;
    }
    if (subject) {
      const weight = Math.min(1, Math.max(0, subject[p] ?? 0));
      subjectTotals.weight += weight; subjectTotals.a += A * weight; subjectTotals.b += B * weight; subjectTotals.L += L * weight;
      surroundTotals.weight += 1 - weight; surroundTotals.a += A * (1 - weight); surroundTotals.b += B * (1 - weight); surroundTotals.L += L * (1 - weight);
    }
  }

  const monochrome = coloured / pixelCount < 0.02;
  const ranked = [...buckets.values()].sort((x, y) => y.count - x.count);
  const palette: PaletteEntry[] = ranked
    .filter((bucket) => bucket.count / pixelCount >= 0.03)
    .slice(0, 5)
    .map((bucket) => ({
      family: bucket.family,
      share: bucket.count / pixelCount,
      strength: strengthOf(chromaOf(bucket.a / bucket.count, bucket.b / bucket.count)),
    }));

  const findings: ColourFinding[] = [];
  const topFamilies = (counts: Map<ColourFamily, number>) => [...counts.entries()]
    .sort((x, y) => y[1] - x[1]).filter(([, count], index) => index === 0 || count > 0.25 * [...counts.values()].reduce((s, v) => Math.max(s, v), 0))
    .slice(0, 2).map(([family]) => family);

  const clippedShare = clipped / pixelCount;
  if (clippedShare >= 0.01) findings.push({ id: 'clippedColour', severity: 'warning', share: clippedShare, families: topFamilies(clippedFamilies) });

  const strongShare = strongCounted ? veryStrong / strongCounted : 0;
  if (strongShare >= 0.08) {
    findings.push({ id: 'strongColour', severity: strongShare >= 0.25 ? 'warning' : 'tip', share: strongShare, families: topFamilies(strongFamilies) });
  }

  if (!monochrome && neutralCount / pixelCount >= 0.05) {
    const a = neutralA / neutralCount;
    const b = neutralB / neutralCount;
    const size = Math.hypot(a, b);
    if (size >= 0.008) {
      const hue = hueOf(a, b);
      // Warm covers orange-yellow, cool covers blue-cyan; the green–magenta axis is the camera's tint.
      const direction: CastDirection = hue >= 30 && hue < 120 ? 'warm' : hue >= 120 && hue < 180 ? 'green' : hue >= 180 && hue < 300 ? 'cool' : 'magenta';
      findings.push({ id: 'cast', severity: 'tip', direction, amount: size >= 0.018 ? 'clear' : 'slight' });
    }
  }

  if (!blackAndWhite && monochrome) findings.push({ id: 'muted', severity: 'info' });

  // Red–green look-alikes: two large colour areas that differ clearly in normal vision, but hardly at all with
  // protanopia or deuteranopia, and with similar lightness (lightness is the cue most colour-blind viewers keep).
  const large = ranked.filter((bucket) => bucket.count / pixelCount >= 0.05 && !['grey', 'black', 'white'].includes(bucket.family));
  search: for (let i = 0; i < large.length; i += 1) {
    for (let j = i + 1; j < large.length; j += 1) {
      const x = large[i];
      const y = large[j];
      const lab = (bucket: Bucket) => [bucket.L / bucket.count, bucket.a / bucket.count, bucket.b / bucket.count];
      const lin = (bucket: Bucket) => [bucket.r / bucket.count, bucket.g / bucket.count, bucket.bl / bucket.count] as const;
      if (distance(lab(x), lab(y)) < 0.1 || Math.abs(lab(x)[0] - lab(y)[0]) > 0.08) continue;
      // Muted green next to brown is in nearly every nature photo; only say so when one of them is vivid (a red berry,
      // a robin's breast), where it changes what many viewers can see.
      if (Math.max(chromaOf(lab(x)[1], lab(x)[2]), chromaOf(lab(y)[1], lab(y)[2])) < 0.1) continue;
      const seen = (matrix: number[]) => distance(simulated(matrix, ...lin(x)), simulated(matrix, ...lin(y)));
      if (Math.min(seen(PROTAN), seen(DEUTAN)) < 0.045) {
        findings.push({ id: 'redGreenAlike', severity: 'tip', families: [x.family, y.family] });
        break search;
      }
    }
  }

  if (subject && subjectTotals.weight >= pixelCount * 0.02 && surroundTotals.weight >= pixelCount * 0.05) {
    const s = subjectTotals;
    const o = surroundTotals;
    findings.push({
      id: 'subjectColour', severity: 'info',
      subject: familyOf(s.L / s.weight, s.a / s.weight, s.b / s.weight),
      subjectStrength: strengthOf(chromaOf(s.a / s.weight, s.b / s.weight)),
      surroundings: familyOf(o.L / o.weight, o.a / o.weight, o.b / o.weight),
    });
  }

  if (before) {
    const was = meanChroma(before);
    const now = meanChroma(after);
    if (was > 0.005) {
      const change = now / was - 1;
      if (Math.abs(change) >= 0.1) findings.push({ id: 'editChange', severity: 'info', change });
    }
  }

  const rank = { warning: 0, tip: 1, info: 2 } as const;
  findings.sort((x, y) => rank[x.severity] - rank[y.severity]);
  return { palette, findings, monochrome };
}

/**
 * Where colour is very strong, 0 or 1 per pixel, for a patterned overlay (stripes, never a colour) that shows the
 * areas a colour-blind photographer can't judge by eye.
 */
export function strongColourMap(pixels: Pixels, threshold = STRONG_BELOW): Uint8Array {
  const out = new Uint8Array(pixels.data.length / 4);
  for (let p = 0; p < out.length; p += 1) {
    const [, A, B] = toOklab(pixels.data[p * 4], pixels.data[p * 4 + 1], pixels.data[p * 4 + 2]);
    out[p] = chromaOf(A, B) >= threshold ? 1 : 0;
  }
  return out;
}
