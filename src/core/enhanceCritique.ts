import { checkColour, toOklab } from './colourCheck';
import { assessNaturalAuto, subjectWeights } from './naturalAuto';
import { superviseAutoRender } from './autoRenderSupervisor';
import { observeFrame, lightness, type FrameStats } from './enhanceObserve';
import type { Guidance } from './enhanceGuide';
import type { Knobs } from './enhanceRecipe';
import type { PhotoEdit } from './photoEdits';
import type { SubjectGrid } from './maskTypes';

/**
 * Enhance loop, step 5: CHECK. Judges the actual rendered pixels, never the slider values. Deterministic gates (clipping,
 * lost texture, halos, subject leakage, banding, colour plausibility, crop unchanged) plus measured issues in plain words.
 * An on-device vision AI may add issues in the same vocabulary; it can only make the check stricter, never waive a gate.
 */

export type IssueId =
  | 'clippedMore' | 'tooDark' | 'subjectDark' | 'tooBright' | 'shadowsCrushed' | 'noisier' | 'flat' | 'harsh'
  | 'blotchy' | 'castRemains' | 'colourPushed' | 'haloOrCrunch' | 'detailLost' | 'leakage' | 'banding' | 'gate' | 'cropChanged';

export interface Issue {
  id: IssueId;
  /** Plain British English: what is still wrong. */
  words: string;
  source: 'measured' | 'vision';
}

export interface Gate { safe: boolean; reason: string; issue?: IssueId }

export interface Critique {
  /** Higher is better. Used only to keep the best round and to stop when a round makes things worse. */
  score: number;
  issues: Issue[];
  gate: Gate;
  after: FrameStats;
}

export interface CritiqueContext {
  guidance: Guidance;
  width: number;
  height: number;
  /** Subject grid, when a subject mask was trusted; used by the gates. */
  segmentation: { grid: SubjectGrid; confidence: 'high' | 'medium' | 'low' } | null;
  /** Whether warm or dark light was declared on purpose (so a lean or darkness is not a fault). */
  preserveLight: boolean;
  preserveDark: boolean;
}

const KNOB_KEYS = new Set(['exposure', 'warmth', 'tint', 'shadows', 'highlights', 'contrast', 'vibrance', 'denoise', 'denoiseLuminance', 'texture', 'clarity', 'sharpen', 'masks']);

/** Crop, rotation, healing, lens and every other part of the recipe must be exactly as they were. */
export function onlyEnhanceKeysChanged(base: PhotoEdit, edit: PhotoEdit): boolean {
  const keys = new Set([...Object.keys(base), ...Object.keys(edit)]);
  for (const key of keys) {
    if (KNOB_KEYS.has(key)) continue;
    if (JSON.stringify((base as unknown as Record<string, unknown>)[key]) !== JSON.stringify((edit as unknown as Record<string, unknown>)[key])) return false;
  }
  // Masks the person already had must stay as they were.
  const before = JSON.stringify(base.masks ?? []);
  return JSON.stringify((edit.masks ?? []).slice(0, base.masks?.length ?? 0)) === before;
}

/** Share of empty tonal levels between the 5th and 95th percentile: banding after a stretch shows as comb gaps. */
export function gapShare(rgba: Uint8ClampedArray, width: number, height: number): number {
  const bins = new Uint32Array(256);
  const n = width * height;
  for (let i = 0; i < n; i += 1) bins[Math.round(lightness(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) * 255)] += 1;
  let acc = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i += 1) { acc += bins[i]; if (acc >= n * 0.05) { lo = i; break; } }
  acc = 0;
  for (let i = 0; i < 256; i += 1) { acc += bins[i]; if (acc >= n * 0.95) { hi = i; break; } }
  if (hi - lo < 24) return 0;
  let empty = 0;
  for (let i = lo; i <= hi; i += 1) if (bins[i] === 0) empty += 1;
  return empty / (hi - lo + 1);
}

export function runGates(
  beforePx: Uint8ClampedArray, afterPx: Uint8ClampedArray, ctx: CritiqueContext, base: PhotoEdit, edit: PhotoEdit,
): Gate {
  const { width, height } = ctx;
  if (!onlyEnhanceKeysChanged(base, edit)) return { safe: false, reason: 'The recipe would change something other than light, colour and detail (such as the crop)', issue: 'cropChanged' };
  const natural = assessNaturalAuto(beforePx, afterPx, width, height, ctx.segmentation);
  if (!natural.safe) {
    const r = natural.reason.toLowerCase();
    const issue: IssueId = r.includes('clipping') || r.includes('highlight') ? 'clippedMore' : r.includes('crunch') ? 'haloOrCrunch' : r.includes('colour') ? 'colourPushed' : r.includes('noisy') ? 'noisier' : 'gate';
    return { safe: false, reason: natural.reason, issue };
  }
  const weights = ctx.segmentation && ctx.segmentation.confidence !== 'low' ? subjectWeights(ctx.segmentation.grid, width, height) : null;
  const supervised = superviseAutoRender({ data: beforePx, width, height }, { data: afterPx, width, height }, weights ? [weights] : []);
  if (!supervised.safe) {
    const r = supervised.reason.toLowerCase();
    const issue: IssueId = r.includes('detail') ? 'detailLost' : r.includes('halo') || r.includes('overshoot') ? 'haloOrCrunch' : r.includes('subject') || r.includes('mask') || r.includes('leak') ? 'leakage' : 'gate';
    return { safe: false, reason: supervised.reason, issue };
  }
  const gapsBefore = gapShare(beforePx, width, height), gapsAfter = gapShare(afterPx, width, height);
  if (gapsAfter - gapsBefore > 0.12) return { safe: false, reason: 'The tones would show banding (gaps in the tonal range)', issue: 'banding' };
  const colourAfter = checkColour({ after: { data: afterPx, width, height }, before: { data: beforePx, width, height } });
  const colourBefore = checkColour({ after: { data: beforePx, width, height } });
  const had = new Set(colourBefore.findings.filter((f) => f.severity === 'warning').map((f) => f.id));
  const fresh = colourAfter.findings.find((f) => f.severity === 'warning' && !had.has(f.id));
  if (fresh) return { safe: false, reason: fresh.id === 'clippedColour' ? 'Strong colours would run out of range and lose detail' : 'Colours would become implausibly strong', issue: 'colourPushed' };
  return { safe: true, reason: 'Clipping, detail, halos, subject edges, banding, colour and framing are all within limits' };
}

/** Colour blotchiness in dark, smooth areas: how much a and b wander inside flat 12x12 blocks (Oklab). Higher = blotchier. */
export function chromaBlotch(rgba: Uint8ClampedArray, width: number, height: number): number {
  const B = 12;
  let total = 0, count = 0;
  for (let by = 0; by + B <= height; by += B) for (let bx = 0; bx + B <= width; bx += B) {
    let sl = 0, sl2 = 0, sa = 0, sa2 = 0, sb = 0, sb2 = 0;
    for (let y = by; y < by + B; y += 1) for (let x = bx; x < bx + B; x += 1) {
      const i = (y * width + x) * 4;
      const [L, a, b] = toOklab(rgba[i], rgba[i + 1], rgba[i + 2]);
      sl += L; sl2 += L * L; sa += a; sa2 += a * a; sb += b; sb2 += b * b;
    }
    const n = B * B, ml = sl / n;
    if (ml > 0.45 || Math.sqrt(Math.max(0, sl2 / n - ml * ml)) > 0.05) continue; // dark and smooth blocks only
    total += Math.sqrt(Math.max(0, sa2 / n - (sa / n) ** 2)) + Math.sqrt(Math.max(0, sb2 / n - (sb / n) ** 2));
    count += 1;
  }
  return count >= 8 ? total / count : 0;
}

const TARGET = [0.4, 0.58] as const;
/** Visible noise relative to how bright the picture is: brightening a dark photo raises sigma on the 0-255 scale, but not what the eye sees against the brighter picture. */
export const relativeNoise = (s: FrameStats) => (s.noiseSigma ?? 0) / Math.max(255 * s.p50, 12);
export const noisier = (before: FrameStats, after: FrameStats) => before.noiseSigma !== null && after.noiseSigma !== null && relativeNoise(after) > relativeNoise(before) * 1.15 && after.noiseSigma > 4;

/** Measures the rendered result against the original and says what is still wrong. Pure and deterministic. */
export function critiqueRender(
  before: FrameStats, beforePx: Uint8ClampedArray, afterPx: Uint8ClampedArray, ctx: CritiqueContext, base: PhotoEdit, edit: PhotoEdit,
  subjectWeightsMap?: Float32Array | null,
): Critique {
  const after = observeFrame(afterPx, ctx.width, ctx.height, subjectWeightsMap ? { segmentation: { weights: subjectWeightsMap, confidence: before.subject?.confidence ?? 'medium' } } : {});
  const gate = runGates(beforePx, afterPx, ctx, base, edit);
  const issues: Issue[] = [];
  const add = (id: IssueId, words: string) => issues.push({ id, words, source: 'measured' });
  const sub = before.subject && before.subject.confidence !== 'low' ? after.subject : null;
  const ref = sub ? sub.median : after.p50;
  const refBefore = before.subject && before.subject.confidence !== 'low' ? before.subject.median : before.p50;
  const dark = ctx.preserveDark || (before.p50 < 0.2 && before.p99 < 0.9 && before.clipHigh < 0.001);
  if (!gate.safe) add(gate.issue ?? 'gate', gate.reason);
  if (after.clipHigh - before.clipHigh > 0.003) add('clippedMore', `More of the picture is blown to white (${(after.clipHigh * 100).toFixed(1)}%, was ${(before.clipHigh * 100).toFixed(1)}%)`);
  if (before.clipHigh >= 0.004 && after.clipHigh > before.clipHigh * 0.7 && after.clipHigh > 0.004) add('clippedMore', `The highlights are still blown to white (${(after.clipHigh * 100).toFixed(1)}% of the picture)`);
  if (!dark && ref < 0.3) add(sub ? 'subjectDark' : 'tooDark', `The ${sub ? 'subject' : 'picture'} is still dark (median lightness ${ref.toFixed(2)})`);
  if (!ctx.preserveLight && after.p50 > 0.74 && after.p05 > 0.2) add('tooBright', `The picture is bright overall (median lightness ${after.p50.toFixed(2)})`);
  if (after.clipLow - before.clipLow > 0.01) add('shadowsCrushed', `More of the shadows are crushed to black (${(after.clipLow * 100).toFixed(1)}%)`);
  if (noisier(before, after)) add('noisier', `The picture looks noisier than before (grain about ${(after.noiseSigma ?? 0).toFixed(1)}, was ${(before.noiseSigma ?? 0).toFixed(1)}, against a brighter picture)`);
  const blotchAfter = chromaBlotch(afterPx, ctx.width, ctx.height), blotchBefore = chromaBlotch(beforePx, ctx.width, ctx.height);
  if (blotchAfter > 0.012 && blotchAfter > blotchBefore * 1.3) add('blotchy', `Dark areas look blotchy in colour (${blotchAfter.toFixed(3)}, was ${blotchBefore.toFixed(3)})`);
  if (!dark && !ctx.guidance.protect.soft && after.spread < 0.42 && !ctx.guidance.rules.some((r) => r.id === 'scene.fog')) add('flat', `The tones are still flat (using ${(after.spread * 100).toFixed(0)}% of the range)`);
  if (after.clipHigh > 0.004 && after.clipLow > 0.01 && after.spread > 0.92) add('harsh', 'The contrast is harsh, with both blown highlights and crushed shadows');
  if (!ctx.preserveLight && after.cast && after.cast.strength >= 0.03 && (!before.cast || after.cast.strength >= before.cast.strength * 0.7))
    add('castRemains', `Parts that should be neutral still lean ${after.cast.direction}`);
  // Score. The loop uses it only to keep the best round and to stop when a round is worse; the harness scores separately.
  let score = 1;
  const dist = dark ? Math.abs(ref - refBefore) * 1.5 : ref < TARGET[0] ? TARGET[0] - ref : ref > TARGET[1] ? ref - TARGET[1] : 0;
  score -= Math.max(0, dist - 0.06) * 1.2 + Math.min(dist, 0.06) * 0.4;
  score -= Math.max(0, after.clipHigh - before.clipHigh) * 8 + Math.max(0, after.clipHigh - 0.01) * 2;
  score -= Math.max(0, after.clipLow - before.clipLow) * 4;
  if (after.noiseSigma !== null && before.noiseSigma !== null) score -= Math.max(0, relativeNoise(after) / Math.max(relativeNoise(before), 1e-3) - 1) * 0.15;
  if (!dark && !ctx.guidance.protect.soft) score -= Math.max(0, 0.5 - after.spread) * 0.5 + Math.max(0, after.spread - 0.92);
  if (!ctx.preserveLight && after.cast) score -= Math.max(0, after.cast.strength - 0.02) * 4;
  if (!gate.safe) score -= 1;
  return { score, issues, gate, after };
}

export const KNOB_FOR_ISSUE_FIX: Readonly<Partial<Record<IssueId, Partial<Record<keyof Knobs, number>>>>> = {
  clippedMore: { highlights: -0.3, exposure: -0.2, subjectExposure: -0.2 },
  tooDark: { exposure: 0.3, shadows: 0.2 },
  subjectDark: { subjectExposure: 0.4, exposure: 0.15 },
  tooBright: { exposure: -0.4, highlights: -0.2 },
  shadowsCrushed: { shadows: 0.3, exposure: 0.1 },
  blotchy: { denoise: 0.4, exposure: -0.15, shadows: -0.15 },
  noisier: { denoise: 0.4, denoiseLuminance: 0.3, shadows: -0.2, sharpen: -0.1, subjectSharpen: -0.15, clarity: -0.1 },
  flat: { contrast: 0.2 },
  harsh: { contrast: -0.25, highlights: -0.2, shadows: 0.15 },
  colourPushed: { vibrance: -0.25, contrast: -0.1, clarity: -0.1, exposure: -0.1 },
  haloOrCrunch: { clarity: -0.2, texture: -0.15, sharpen: -0.15, subjectSharpen: -0.15, subjectTexture: -0.1 },
  detailLost: { denoise: -0.3, denoiseLuminance: -0.3, contrast: -0.1 },
  leakage: { subjectExposure: -0.5, subjectSharpen: -0.2 },
  banding: { shadows: -0.3, contrast: -0.2, exposure: -0.15 },
};
