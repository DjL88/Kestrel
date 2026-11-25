import { applyDetail, applyPhotoEdit, DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { applyNoiseReduction } from '../../core/noiseReduction';
import { applyMasks, fullContext, maskAlpha } from '../../core/masks';
import type { Mask } from '../../core/maskTypes';
import type { Pixels } from '../../core/colourCheck';
import { regionalDetailEvidence } from '../../engine/regionalDetailGuard';
import { verifyEdit, type CourseCorrection } from '../../engine/enhancementVerifier';

/** Same ordering as the canvas renderer, from unedited working pixels. */
export function renderDenoiseRecipe(source: Pixels, edit: PhotoEdit): Pixels {
  const { width, height } = source;
  const data = new Uint8ClampedArray(applyNoiseReduction(source.data, width, height, edit));
  applyPhotoEdit(data, edit);
  applyDetail(data, width, height, edit, Math.max(width, height));
  applyMasks(data, width, height, edit.masks, fullContext(width, height));
  return { data, width, height };
}

/** The automatic layers one denoise run owns: the background/subject pair and its eye protection. */
export const isAutoDenoiseLayer = (maskId: string, id: string) => maskId === id || maskId === id + '-background' || maskId.startsWith(id + '-eye-');

/** The workspace replaces only the automatic group layers (pair and eyes). Existing
 * individual overrides and manual adjustments keep their exact recipe/order. */
export function composeDenoiseRecipe(base: PhotoEdit | undefined, id: string, strength: number, masks: Mask[], lumaPerStrength = 0): PhotoEdit {
  const edit = base ?? DEFAULT_EDIT;
  // Luminance (grain) denoise moves with the verified strength, so a detail-loss correction reduces both together.
  const luma = Math.round(Math.min(2, strength * lumaPerStrength) * 1e4) / 1e4;
  // This run decides any AI denoise afresh: an older stored result is dropped here and re-added only if chosen again.
  const { denoiseLuminance: previousGrain, trueDetailAi: _previousAi, ...rest } = edit;
  // A regional recipe carries grain per region, so the global grain setting it replaces is removed, never stacked.
  const regional = masks.some(mask => mask.id === id + '-background');
  const grain = luma > 0 ? luma : regional ? undefined : previousGrain;
  return { ...rest, denoise: strength, ...(grain !== undefined ? { denoiseLuminance: grain } : {}), masks: [
    ...(edit.masks ?? []).filter(mask => !isAutoDenoiseLayer(mask.id, id)),
    ...masks,
  ] };
}

/** A group average must never hide detail loss on a smaller individual. */
export function verifyDenoiseRecipe(before: Pixels, after: Pixels, subjects: readonly Mask[]): CourseCorrection {
  const overall = verifyEdit(before, after);
  const reasons = [...overall.reasons];
  let scale = overall.suggestedStrengthScale;
  for (let i = 0; i < subjects.length; i++) {
    const alpha = maskAlpha(subjects[i], before.width, before.height, fullContext(before.width, before.height));
    const evidence = regionalDetailEvidence(before, after, alpha);
    if (evidence.regions > 0 && (evidence.ratio < 0.75 || evidence.worstRegion < 0.6)) {
      reasons.push('Too much detail was lost on subject ' + (i + 1) + '.');
      scale = Math.min(scale, 0.5);
    }
  }
  return { ok: reasons.length === 0, reasons, suggestedStrengthScale: scale };
}
