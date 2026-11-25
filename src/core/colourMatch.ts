import { familyOf, toOklab, type ColourFamily, type Pixels } from './colourCheck';
import { HIGH_CONFIDENCE, SIGNATURES, type SpeciesGuess } from './speciesPalette';

/**
 * Colour match: do the colours measured on the subject match what this subject should look like?
 *
 * The expected colours come from outside the pixels: today from the species signatures on file (a robin's orange
 * breast), and from the vision model (the guardian) when it names a subject and its colours. They arrive in one shape,
 * `SubjectExpectation`, so either source can be checked the same way. The measured side is the subject's own colour mix,
 * weighted by its mask, from the colour-managed preview pixels (never the screen).
 *
 * Honest limits: the mask covers the whole subject, so this can say a colour is on the subject, not on which part of
 * it. A difference is evidence, not proof: light, age, moult and a wrong name all change colour. Nothing is corrected
 * here; the guardian decides what to do with the verdict.
 */

export type BodyPart = 'breast' | 'face' | 'head' | 'back' | 'belly' | 'wings' | 'tail' | 'beak' | 'body';

export interface ExpectedColour {
  part: BodyPart;
  /** Any one of these colour names counts as the expected colour. */
  colours: ColourFamily[];
}

export interface SubjectExpectation {
  /** The subject's name as the photographer sees it, e.g. "robin". */
  subject: string;
  parts: ExpectedColour[];
  /** Where the expectation came from: the species signatures on file, or the vision model. */
  source: 'speciesSignature' | 'vision';
}

export type ColourMatchVerdict = 'matches' | 'differs';

export interface PartMatch { part: BodyPart; expected: ColourFamily[]; verdict: ColourMatchVerdict }

export interface ColourMatchResult {
  subject: string;
  source: SubjectExpectation['source'];
  /** 'differs' when any expected colour is missing from the subject. */
  verdict: ColourMatchVerdict;
  parts: PartMatch[];
  /** The subject's main colours, largest first (at least 8% of the subject each), to say what was found instead. */
  measured: { family: ColourFamily; share: number }[];
}

/** An expected colour counts as present when it covers at least this share of the subject. */
export const MATCH_MIN_SHARE = 0.08;
/** Below this share of the picture the subject is too small to judge. */
const MIN_SUBJECT_SHARE = 0.005;

/**
 * Colours that people name differently for the same thing in different light. familyOf calls a dark orange "brown"
 * and a light red "pink", so a robin's breast in shade must still count as orange.
 */
const NEIGHBOURS: Partial<Record<ColourFamily, ColourFamily[]>> = {
  orange: ['brown', 'red'], brown: ['orange'], red: ['pink', 'orange'], pink: ['red'], yellow: ['lime', 'orange'],
  lime: ['yellow', 'green'], green: ['lime', 'teal'], teal: ['green', 'blue'], blue: ['teal', 'purple'], purple: ['blue', 'pink'],
  grey: ['white', 'black'], white: ['grey'], black: ['grey'],
};

/** The subject's colour mix, weighted by the mask. Null when the subject is too small to judge. */
export function subjectPalette(pixels: Pixels, subject: Float32Array): { family: ColourFamily; share: number }[] | null {
  const count = pixels.width * pixels.height;
  if (!Number.isSafeInteger(count) || count <= 0 || pixels.data.length !== count * 4 || subject.length !== count) return null;
  const weights = new Map<ColourFamily, number>();
  let total = 0;
  for (let p = 0; p < count; p += 1) {
    const raw = subject[p];
    const weight = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    if (weight === 0) continue;
    const [L, a, b] = toOklab(pixels.data[p * 4], pixels.data[p * 4 + 1], pixels.data[p * 4 + 2]);
    const family = familyOf(L, a, b);
    weights.set(family, (weights.get(family) ?? 0) + weight);
    total += weight;
  }
  if (total < MIN_SUBJECT_SHARE * count) return null;
  return [...weights.entries()].map(([family, weight]) => ({ family, share: weight / total })).sort((x, y) => y.share - x.share);
}

export function matchSubjectColours(expectation: SubjectExpectation, pixels: Pixels, subject: Float32Array): ColourMatchResult | null {
  if (!expectation.parts.length) return null;
  const palette = subjectPalette(pixels, subject);
  if (!palette) return null;
  const present = new Set(palette.filter((entry) => entry.share >= MATCH_MIN_SHARE).map((entry) => entry.family));
  const parts = expectation.parts.map((part): PartMatch => {
    const accepted = new Set(part.colours.flatMap((colour) => [colour, ...(NEIGHBOURS[colour] ?? [])]));
    return { part: part.part, expected: part.colours, verdict: [...accepted].some((colour) => present.has(colour)) ? 'matches' : 'differs' };
  });
  return {
    subject: expectation.subject,
    source: expectation.source,
    verdict: parts.every((part) => part.verdict === 'matches') ? 'matches' : 'differs',
    parts,
    measured: palette.filter((entry) => entry.share >= MATCH_MIN_SHARE),
  };
}

const PART_OF: [RegExp, BodyPart][] = [[/face/i, 'face'], [/head/i, 'head'], [/breast/i, 'breast']];

/**
 * The colour names a signature's hue range covers, at the lightness and strength a real feather can have, most common
 * first, so the first name is what the colour is mostly called.
 */
export function coloursForHueRange([lo, hi]: readonly [number, number], minChroma: number): ColourFamily[] {
  const counts = new Map<ColourFamily, number>();
  for (let hue = lo; hue <= hi; hue += 2) {
    for (const L of [0.5, 0.65, 0.8]) {
      // The faint end of a range is still accepted, but the name comes mainly from the colour at full strength:
      // a robin's breast is called orange, even though a faint one reads as brown.
      for (const [chroma, weight] of [[minChroma, 1], [minChroma + 0.05, 3]] as const) {
        const radians = hue * Math.PI / 180;
        const family = familyOf(L, chroma * Math.cos(radians), chroma * Math.sin(radians));
        counts.set(family, (counts.get(family) ?? 0) + weight);
      }
    }
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([family]) => family);
}

/**
 * The species signatures on file as an expectation, only for a confidently named species (the same bar that lets
 * the species colour check correct anything). The vision model's expectation replaces this when it is available.
 */
export function expectationForSpecies(species: SpeciesGuess | null): SubjectExpectation | null {
  if (!species || !Number.isFinite(species.probability) || !Number.isFinite(species.runnerUp)
    || species.probability < HIGH_CONFIDENCE.probability || species.probability - species.runnerUp < HIGH_CONFIDENCE.lead) return null;
  const signature = SIGNATURES.find((entry) => entry.match.test(species.common));
  if (!signature) return null;
  const part = PART_OF.find(([pattern]) => pattern.test(signature.part))?.[1] ?? 'body';
  return { subject: species.common, source: 'speciesSignature', parts: [{ part, colours: coloursForHueRange(signature.hue, signature.minChroma) }] };
}
