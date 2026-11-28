import type { FrameStats } from './enhanceObserve';
import type { VisionObservationInput } from './enhanceGuide';

/**
 * Is a dark photo LOW KEY (dark on purpose) or UNDEREXPOSED (a lift is expected)? Never decided from the histogram alone:
 * exposure metadata, histogram shape and scene observations all vote, and when they disagree or the evidence is thin the
 * answer is 'ambiguous' and the loop offers options that span both readings. A person's chosen intent always wins.
 * Rule-based and deterministic; nothing here is a model.
 */
export interface ExposureMeta {
  /** EXIF exposure compensation in EV (negative = the photographer asked for darker). */
  evCompensation?: number | null;
  shutterSeconds?: number | null;
  iso?: number | null;
  aperture?: number | null;
  program?: string | null;
  metering?: string | null;
}

export type ExposureReading = 'not-dark' | 'underexposed' | 'low-key' | 'ambiguous';
export type UserIntent = 'low-key' | 'normal' | null;

export interface IntentResult {
  reading: ExposureReading;
  /** 0 to 1. Capped lower without metadata. */
  confidence: number;
  reasons: string[];
  metadataUsed: boolean;
  scores: { lowKey: number; underexposed: number };
}

const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export function hasMetadata(meta: ExposureMeta | null | undefined): boolean {
  return !!meta && [meta.evCompensation, meta.shutterSeconds, meta.iso, meta.aperture].some(num);
}

export function classifyExposureIntent(
  stats: FrameStats, meta: ExposureMeta | null | undefined, vision: readonly VisionObservationInput[] = [], intent: UserIntent = null,
): IntentResult {
  const sub = stats.subject && stats.subject.confidence !== 'low' ? stats.subject : null;
  const ref = sub ? Math.min(sub.median, stats.p50 + 0.1) : stats.p50;
  const metadataUsed = hasMetadata(meta);
  const reasons: string[] = [];
  if (intent) {
    return {
      reading: intent === 'low-key' ? 'low-key' : (stats.p50 < 0.3 ? 'underexposed' : 'not-dark'), confidence: 1,
      reasons: [intent === 'low-key' ? 'You chose to keep it dark.' : 'You chose a normal exposure.'], metadataUsed, scores: { lowKey: 0, underexposed: 0 },
    };
  }
  // Dark enough to ask the question: dark median, or a histogram squeezed into the lower tones with nothing bright.
  const squeezed = stats.p99 < 0.7 && stats.p50 < 0.4;
  if (ref >= 0.3 && stats.p50 >= 0.3 && !squeezed) return { reading: 'not-dark', confidence: 0.9, reasons: [], metadataUsed, scores: { lowKey: 0, underexposed: 0 } };

  let low = 0, under = 0;
  const add = (kind: 'low' | 'under', w: number, why: string) => { if (kind === 'low') low += w; else under += w; reasons.push(why); };
  // Histogram shape: where the mass sits, whether bright accents exist, whether the blacks are true or lifted.
  if (stats.p01 < 0.03) add('low', 1, 'true blacks are present');
  else if (stats.p01 > 0.05) add('under', 0.5, 'even the darkest tones are lifted off black');
  if (stats.p99 > 0.7) add('low', 1, 'there are bright accents against the dark');
  else if (stats.p99 < 0.5) add('under', 2, 'nothing in the picture is bright, so the whole range is squeezed down');
  if (stats.clipHigh > 0.002) add('under', 1.5, 'highlights are near clipping, so the photographer protected them');
  if (stats.clipLow > 0.1) add('low', 1, 'a large share of the shadows is solid black');
  if (sub && sub.median - sub.backgroundMedian > 0.15) add('low', 1, 'the subject is lit against a dark background');
  if (sub && sub.backgroundMedian > sub.median + 0.1) add('under', 1, 'the subject is darker than its background');
  // Scene observations (labels from the user's tags or the on-device vision model, only when confident).
  const seen = (label: string) => vision.some((v) => v.confidence >= 0.8 && v.label.toLowerCase() === label);
  if (seen('low key') || seen('silhouette') || seen('night landscape') || seen('concert')) add('low', 2, 'the scene reads as dark on purpose');
  if (seen('backlit') || seen('underexposure')) add('under', 1.5, 'the scene reads as backlit or underexposed');
  // Metadata.
  if (metadataUsed && meta) {
    if (num(meta.evCompensation)) {
      if (meta.evCompensation <= -0.7) add('under', 2, `exposure compensation was ${meta.evCompensation.toFixed(1)} EV: a lift is expected`);
      else if (meta.evCompensation >= 0.3) add('low', 0.5, 'exposure compensation was not lowered');
    }
    if (num(meta.shutterSeconds) && num(meta.iso)) {
      if (meta.shutterSeconds <= 1 / 1000 && meta.iso >= 1600) add('under', 1, 'a fast shutter at high ISO suggests underexposing for speed');
      if (meta.shutterSeconds >= 1 / 30 && meta.iso <= 800) add('low', 1, 'a slow shutter at low ISO suggests a deliberate dark scene');
    } else if (num(meta.shutterSeconds)) {
      if (meta.shutterSeconds <= 1 / 2000) add('under', 0.5, 'a very fast shutter');
      if (meta.shutterSeconds >= 1 / 15) add('low', 0.5, 'a slow shutter');
    }
    if (num(meta.iso) && meta.iso >= 3200) add('under', 0.5, 'very high ISO');
    if (meta.metering && /spot/i.test(meta.metering) && sub && sub.median > stats.p50) add('low', 0.5, 'spot metering on a lit subject');
  }
  const diff = low - under;
  const need = metadataUsed ? 2 : 2.5;
  const cap = metadataUsed ? 0.95 : 0.8;
  const conf = Math.min(cap, 0.55 + 0.1 * Math.abs(diff));
  const scores = { lowKey: low, underexposed: under };
  if (diff >= need) return { reading: 'low-key', confidence: conf, reasons, metadataUsed, scores };
  if (-diff >= need) return { reading: 'underexposed', confidence: conf, reasons, metadataUsed, scores };
  return { reading: 'ambiguous', confidence: 0.5, reasons: [...reasons, 'the evidence does not settle it'], metadataUsed, scores };
}
