import type { PhotoEdit } from './photoEdits';
import { checkColour } from './colourCheck';
import {
  sameRecipe, scaleRecipe, stageNaturalRecipe, subjectWeights,
  type NaturalAutoInput, type NaturalAutoResult, type SceneReport, type StagedOutcome,
} from './naturalAuto';
import { speciesColourCheck, type SpeciesColourResult, type SpeciesGuess } from './speciesPalette';

/**
 * The one Auto flow. A single button measures the photo, builds ONE reversible recipe (the Natural Auto sliders, the
 * subject mask edit and, when it is safe, a species-aware colour correction), checks it against the quality gate and
 * applies it. A strength slider then scales that whole recipe from 0 to 100%.
 *
 * Honesty rules, enforced here and tested:
 *  - "Looks good" is only ever said when the measured values are inside their stated ranges.
 *  - A dark photo gets a real exposure lift, or the plain statement that no safe improvement was found.
 *  - Species colour only corrects at high confidence; otherwise it abstains and says why.
 */

/** Ranges the verdict is judged against. Perceptual lightness, 0 black to 1 white. Shown to the photographer. */
export const RANGES = { subjectMedian: [0.3, 0.85], highlightP98: [0, 0.975], frameMedianMin: 0.16 } as const;

export interface Measured {
  /** Median lightness of the subject (or the in-focus detail, or the frame), 0 to 1. */
  subjectMedian: number;
  /** Brightest 2% of that region, 0 to 1. */
  highlightP98: number;
  reference: SceneReport['reference'];
  lowKey: boolean;
  /** Colour Check warnings (clipped or over-strong colour) found in the result. */
  colourWarnings: string[];
}

export type AutoVerdict =
  | { kind: 'improved'; outcome: Extract<StagedOutcome, 'full' | 'gentler'> }
  | { kind: 'looks-good' }
  | { kind: 'cannot-improve-safely'; reason: string };

export interface AutoPlan {
  /** The look Auto started from. Undo restores exactly this. */
  base: PhotoEdit;
  /** The full-strength recipe that passed the gate (equals base when nothing was changed). */
  proposal: PhotoEdit;
  verdict: AutoVerdict;
  measured: Measured;
  species: SpeciesColourResult;
  /** Plain sentences describing what was measured and done, in the order they are shown. */
  notes: string[];
}

const LOW_KEY = 'low-key';
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const EV_PER_UNIT = 0.4;

/** Is the measurement inside the ranges a finished photo should be in? Low-key scenes keep their dark mood. */
export function inRange(m: Measured): boolean {
  if (m.colourWarnings.length) return false;
  if (m.highlightP98 > RANGES.highlightP98[1]) return false;
  if (m.lowKey) return true;
  return m.subjectMedian >= RANGES.subjectMedian[0] && m.subjectMedian <= RANGES.subjectMedian[1];
}

export function measure(scene: SceneReport, colourWarnings: string[]): Measured {
  return {
    subjectMedian: scene.referenceMedian, highlightP98: scene.referenceP98, reference: scene.reference,
    lowKey: scene.kind === LOW_KEY, colourWarnings,
  };
}

function colourWarningsOf(pixels: Uint8ClampedArray, width: number, height: number): { warnings: string[]; warmLight: boolean } {
  const report = checkColour({ after: { data: pixels, width, height } });
  const warnings = report.findings.filter((f) => f.severity === 'warning').map((f) => f.id);
  const warmLight = report.findings.some((f) => f.id === 'cast' && f.direction === 'warm');
  return { warnings, warmLight };
}

/** Extra exposure (slider units) for a dark photo that the natural rules left almost untouched. Bounded by highlight headroom. */
export function darkLift(m: Measured, alreadyUnits: number): number {
  if (m.lowKey || m.subjectMedian <= 0 || m.subjectMedian >= RANGES.subjectMedian[0]) return alreadyUnits;
  const wanted = toLinear(0.4) / Math.max(toLinear(m.subjectMedian), 1e-4);
  const headroom = m.highlightP98 > 0 ? toLinear(0.96) / Math.max(toLinear(m.highlightP98), 1e-4) : wanted;
  const gain = Math.min(wanted, Math.max(1, headroom));
  const units = Math.min(1.5, Math.round((Math.log2(gain) / EV_PER_UNIT) * 10) / 10);
  return Math.max(alreadyUnits, units);
}

export interface PlanInput {
  /** Unedited, framed, colour-managed 8-bit RGBA preview. These pixels, not the screen, are what is measured. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** The look the photographer has now. */
  base: PhotoEdit;
  /** `mergeAutoSuggestion` of the natural sliders, plus the subject-mask edit, as built by the editor. */
  proposal: PhotoEdit;
  natural: NaturalAutoResult;
  segmentation?: NaturalAutoInput['segmentation'];
  species?: SpeciesGuess | null;
}

/** Build, check and judge the one recipe. Pure: nothing is applied here. */
export function planAuto(input: PlanInput): AutoPlan {
  const { pixels, width, height, base, natural, segmentation } = input;
  const notes: string[] = [];
  const { warnings, warmLight } = colourWarningsOf(pixels, width, height);
  let measured = measure(natural.scene, warnings);

  const weights = segmentation && segmentation.confidence !== 'low' ? subjectWeights(segmentation.grid, width, height) : null;
  const species = speciesColourCheck({
    pixels, width, height, subject: segmentation?.confidence === 'high' ? weights : null,
    species: input.species ?? null, warmLight,
  });

  let proposal: PhotoEdit = { ...input.proposal };
  // A dark photo must get a real lift, not a token one. The gate below still decides whether it is safe.
  const wasUnits = Number(proposal.exposure ?? 0) - Number(base.exposure ?? 0);
  const lifted = darkLift(measured, wasUnits);
  if (lifted > wasUnits) {
    proposal.exposure = Math.round((Number(base.exposure ?? 0) + lifted) * 10) / 10;
    notes.push('The subject is dark, so exposure goes up.');
  }
  const withSpecies: PhotoEdit = species.status === 'corrected'
    ? { ...proposal, warmth: Math.round((Number(proposal.warmth ?? 0) + species.warmthDelta) * 10) / 10 } : proposal;

  let staged = stageNaturalRecipe(pixels, width, height, base, withSpecies, segmentation);
  let speciesKept = species.status === 'corrected' && (staged.outcome === 'full' || staged.outcome === 'gentler');
  if (species.status === 'corrected' && !speciesKept) {
    // The colour correction may be what the gate refused: try again without it rather than lose everything else.
    staged = stageNaturalRecipe(pixels, width, height, base, proposal, segmentation);
  }
  const changed = (staged.outcome === 'full' || staged.outcome === 'gentler') && !sameRecipe(base, staged.edit);
  if (!changed) speciesKept = false;

  let verdict: AutoVerdict;
  if (changed) {
    verdict = { kind: 'improved', outcome: staged.outcome as 'full' | 'gentler' };
  } else if (inRange(measured)) {
    verdict = { kind: 'looks-good' };
  } else {
    const dark = !measured.lowKey && measured.subjectMedian < RANGES.subjectMedian[0];
    const reason = staged.outcome === 'declined' ? staged.reason
      : dark ? 'No safe exposure lift was found: lifting it would clip highlights or show noise'
      : measured.colourWarnings.length ? 'Colour is strong or clipped, and softening it was not safe'
      : 'The measured values are outside their ranges, but no change passed the safety checks';
    verdict = { kind: 'cannot-improve-safely', reason };
  }

  return { base, proposal: changed ? staged.edit : base, verdict, measured, species: species.status !== 'corrected' || speciesKept ? species : {
    ...species, status: 'abstained', warmthDelta: 0, reason: 'A species colour correction was tried but did not pass the safety checks, so it was left out. This is evidence, not authority.',
  }, notes };
}

/** The recipe at a chosen strength (0 to 1). 0 is exactly the starting look; 1 is the checked recipe. */
export function recipeAtStrength(plan: Pick<AutoPlan, 'base' | 'proposal'>, strength: number): PhotoEdit {
  const s = Math.min(1, Math.max(0, strength));
  if (s >= 1) return plan.proposal;
  if (s <= 0) return plan.base;
  return scaleRecipe(plan.base, plan.proposal, s);
}

/** Headline and detail for the result, in British English. The numbers are the measured ones. */
export function describePlan(plan: AutoPlan): { headline: string; detail: string[] } {
  const m = plan.measured;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const lightness = `Subject lightness ${pct(m.subjectMedian)} (target ${pct(RANGES.subjectMedian[0])} to ${pct(RANGES.subjectMedian[1])}); brightest detail ${pct(m.highlightP98)} (limit ${pct(RANGES.highlightP98[1])}).`;
  const detail = [lightness, plan.species.reason];
  switch (plan.verdict.kind) {
    case 'improved':
      return { headline: plan.verdict.outcome === 'gentler' ? 'Auto applied a gentler version: the full one failed a safety check.' : 'Auto applied. Drag the strength to taste, or undo it.', detail };
    case 'looks-good':
      return { headline: 'Looks good: the measured values are in range, so nothing was changed.', detail };
    case 'cannot-improve-safely':
      return { headline: `Cannot improve this safely: ${plan.verdict.reason.toLowerCase()}.`, detail };
  }
}
