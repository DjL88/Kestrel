import type { PhotoEdit } from './photoEdits';
import { DEFAULT_EDIT } from './photoEdits';
import { createSubjectMask, type SubjectGrid } from './maskTypes';
import { attributeStep, type Direction, type Guidance, type StepControl } from './enhanceGuide';
import type { FrameStats } from './enhanceObserve';

/**
 * Enhance loop, steps 3 and 6: PROPOSE and TWEAK. A recipe is a small set of "knobs" (the editor's own sliders, whole
 * photo or subject mask) that are hard-bounded here. Starting values come from measurements through the guiding rules;
 * a label never sets a value. Nothing generates pixels, fills, clones or upscales, and crop, rotation and the original
 * are never touched (tilt is reported as advice only).
 */

export type EnhanceStyle = 'natural' | 'subject' | 'bold' | 'light';

export interface Knobs {
  exposure: number; warmth: number; tint: number; shadows: number; highlights: number; contrast: number; vibrance: number;
  denoise: number; denoiseLuminance: number; texture: number; clarity: number; sharpen: number;
  /** Subject mask: exposure lift and detail, only when a subject was found with enough confidence. */
  subjectExposure: number; subjectSharpen: number; subjectTexture: number;
}

export const NEUTRAL_KNOBS: Knobs = {
  exposure: 0, warmth: 0, tint: 0, shadows: 0, highlights: 0, contrast: 0, vibrance: 0, denoise: 0, denoiseLuminance: 0,
  texture: 0, clarity: 0, sharpen: 0, subjectExposure: 0, subjectSharpen: 0, subjectTexture: 0,
};

/** Hard limits. A tweak or a style can never go beyond these. */
export const KNOB_LIMITS: Readonly<Record<keyof Knobs, readonly [number, number]>> = {
  exposure: [-2.5, 2.5], warmth: [-1, 1], tint: [-0.6, 0.6], shadows: [0, 1.4], highlights: [-1.6, 0], contrast: [-0.6, 0.8],
  vibrance: [-0.2, 0.7], denoise: [0, 2], denoiseLuminance: [0, 1.5], texture: [-0.6, 0.6], clarity: [-0.4, 0.5], sharpen: [0, 0.8],
  subjectExposure: [0, 2.5], subjectSharpen: [0, 0.8], subjectTexture: [0, 0.5],
};

export const clampKnobs = (k: Knobs): Knobs => {
  const out = { ...k };
  for (const key of Object.keys(KNOB_LIMITS) as (keyof Knobs)[]) {
    const [lo, hi] = KNOB_LIMITS[key];
    out[key] = Math.round(Math.min(hi, Math.max(lo, Number.isFinite(out[key]) ? out[key] : 0)) * 20) / 20;
  }
  return out;
};

export interface RecipeStep {
  control: keyof Knobs;
  scope: 'photo' | 'subject';
  direction: Direction;
  /** Slider units, as stored in the recipe. */
  amount: number;
  /** The rule that justified this step and its checked sources, or null for house practice (stated as such). */
  ruleId: string | null;
  sources: string[];
  /** What was measured, in words. Built from the actual measurement, not from a label. */
  evidence: string;
}

const photoControls: readonly StepControl[] = ['exposure', 'warmth', 'tint', 'shadows', 'highlights', 'contrast', 'vibrance', 'denoise', 'denoiseLuminance', 'texture', 'clarity', 'sharpen'];

export interface SubjectMaskInput {
  grid: SubjectGrid;
  confidence: 'high' | 'medium' | 'low';
  framingKey: string;
}

/** Knobs to a normal editor recipe on top of `base`. Crop, rotation and everything else in `base` stay as they were. */
export function knobsToEdit(base: PhotoEdit, k: Knobs, mask: SubjectMaskInput | null): PhotoEdit {
  const edit: PhotoEdit = { ...base };
  const set = (key: keyof PhotoEdit, value: number) => { if (value !== 0) (edit as unknown as Record<string, number>)[key] = (base[key] as number | undefined ?? 0) + value; };
  set('exposure', k.exposure); set('warmth', k.warmth); set('tint', k.tint); set('shadows', k.shadows); set('highlights', k.highlights);
  set('contrast', k.contrast); set('vibrance', k.vibrance); set('denoise', k.denoise); set('denoiseLuminance', k.denoiseLuminance);
  set('texture', k.texture); set('clarity', k.clarity); set('sharpen', k.sharpen);
  if (mask && (k.subjectExposure || k.subjectSharpen || k.subjectTexture)) {
    const m = createSubjectMask('enhance-subject', mask.grid, mask.framingKey, mask.confidence);
    m.feather = 0.6;
    const local: Record<string, number> = {};
    if (k.subjectExposure) local.exposure = k.subjectExposure;
    if (k.subjectSharpen) local.sharpen = k.subjectSharpen;
    if (k.subjectTexture) local.texture = k.subjectTexture;
    m.edit = local;
    edit.masks = [...(base.masks ?? []), m];
  }
  return edit;
}

const EV_PER_UNIT = 0.4;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unitsFor = (from: number, to: number) => Math.log2(lin(to) / Math.max(lin(from), 1e-4)) / EV_PER_UNIT;

export interface Proposal {
  style: EnhanceStyle;
  knobs: Knobs;
  steps: RecipeStep[];
  /** Plain reasons nothing (or less) was proposed: protected light, uncertain measurement, already fine. */
  held: string[];
}

const STYLE_MULT: Record<EnhanceStyle, number> = { natural: 1, subject: 0.7, bold: 1.4, light: 0.5 };

/**
 * Starting recipe for one option, from the measurements and the rules that applied. `subjectOk` says a subject mask
 * with enough confidence exists. Every step is attributed through `attributeStep`; a step no rule asks for is house
 * practice and says so.
 */
export function proposeKnobs(stats: FrameStats, guidance: Guidance, style: EnhanceStyle, subjectOk: boolean, seed?: Partial<Knobs> | null): Proposal {
  const m = STYLE_MULT[style];
  const k: Knobs = { ...NEUTRAL_KNOBS };
  const held: string[] = [];
  const has = (id: string) => guidance.rules.some((r) => r.id === id);
  const sub = stats.subject && stats.subject.confidence !== 'low' ? stats.subject : null;
  const ref = sub ? sub.median : stats.p50;
  const refName = sub ? 'subject' : 'frame';
  const lowKeyScene = guidance.protect.dark || has('lighting.low-key');
  const noisy = stats.noiseSigma !== null && stats.noiseSigma >= 4.5;
  const evidence: Partial<Record<keyof Knobs, string>> = {};

  // Exposure and shadows: bring the reference towards the healthy zone, only as far as the highlights allow.
  if (has('lighting.underexposure') || has('lighting.underexposed-raw')) {
    if (guidance.protect.dark) held.push('Dark on purpose, so the exposure is left alone.');
    else {
      const target = style === 'bold' ? 0.5 : 0.44;
      const headroom = stats.p99 > 0 ? unitsFor(stats.p99, 0.97) : 2.5;
      let units = unitsFor(ref, target);
      units = Math.min(units, Math.max(0, headroom + 0.4));
      if (!sub || style !== 'subject') k.exposure = Math.max(0, units) * (style === 'subject' ? 0.6 : m > 1 ? 1.1 : 1);
      evidence.exposure = `${refName} median lightness ${ref.toFixed(2)}, target ${target.toFixed(2)}, ${Math.max(0, headroom).toFixed(1)} units of highlight room`;
      k.shadows = Math.min(1.0, Math.max(0, (0.14 - stats.p05) * 6)) * m * (noisy ? 0.5 : 1);
      evidence.shadows = `darkest 5% of the picture sits at ${stats.p05.toFixed(2)}${noisy ? '; held back because the shadows are noisy' : ''}`;
    }
  }
  if (has('lighting.overexposure') && !guidance.protect.light) {
    k.exposure = Math.min(k.exposure, -Math.min(1.5, unitsFor(0.6, stats.p50) * 0.6) * m);
    evidence.exposure = `median lightness ${stats.p50.toFixed(2)} with no real shadows`;
  }
  // Highlights: only until near-white holds detail.
  if (has('lighting.clipped-highlights') || has('lighting.high-dynamic-range') || has('lighting.overexposure')) {
    if (guidance.protect.light && !has('lighting.clipped-highlights')) held.push('Warm light is part of the picture, so highlights are not pulled down.');
    else {
      k.highlights = -Math.min(1.4, 0.35 + stats.clipHigh * 60 + Math.max(0, stats.p99 - 0.95) * 4) * m;
      evidence.highlights = `${(stats.clipHigh * 100).toFixed(1)}% of pixels at or near white; brightest 1% at ${stats.p99.toFixed(2)}`;
    }
  }
  if (has('lighting.high-dynamic-range')) {
    k.shadows = Math.max(k.shadows, 0.6 * m * (noisy ? 0.5 : 1));
    evidence.shadows = `highlights clipped and shadows crushed together (${(stats.clipLow * 100).toFixed(1)}% near black)`;
  }
  // Noise: reduce before anything sharpens it.
  if (stats.noiseSigma !== null && (has('lighting.high-iso-shadows') || has('lighting.underexposed-raw') || noisy)) {
    const s = stats.noiseSigma;
    k.denoise = Math.min(2, Math.max(0.3, (s - 3) / 3)) * Math.min(1.2, m);
    k.denoiseLuminance = Math.min(1.5, Math.max(0.2, (s - 3.5) / 4)) * Math.min(1.2, m);
    evidence.denoise = evidence.denoiseLuminance = `noise about ${s.toFixed(1)} of 255 in the flattest areas`;
  }
  // Contrast for flat frames; never for fog, soft or low-key scenes.
  if (stats.spread < 0.5 && !guidance.protect.soft && !lowKeyScene && !has('scene.fog')) {
    k.contrast = Math.min(0.6, (0.55 - stats.spread) * 2.2) * m;
    evidence.contrast = `the picture uses only ${(stats.spread * 100).toFixed(0)}% of the tonal range`;
  } else if (stats.spread < 0.5) held.push('Low contrast looks intentional here (soft, foggy or dark), so it is left alone.');
  // Colour cast: only when clear, and never when warm light is part of the scene.
  if (stats.cast && stats.cast.strength >= 0.03 && !guidance.protect.light) {
    const c = stats.cast;
    const amount = Math.min(0.8, (c.strength - 0.012) * 14) * Math.min(1, m);
    if (Math.abs(c.b) >= Math.abs(c.a)) k.warmth = (c.b > 0 ? -amount : amount);
    else k.tint = (c.a > 0 ? -amount : amount) * 0.7;
    evidence.warmth = evidence.tint = `parts of the picture that should be neutral lean ${c.direction} (strength ${(c.strength * 100).toFixed(1)})`;
  } else if (stats.cast && stats.cast.strength >= 0.03 && guidance.protect.light) held.push('A warm or cool lean may be the light itself, so colour balance is left alone.');
  // Vibrance (never saturation): a little when colour is subdued.
  if (stats.meanChroma < 0.05 && !guidance.protect.soft) {
    k.vibrance = (style === 'bold' ? 0.4 : style === 'light' ? 0.05 : 0.15) * (style === 'subject' ? 0.7 : 1);
    evidence.vibrance = `colour is subdued (average chroma ${stats.meanChroma.toFixed(3)})`;
  }
  // Bold: a little more local contrast, if the noise allows it.
  if (style === 'bold' && !noisy && !guidance.protect.soft) {
    k.clarity = 0.2; evidence.clarity = 'a bolder look adds a little local contrast';
    if (!lowKeyScene) k.contrast = Math.max(k.contrast, 0.3);
  }
  // Natural Auto's own measured recipe (src/core/naturalAuto.ts) is reused as a seed: where it asks for more of the same
  // move than the rules above, its (already gated) value wins; it never reverses a rule's direction.
  if (seed && style !== 'subject') {
    for (const key of ['exposure', 'shadows', 'highlights', 'contrast', 'vibrance', 'warmth'] as const) {
      const v = (seed[key] ?? 0) * Math.min(m, 1.2);
      if (!v || (guidance.protect.dark && key === 'exposure' && v > 0)) continue;
      if (k[key] === 0 || (Math.sign(k[key]) === Math.sign(v) && Math.abs(v) > Math.abs(k[key]))) {
        k[key] = v;
        evidence[key] = `Natural Auto measured the ${refName} (median lightness ${ref.toFixed(2)})`;
      }
    }
  }
  // Subject focus: lift and detail on the subject only, where a trustworthy mask exists.
  if (subjectOk && sub) {
    if (style === 'subject' || has('lighting.bright-background')) {
      if (!guidance.protect.dark && ref < 0.42) {
        k.subjectExposure = Math.min(2.2, Math.max(0, unitsFor(ref, 0.46))) * (style === 'subject' ? 1 : 0.7);
        evidence.subjectExposure = `subject median ${sub.median.toFixed(2)} against background ${sub.backgroundMedian.toFixed(2)}`;
      }
    }
    if (style === 'subject' && !noisy && !guidance.protect.soft) {
      k.subjectSharpen = 0.35; k.subjectTexture = 0.15;
      evidence.subjectSharpen = evidence.subjectTexture = 'the subject is the in-focus area, so detail is added there only';
    }
  } else if (style === 'subject') held.push('No subject was found with enough confidence, so this option edits the whole photo gently instead.');

  const clamped = clampKnobs(k);
  const steps: RecipeStep[] = [];
  const subjectKeys: (keyof Knobs)[] = ['subjectExposure', 'subjectSharpen', 'subjectTexture'];
  for (const key of Object.keys(clamped) as (keyof Knobs)[]) {
    const amount = clamped[key];
    if (!amount) continue;
    const scope = subjectKeys.includes(key) ? 'subject' : 'photo';
    const control = (scope === 'subject' ? key.replace('subject', '').toLowerCase() : key) as StepControl;
    const direction: Direction = amount > 0 ? 'up' : 'down';
    const rule = photoControls.includes(control) ? attributeStep(guidance, control, direction, scope) : null;
    steps.push({
      control: key, scope, direction, amount, ruleId: rule?.id ?? null, sources: rule?.sources ?? [],
      evidence: evidence[key] ?? 'measured on the preview',
    });
  }
  return { style, knobs: clamped, steps, held };
}

/** Plain English for one step, from the actual operation. The app localises the same fields; this is the fallback. */
export function describeStep(s: RecipeStep): string {
  const names: Record<keyof Knobs, [string, string]> = {
    exposure: ['Brightened the picture', 'Darkened the picture'], warmth: ['Warmed the colour balance', 'Cooled the colour balance'],
    tint: ['Moved the tint towards magenta', 'Moved the tint towards green'], shadows: ['Opened up the shadows', 'Deepened the shadows'],
    highlights: ['Brought the highlights up', 'Pulled the brightest areas down so they hold detail'], contrast: ['Added a little contrast', 'Softened the contrast'],
    vibrance: ['Added gentle colour to muted tones', 'Calmed the colour'], denoise: ['Reduced colour noise', 'Reduced colour noise'],
    denoiseLuminance: ['Reduced grain', 'Reduced grain'], texture: ['Added fine texture', 'Softened fine texture'], clarity: ['Added a little local contrast', 'Softened local contrast'],
    sharpen: ['Sharpened lightly', 'Sharpened lightly'], subjectExposure: ['Lifted the subject only', 'Darkened the subject only'],
    subjectSharpen: ['Sharpened the subject only', 'Sharpened the subject only'], subjectTexture: ['Added texture to the subject only', 'Softened the subject only'],
  };
  const text = names[s.control][s.direction === 'up' ? 0 : 1];
  const cite = s.ruleId ? `${s.ruleId}${s.sources.length ? ` (${s.sources.join(', ')})` : ' (house practice)'}` : 'house practice';
  return `${text}: ${s.evidence}. Rule: ${cite}.`;
}

export { DEFAULT_EDIT };
