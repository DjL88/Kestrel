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

/** The workspace replaces only the two automatic group layers. Existing
 * individual overrides and manual adjustments keep their exact recipe/order. */
export function composeDenoiseRecipe(base: PhotoEdit | undefined, id: string, strength: number, masks: Mask[], lumaPerStrength = 0): PhotoEdit {
  const edit = base ?? DEFAULT_EDIT;
  // Luminance (grain) denoise moves with the verified strength, so a detail-loss correction reduces both together.
  const luma = Math.round(Math.min(2, strength * lumaPerStrength) * 1e4) / 1e4;
  return { ...edit, denoise: strength, ...(luma > 0 ? { denoiseLuminance: luma } : {}), masks: [
    ...(edit.masks ?? []).filter(mask => mask.id !== id && mask.id !== id + '-background'),
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
