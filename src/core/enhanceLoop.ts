import type { PhotoEdit } from './photoEdits';
import { DEFAULT_EDIT } from './photoEdits';
import { naturalAuto, renderRecipePreview } from './naturalAuto';
import type { AiReviewIssue } from './aiReview';
import { settleTrail, type ChainPolicy, type ChainTrail, type ChainVerdict } from './verificationTrail';
import { observeFrame, type FrameStats } from './enhanceObserve';
import { resolveGuidance, type Guidance, type VisionObservationInput } from './enhanceGuide';
import {
  clampKnobs, knobsToEdit, proposeKnobs, type EnhanceStyle, type Knobs, type RecipeStep, type SubjectMaskInput,
} from './enhanceRecipe';
import { critiqueRender, KNOB_FOR_ISSUE_FIX, type Critique, type Issue, type IssueId } from './enhanceCritique';

/**
 * The closed enhance loop (a preview, off by default: feature `enhanceLoop`). Per photo:
 *   observe -> guide (rules, with sources) -> propose (bounded recipe) -> render (the real preview maths) ->
 *   check (gates + on-device vision critique of the actual pixels) -> tweak -> repeat, at most MAX_ROUNDS,
 *   stopping when satisfied or when a round makes things worse -> present THREE options, favourite marked.
 * It reuses Natural Auto (seed), the photography knowledge rules, the Auto quality gates, Colour Check and the
 * verification chain. It never generates pixels, never touches the original, crop or rotation, and a photo it is
 * unsure about is kept for review, never rejected.
 */

export const MAX_ROUNDS = 5;

export interface PreviewFrame { rgba: Uint8ClampedArray; width: number; height: number }

export interface VisionCritique { issues: AiReviewIssue[]; summary: string }

/**
 * The on-device vision AI. All three methods are optional and may return null (no answer is never read as agreement).
 * `kind: 'stand-in'` marks a deterministic substitute used where the real model cannot run (tests, headless harness);
 * results produced with it must never be presented as the real model.
 */
export interface VisionAssistant {
  kind: 'on-device' | 'stand-in';
  observe?(frame: PreviewFrame): Promise<VisionObservationInput[] | null>;
  critique?(before: PreviewFrame, after: PreviewFrame, guidance: Guidance): Promise<VisionCritique | null>;
  /** Index of the candidate it likes best, or null when it has no clear favourite. */
  prefer?(before: PreviewFrame, candidates: PreviewFrame[]): Promise<number | null>;
}

export interface RoundRecord {
  round: number;
  knobs: Knobs;
  score: number;
  gate: string;
  gateSafe: boolean;
  issues: Issue[];
  clipHigh: number; clipLow: number; p50: number; spread: number; noiseSigma: number | null; castStrength: number | null;
  /** The rendered round, only when `keepRoundPixels` was asked for (contact sheets). */
  pixels?: Uint8ClampedArray;
}

export type StopReason = 'satisfied' | 'worse' | 'settled' | 'cannot-improve' | 'max-rounds' | 'nothing-to-do';
export type OptionOutcome = 'improved' | 'nothing-needed' | 'kept-for-review';

export interface OptionResult {
  style: EnhanceStyle;
  outcome: OptionOutcome;
  /** The recipe to apply (equals the base when nothing is applied). */
  edit: PhotoEdit;
  /** For kept-for-review: the best recipe found, shown only for the person to judge. */
  reviewEdit: PhotoEdit | null;
  steps: RecipeStep[];
  held: string[];
  rounds: RoundRecord[];
  bestRound: number;
  stopReason: StopReason;
  /** What is still wrong with the kept result, in plain words. */
  remaining: Issue[];
  /** Rendered preview of the kept result (or the original when nothing was applied). */
  pixels: Uint8ClampedArray;
  score: number;
}

export interface EnhanceInput {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  base?: PhotoEdit;
  iso?: number | null;
  /** Subject weights (0 to 1 per pixel) from the on-device subject model; absent = measure the in-focus area instead. */
  segmentation?: { weights: Float32Array; confidence: 'high' | 'medium' | 'low' } | null;
  framingKey?: string;
  vision?: VisionAssistant | null;
  /** The person's chosen look; resolves to the style rule. Default 'natural'. Null = none chosen. */
  style?: string | null;
  maxRounds?: number;
  /** Keep each round's rendered preview in the result (for contact sheets and tests). */
  keepRoundPixels?: boolean;
}

export interface EnhanceResult {
  stats: FrameStats;
  guidance: Guidance;
  options: OptionResult[];
  favourite: number | null;
  /** 'device-ai' only when a real on-device model chose; 'stand-in' when the substitute did; otherwise measurements. */
  favouriteBy: 'device-ai' | 'stand-in' | 'measurements' | null;
  visionKind: 'on-device' | 'stand-in' | 'none';
  visionObservations: VisionObservationInput[];
  chain: ChainTrail;
  /** Advice that is never applied automatically (crop and rotation are the person's). */
  advice: string[];
  rounds: number;
}

const LABEL_FOR_VISION: Partial<Record<AiReviewIssue, IssueId>> = {
  cast: 'castRemains', clipping: 'clippedMore', flat: 'flat', tooDark: 'tooDark', tooBright: 'tooBright', tooStrong: 'colourPushed',
};

function weightsToGrid(weights: Float32Array, width: number, height: number) {
  const long = 96;
  const w = width >= height ? long : Math.max(8, Math.round((long * width) / height));
  const h = height > width ? long : Math.max(8, Math.round((long * height) / width));
  let binary = '';
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const px = Math.min(width - 1, Math.floor(((x + 0.5) * width) / w)), py = Math.min(height - 1, Math.floor(((y + 0.5) * height) / h));
    binary += String.fromCharCode(Math.round(Math.min(1, Math.max(0, weights[py * width + px])) * 255));
  }
  return { w, h, data: btoa(binary) };
}

/** Moves the knobs in response to what the check found. Bounded; never beyond the hard limits. */
export function tweakKnobs(knobs: Knobs, issues: readonly Issue[], after: FrameStats): Knobs {
  const out: Knobs = { ...knobs };
  let scaled = false;
  for (const issue of issues) {
    const fix = KNOB_FOR_ISSUE_FIX[issue.id];
    if (fix) for (const [key, delta] of Object.entries(fix) as [keyof Knobs, number][]) {
      // Only reduce what is already in use for the "less" moves; never invent a new move from a negative nudge.
      if (delta < 0 && key !== 'highlights' && key !== 'exposure' && out[key] === 0) continue;
      out[key] += delta;
    }
    if (issue.id === 'castRemains') {
      // Measured evidence (near-neutral pixels) when there is some; otherwise only when the vision AI asked for it, a
      // smaller step sized from the whole-frame mean (a meadow is green, so grey-world alone is never trusted).
      const measured = after.cast && after.cast.strength >= 0.03 ? after.cast : null;
      const c = measured ?? (issue.source === 'vision' ? { a: after.frameMean.a, b: after.frameMean.b, strength: Math.hypot(after.frameMean.a, after.frameMean.b) * 0.6 } : null);
      if (c) {
        const amount = Math.min(measured ? 0.3 : 0.2, Math.max(0, (c.strength - 0.012) * 12));
        if (Math.abs(c.b) >= Math.abs(c.a)) out.warmth += c.b > 0 ? -amount : amount; else out.tint += c.a > 0 ? -amount * 0.7 : amount * 0.7;
      }
    }
    if ((issue.id === 'gate' || issue.id === 'cropChanged') && !scaled) {
      scaled = true;
      for (const key of Object.keys(out) as (keyof Knobs)[]) out[key] *= 0.7;
    }
  }
  return clampKnobs(out);
}

const sameKnobs = (a: Knobs, b: Knobs) => (Object.keys(a) as (keyof Knobs)[]).every((k) => a[k] === b[k]);

const LABELS: Record<EnhanceStyle, string> = { natural: 'Natural', subject: 'Subject-focused', bold: 'Bolder', light: 'Light touch' };
export const optionLabel = (s: EnhanceStyle) => LABELS[s];

export async function enhancePhoto(input: EnhanceInput): Promise<EnhanceResult> {
  const { pixels, width, height } = input;
  const base = input.base ?? DEFAULT_EDIT;
  const maxRounds = Math.min(MAX_ROUNDS, Math.max(1, input.maxRounds ?? MAX_ROUNDS));
  const vision = input.vision ?? null;
  const frame: PreviewFrame = { rgba: pixels, width, height };

  // 1. OBSERVE
  const stats = observeFrame(pixels, width, height, { segmentation: input.segmentation ?? null });
  let visionObservations: VisionObservationInput[] = [];
  if (vision?.observe) { try { visionObservations = (await vision.observe(frame)) ?? []; } catch { visionObservations = []; } }

  // 2. GUIDE
  const guidance = resolveGuidance(stats, visionObservations, input.style === undefined ? 'natural' : input.style);
  const sub = stats.subject && stats.subject.confidence !== 'low' ? stats.subject : null;
  const mask: SubjectMaskInput | null = sub ? { grid: weightsToGrid(sub.weights, width, height), confidence: sub.confidence, framingKey: input.framingKey ?? 'enhance' } : null;
  const segmentation = mask ? { grid: mask.grid, confidence: mask.confidence } : null;
  const ctx = {
    guidance, width, height, segmentation, preserveLight: guidance.protect.light, preserveDark: guidance.protect.dark,
  };

  // Natural Auto's own recipe is the seed (reuse, not a second Auto).
  let seed: Partial<Knobs> | null = null;
  try {
    const natural = naturalAuto({ pixels, width, height, segmentation, iso: input.iso ?? null, photographyObservations: guidance.rules.map((r) => { const [dimension, ...rest] = r.id.split('.'); return { dimension: dimension as 'lighting', label: rest.join('.').replaceAll('-', ' '), confidence: 1 }; }) });
    if (!natural.abstained) seed = { ...natural.edit };
  } catch { seed = null; }

  const baselineCritique = critiqueRender(stats, pixels, pixels, ctx, base, base, sub?.weights ?? null);
  const subjectOk = !!(mask && sub && (sub.confidence === 'high' || sub.confidence === 'medium') && !sub.touchesEdge);

  // 3-6. PROPOSE, RENDER, CHECK, TWEAK for each of three options.
  const styles: EnhanceStyle[] = ['natural', subjectOk ? 'subject' : 'light', 'bold'];
  const options: OptionResult[] = [];
  let totalRounds = 0;
  for (const style of styles) {
    const proposal = proposeKnobs(stats, guidance, style, subjectOk, seed);
    if (!proposal.steps.length) {
      options.push({
        style, outcome: 'nothing-needed', edit: base, reviewEdit: null, steps: [], held: proposal.held, rounds: [], bestRound: -1,
        stopReason: 'nothing-to-do', remaining: baselineCritique.issues, pixels, score: baselineCritique.score,
      });
      continue;
    }
    let knobs = proposal.knobs;
    const rounds: RoundRecord[] = [];
    let best: { round: number; knobs: Knobs; edit: PhotoEdit; px: Uint8ClampedArray; critique: Critique; score: number } | null = null;
    let stop: StopReason = 'max-rounds';
    let gateFails = 0;
    for (let round = 0; round < maxRounds; round += 1) {
      const edit = knobsToEdit(base, knobs, mask);
      const px = renderRecipePreview(pixels, width, height, edit);
      const critique = critiqueRender(stats, pixels, px, ctx, base, edit, sub?.weights ?? null);
      const issues = [...critique.issues];
      if (vision?.critique) {
        try {
          const v = await vision.critique(frame, { rgba: px, width, height }, guidance);
          for (const id of v?.issues ?? []) {
            const mapped = LABEL_FOR_VISION[id];
            if (mapped && !issues.some((i) => i.id === mapped)) issues.push({ id: mapped, words: v?.summary || id, source: 'vision' });
            if (id === 'tooWeak' && !issues.some((i) => i.id === 'flat')) issues.push({ id: 'flat', words: 'The edit looks too gentle', source: 'vision' });
          }
        } catch { /* a failed critique is "no answer", never agreement */ }
      }
      const score = critique.score - issues.filter((i) => i.source === 'vision').length * 0.05;
      totalRounds += 1;
      const a = critique.after;
      rounds.push({
        round, knobs, score, gate: critique.gate.reason, gateSafe: critique.gate.safe, issues,
        clipHigh: a.clipHigh, clipLow: a.clipLow, p50: a.p50, spread: a.spread, noiseSigma: a.noiseSigma, castStrength: a.cast?.strength ?? null,
        ...(input.keepRoundPixels ? { pixels: px } : {}),
      });
      if (!best || score > best.score + 0.003) best = { round, knobs, edit, px, critique, score };
      else if (score < best.score - 0.003) { stop = 'worse'; break; }
      else if (best.critique.gate.safe) { stop = 'settled'; break; }
      if (!critique.gate.safe) gateFails += 1; else gateFails = 0;
      if (!issues.length) { stop = 'satisfied'; break; }
      const next = tweakKnobs(knobs, gateFails >= 2 ? [...issues, { id: 'gate' as const, words: 'repeated gate failure', source: 'measured' as const }] : issues, a);
      if (sameKnobs(next, knobs)) { stop = 'cannot-improve'; break; }
      knobs = next;
    }
    const kept = best!;
    const remaining = rounds[kept.round].issues;
    const safe = kept.critique.gate.safe;
    const better = kept.score > baselineCritique.score + 0.01;
    // Uncertain or unsafe is kept for review, never auto-rejected and never applied.
    const outcome: OptionOutcome = !safe ? 'kept-for-review' : better ? 'improved' : 'nothing-needed';
    options.push({
      style, outcome, edit: outcome === 'improved' ? kept.edit : base, reviewEdit: outcome === 'kept-for-review' ? kept.edit : null,
      steps: outcome === 'nothing-needed' ? [] : proposal.steps, held: proposal.held, rounds, bestRound: kept.round, stopReason: stop,
      remaining, pixels: outcome === 'improved' ? kept.px : pixels, score: kept.score,
    });
    // Steps shown to the person describe the final recipe, not the first proposal.
    if (outcome === 'improved') options[options.length - 1].steps = stepsFor(proposal.steps, kept.knobs);
  }

  // 7. PRESENT: the vision AI's favourite among options that improve the photo.
  const candidates = options.map((o, i) => ({ o, i })).filter(({ o }) => o.outcome === 'improved');
  let favourite: number | null = null;
  let favouriteBy: EnhanceResult['favouriteBy'] = null;
  if (candidates.length) {
    let pick: number | null = null;
    if (vision?.prefer) {
      try {
        const k = await vision.prefer(frame, candidates.map(({ o }) => ({ rgba: o.pixels, width, height })));
        if (k !== null && k >= 0 && k < candidates.length) pick = candidates[k].i;
      } catch { pick = null; }
    }
    if (pick !== null) { favourite = pick; favouriteBy = vision!.kind === 'on-device' ? 'device-ai' : 'stand-in'; }
    else { favourite = candidates.reduce((a, b) => (b.o.score > a.o.score ? b : a)).i; favouriteBy = 'measurements'; }
  }

  // Verification chain: the device decides. No cloud in the per-photo loop.
  const chosen = favourite !== null ? options[favourite] : null;
  const device: ChainVerdict | undefined = !chosen ? undefined : vision?.critique ? (chosen.remaining.some((i) => i.source === 'vision') ? 'disagree' : 'agree') : undefined;
  // The per-photo loop never asks the cloud (owner policy, 28 Nov 2026): everything runs on this device, offline.
  const policy: ChainPolicy = { flag: true, cloudPermitted: false, previewOnly: true };
  const impact = chosen && chosen.steps.some((s) => Math.abs(s.amount) >= 1) ? 'high' : 'normal';
  const chain = settleTrail([{ step: 'edit', impact, device }], policy);

  const advice: string[] = [];
  if (stats.tilt && Math.abs(stats.tilt.degrees) >= 0.8 && stats.tilt.confidence >= 0.45) advice.push(`Strong straight edges lean about ${Math.abs(stats.tilt.degrees).toFixed(1)}°. Straightening changes the crop, so it is left to you.`);
  return { stats, guidance, options, favourite, favouriteBy, visionKind: vision?.kind ?? 'none', visionObservations, chain, advice, rounds: totalRounds };
}

/** The proposal's steps, re-stated with the amounts the tweaks settled on (steps that were tweaked to zero are dropped). */
function stepsFor(steps: RecipeStep[], knobs: Knobs): RecipeStep[] {
  const out: RecipeStep[] = [];
  const seen = new Set<keyof Knobs>();
  for (const s of steps) {
    seen.add(s.control);
    const amount = knobs[s.control];
    if (amount) out.push({ ...s, amount, direction: amount > 0 ? 'up' : 'down' });
  }
  for (const key of Object.keys(knobs) as (keyof Knobs)[]) {
    if (seen.has(key) || !knobs[key]) continue;
    out.push({
      control: key, scope: key.startsWith('subject') ? 'subject' : 'photo', direction: knobs[key] > 0 ? 'up' : 'down', amount: knobs[key],
      ruleId: null, sources: [], evidence: 'adjusted after checking the rendered result',
    });
  }
  return out;
}
