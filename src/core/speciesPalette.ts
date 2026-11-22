import { toOklab } from './colourCheck';

/**
 * Stage two of the unified Auto: a species-aware colour check.
 *
 * The subject's measured colour (taken from the colour-managed preview PIXELS, never from the screen, so display
 * calibration is irrelevant) is compared with one signature colour a species is known for, such as a robin's orange
 * breast. A cast is corrected only when the species is named with high confidence, the subject was measured on a
 * validated mask, and the light itself is not the likelier explanation. Otherwise it abstains, and says so.
 *
 * This is evidence, not authority: golden-hour light, juveniles, moult and a wrong name all change colour. The
 * correction is a small, bounded warmth change that goes through the same safety gate and strength slider as
 * every other part of Auto, and is one undoable step.
 */

export interface SpeciesGuess {
  common: string;
  /** Share among configured names (not a calibrated probability). */
  probability: number;
  /** Probability of the runner-up (0 when there is none). */
  runnerUp: number;
}

interface Signature {
  match: RegExp;
  /** What the colour is called in the sentence shown to the photographer. */
  part: string;
  /** Acceptable OKLab hue ranges in degrees. Any one of them counts as the expected colour. */
  hue: readonly [number, number];
  minChroma: number;
}

/** Warm signatures only: a warmth control can move these along the red to yellow axis and nothing else is touched. */
export const SIGNATURES: readonly Signature[] = [
  { match: /\brobin\b/i, part: 'breast', hue: [38, 62], minChroma: 0.07 },
  { match: /\bbullfinch\b/i, part: 'breast', hue: [20, 42], minChroma: 0.06 },
  { match: /\bgoldfinch\b/i, part: 'red face', hue: [22, 42], minChroma: 0.07 },
  { match: /\byellowhammer\b/i, part: 'yellow head', hue: [92, 108], minChroma: 0.09 },
  { match: /\bgreat tit\b/i, part: 'yellow breast', hue: [92, 108], minChroma: 0.08 },
];

export type SpeciesColourStatus = 'corrected' | 'consistent' | 'abstained';

export interface SpeciesColourResult {
  status: SpeciesColourStatus;
  /** Added to warmth before the safety gate. 0 unless corrected. */
  warmthDelta: number;
  species: string | null;
  /** One plain sentence, always shown, including when abstaining. */
  reason: string;
  /** Measured hue of the subject's strongest colour, degrees. Null when it could not be measured. */
  measuredHue: number | null;
}

/** Probability the top name must reach, and its lead over the runner-up, before colour may be corrected. */
export const HIGH_CONFIDENCE = { probability: 0.85, lead: 0.6 } as const;
const MAX_WARMTH = 0.4;
const MIN_OFFSET_DEG = 6;
const MAX_OFFSET_DEG = 28;
const EVIDENCE = 'This is evidence, not authority: light, age and moult all change colour.';

const abstain = (species: string | null, reason: string, measuredHue: number | null = null): SpeciesColourResult =>
  ({ status: 'abstained', warmthDelta: 0, species, reason: `${reason} ${EVIDENCE}`, measuredHue });

export interface SpeciesColourInput {
  /** 8-bit RGBA preview in sRGB. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Per-pixel subject weight 0 to 1, same size, from a trusted mask. Null when there is none. */
  subject: Float32Array | null;
  species: SpeciesGuess | null;
  /** True when Colour Check found the near-neutral parts of the frame leaning warm: the light, not the bird. */
  warmLight: boolean;
}

/** Circular mean hue (degrees) of the strongest colours inside the subject, or null if there are too few. */
export function subjectSignatureHue(pixels: Uint8ClampedArray, subject: Float32Array, pixelCount: number): { hue: number; chroma: number } | null {
  const rows: { c: number; a: number; b: number }[] = [];
  for (let i = 0; i < pixelCount; i += 1) {
    if (subject[i] < 200 / 255) continue;
    const [L, a, b] = toOklab(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
    // Clipped or very dark pixels carry no reliable hue.
    if (L < 0.25 || L > 0.92) continue;
    rows.push({ c: Math.hypot(a, b), a, b });
  }
  if (rows.length < 40) return null;
  rows.sort((x, y) => y.c - x.c);
  const top = rows.slice(0, Math.max(20, Math.floor(rows.length / 4)));
  let sa = 0, sb = 0, sc = 0;
  for (const row of top) { const m = row.c || 1; sa += row.a / m; sb += row.b / m; sc += row.c; }
  return { hue: (Math.atan2(sb, sa) * 180 / Math.PI + 360) % 360, chroma: sc / top.length };
}

export function speciesColourCheck(input: SpeciesColourInput): SpeciesColourResult {
  const { species } = input;
  if (!species) return abstain(null, 'No species name was available, so colour was not compared with an expected palette.');
  const name = species.common;
  if (species.probability < HIGH_CONFIDENCE.probability || species.probability - species.runnerUp < HIGH_CONFIDENCE.lead) {
    return abstain(name, `The species is only a possible match (${name}), so its colours were not used to correct anything.`);
  }
  const signature = SIGNATURES.find((s) => s.match.test(name));
  if (!signature) return abstain(name, `No expected colour is on file for ${name}, so colour was left to the usual checks.`);
  if (!input.subject) return abstain(name, `The ${name} could not be outlined reliably, so its colour was not measured.`);
  const measured = subjectSignatureHue(input.pixels, input.subject, input.width * input.height);
  if (!measured) return abstain(name, `Too little of the ${name} was measurable to judge its ${signature.part}.`);
  if (measured.chroma < signature.minChroma) {
    return abstain(name, `The ${signature.part} is too pale or too dark to measure its colour, so nothing was corrected.`, measured.hue);
  }
  const [lo, hi] = signature.hue;
  const offset = measured.hue > hi ? measured.hue - hi : measured.hue < lo ? measured.hue - lo : 0;
  if (offset === 0 || Math.abs(offset) < MIN_OFFSET_DEG) {
    return { status: 'consistent', warmthDelta: 0, species: name, measuredHue: measured.hue,
      reason: `The ${name}'s ${signature.part} measures close to the expected colour, so colour is left as it is. ${EVIDENCE}` };
  }
  if (Math.abs(offset) > MAX_OFFSET_DEG) {
    return abstain(name, `The ${signature.part} is far from the expected colour, which light, age or a wrong name could explain, so nothing was corrected.`, measured.hue);
  }
  if (input.warmLight) {
    return abstain(name, 'The light in this photo leans warm (golden hour, for example), which changes colour, so the species palette was not used.', measured.hue);
  }
  // Too yellow-green for the expected hue: warm up (towards red). Too red or pink: cool down.
  const warmthDelta = Math.round(Math.max(-MAX_WARMTH, Math.min(MAX_WARMTH, (offset / MAX_OFFSET_DEG) * MAX_WARMTH)) * 10) / 10;
  if (warmthDelta === 0) return abstain(name, 'The difference is within measurement error, so nothing was corrected.', measured.hue);
  return { status: 'corrected', warmthDelta, species: name, measuredHue: measured.hue,
    reason: `The ${name}'s ${signature.part} measured ${Math.abs(Math.round(offset))} degrees ${offset > 0 ? 'towards yellow' : 'towards red'} of its usual colour, so warmth moves ${warmthDelta > 0 ? 'up' : 'down'} slightly. ${EVIDENCE}` };
}
