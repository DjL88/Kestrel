import { effectiveAlpha } from './masks';
import type { Mask } from './maskTypes';

/** A bounded, translucent view of the actual local adjustment weights. Independent of slider values:
 * an unedited new mask still shows where it will apply. Hidden/missing masks show no guide. */
export function maskCoverageGuide(masks: readonly Mask[], maskId: string, sourceWidth: number, sourceHeight: number) {
  const mask = masks.find(item => item.id === maskId && !item.hidden);
  if (!mask || !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scale = Math.min(1, 384 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const weights = effectiveAlpha(mask, masks, width, height, { aspect: sourceHeight / sourceWidth, view: { x: 0, y: 0, w: 1, h: 1 } });
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < weights.length; i++) {
    rgba[i * 4] = 245; rgba[i * 4 + 1] = 62; rgba[i * 4 + 2] = 160;
    rgba[i * 4 + 3] = Math.round(weights[i] * 144);
  }
  return { width, height, rgba };
}
