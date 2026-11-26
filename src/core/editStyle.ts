/**
 * Personal editing style (x-spec-personal-style, x-workflow-style): one small learner that notices how a person treats
 * Auto's suggestions and leans future suggestions towards it. Pure and offline: the caller keeps the style on this
 * device and nothing here is ever sent anywhere.
 *
 * What it learns, per slider: how much of Auto's change the person keeps. Kept as suggested counts as 1, undone counts
 * as 0, halved counts as 0.5, pushed further counts as up to 2. Only after MIN_EXAMPLES photos for a slider does the
 * suggestion shift, and then only by the median of the recent examples (outliers beyond a robust spread are ignored),
 * pulled back towards "as suggested" while examples are few, and never beyond half or one and a half times Auto's own
 * change. Auto's quality gate still checks every leaned suggestion, so a leaning can never make a photo worse than the
 * gate allows. Reset forgets everything.
 */
import type { PhotoEdit } from './photoEdits';

/** The global sliders a leaning may scale. Masks, looks, curves and detail tools are never touched. */
export const STYLE_KEYS = [
  'exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
  'warmth', 'tint', 'colour', 'vibrance', 'texture', 'clarity', 'dehaze',
] as const;
export type StyleKey = typeof STYLE_KEYS[number];

/** Photos needed for one slider before its suggestion shifts at all. */
export const MIN_EXAMPLES = 5;
/** Only the most recent examples per slider count, so a change of taste is followed. */
export const RECENT_EXAMPLES = 30;
/** The furthest a leaning may scale Auto's change, either way. */
export const MIN_MULTIPLIER = 0.5;
export const MAX_MULTIPLIER = 1.5;
/** Leanings closer to "as suggested" than this are not applied or mentioned. */
const NOTICEABLE = 0.05;
/** Changes Auto makes smaller than this are too small to learn a proportion from. */
const MIN_CHANGE = 0.02;

export type StyleOutcome = 'kept' | 'corrected' | 'undone';

export interface StyleSample {
  key: StyleKey;
  /** How much of Auto's own (un-leaned) change the person kept, 0 to 2. */
  kept: number;
  outcome: StyleOutcome;
  at: number;
}

export interface EditStyle {
  version: 1;
  samples: StyleSample[];
}

export const EMPTY_STYLE: EditStyle = { version: 1, samples: [] };

export interface Leaning {
  key: StyleKey;
  /** Auto's change for this slider is multiplied by this. Below 1: you usually use less. Above 1: more. */
  multiplier: number;
  /** Examples that counted (outliers left out). */
  examples: number;
  /** Examples left out as outliers. */
  outliers: number;
}

const isKey = (value: unknown): value is StyleKey => typeof value === 'string' && (STYLE_KEYS as readonly string[]).includes(value);
const num = (edit: Partial<PhotoEdit>, key: StyleKey) => {
  const value = edit[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Reads a stored style defensively: anything malformed is dropped rather than trusted. */
export function parseStyle(raw: unknown): EditStyle {
  if (!raw || typeof raw !== 'object' || (raw as EditStyle).version !== 1 || !Array.isArray((raw as EditStyle).samples)) return EMPTY_STYLE;
  const samples = (raw as EditStyle).samples.filter((sample): sample is StyleSample => Boolean(sample) && isKey(sample.key)
    && typeof sample.kept === 'number' && Number.isFinite(sample.kept) && sample.kept >= 0 && sample.kept <= 2
    && (sample.outcome === 'kept' || sample.outcome === 'corrected' || sample.outcome === 'undone')
    && typeof sample.at === 'number' && Number.isFinite(sample.at));
  return { version: 1, samples: trim(samples) };
}

function trim(samples: StyleSample[]): StyleSample[] {
  const counts = new Map<StyleKey, number>();
  const kept: StyleSample[] = [];
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    const count = counts.get(sample.key) ?? 0;
    if (count >= RECENT_EXAMPLES) continue;
    counts.set(sample.key, count + 1);
    kept.push(sample);
  }
  return kept.reverse();
}

/** The learnt leaning for one slider, or null until there are enough consistent examples. */
export function leaningFor(style: EditStyle, key: StyleKey): Leaning | null {
  const values = style.samples.filter((sample) => sample.key === key).map((sample) => sample.kept);
  if (values.length < MIN_EXAMPLES) return null;
  // Outlier guard: drop examples far from the median, measured by the median absolute deviation (with a floor, so
  // a run of identical examples does not make every slightly different one an outlier).
  const centre = median(values);
  const spread = Math.max(median(values.map((value) => Math.abs(value - centre))), 0.1);
  const inliers = values.filter((value) => Math.abs(value - centre) <= 3 * spread);
  if (inliers.length < MIN_EXAMPLES) return null;
  // Pulled back towards "as suggested" while examples are few: 5 examples give half the measured leaning.
  const confidence = inliers.length / (inliers.length + MIN_EXAMPLES);
  const multiplier = clamp(1 + (median(inliers) - 1) * confidence, MIN_MULTIPLIER, MAX_MULTIPLIER);
  if (Math.abs(multiplier - 1) < NOTICEABLE) return null;
  return { key, multiplier: Math.round(multiplier * 100) / 100, examples: inliers.length, outliers: values.length - inliers.length };
}

export function learnedLeanings(style: EditStyle): Leaning[] {
  return STYLE_KEYS.map((key) => leaningFor(style, key)).filter((leaning): leaning is Leaning => leaning !== null);
}

/**
 * Auto's proposal leaned towards the person's style: each learnt slider's change from `base` is scaled. Sliders Auto
 * did not change stay as they are, and nothing else in the recipe is touched. Returns the proposal itself when no
 * leaning applies, so callers can compare by identity.
 */
export function leanProposal(base: PhotoEdit, proposal: PhotoEdit, leanings: readonly Leaning[]): { edit: PhotoEdit; applied: Leaning[] } {
  const applied: Leaning[] = [];
  let edit = proposal;
  for (const leaning of leanings) {
    const from = num(base, leaning.key);
    const change = num(proposal, leaning.key) - from;
    if (Math.abs(change) < MIN_CHANGE) continue;
    if (edit === proposal) edit = { ...proposal };
    (edit as unknown as Record<string, number>)[leaning.key] = Math.round((from + change * leaning.multiplier) * 1000) / 1000;
    applied.push(leaning);
  }
  return { edit, applied };
}

export interface AutoOutcome {
  /** The recipe before Auto. */
  base: PhotoEdit;
  /** The recipe Auto applied (possibly leaned). */
  applied: PhotoEdit;
  /** The recipe when the person moved on. */
  final: PhotoEdit;
  /** The multipliers in force when Auto applied it, so examples are measured against Auto's own change. */
  multipliers?: Partial<Record<StyleKey, number>>;
  at: number;
}

/**
 * One example per slider Auto changed: how much of Auto's own change the person kept when they moved on.
 */
export function samplesFromOutcome(outcome: AutoOutcome): StyleSample[] {
  const changed = STYLE_KEYS.filter((key) => Math.abs(num(outcome.applied, key) - num(outcome.base, key)) >= MIN_CHANGE);
  if (!changed.length) return [];
  const undone = STYLE_KEYS.every((key) => Math.abs(num(outcome.final, key) - num(outcome.base, key)) < 1e-6);
  return changed.map((key) => {
    const from = num(outcome.base, key);
    const appliedChange = num(outcome.applied, key) - from;
    const multiplier = outcome.multipliers?.[key] ?? 1;
    const kept = clamp(((num(outcome.final, key) - from) / appliedChange) * multiplier, 0, 2);
    const same = Math.abs(num(outcome.final, key) - num(outcome.applied, key)) < 1e-6;
    return { key, kept: Math.round(kept * 1000) / 1000, outcome: undone ? 'undone' : same ? 'kept' : 'corrected', at: outcome.at };
  });
}

export function recordOutcome(style: EditStyle, outcome: AutoOutcome): EditStyle {
  const samples = samplesFromOutcome(outcome);
  return samples.length ? { version: 1, samples: trim([...style.samples, ...samples]) } : style;
}

/** How many photos have taught the learner anything (distinct moments), for the plain-words summary. */
export function photosLearnedFrom(style: EditStyle): number {
  return new Set(style.samples.map((sample) => sample.at)).size;
}
