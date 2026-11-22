import { checkColour, toOklab, type ColourFinding, type Pixels } from '../core/colourCheck';

/**
 * Closed-loop check for an action engine (denoise, exposure/colour grading, saturation) run on a photo:
 * does the RESULT actually look right, or did the action overshoot? (owner direction, 22 Nov 2026: "it
 * shouldn't just blindly change an image, it should check the results and course correct if colour is
 * wrong, denoise is too far, it's too bright or dark or over saturated".)
 *
 * This reuses the real, already-shipped `checkColour` (colour cast, clipped/strong colour) for the
 * colour half of that list. Brightness-shift and denoise-detail-loss are new, simple, self-contained
 * checks written here - they intentionally do NOT reuse `unifiedAuto.ts`'s `Measured`/`inRange`, which
 * needs a fuller `SceneReport` than this generic before/after verifier has; a future slice may replace
 * this with that richer pipeline. Thresholds below are a first cut, not a calibrated release gate -
 * marked as such rather than presented as settled.
 */

export interface CourseCorrection {
  ok: boolean;
  reasons: string[];
  /** 1 = accept the result as-is. Below 1 = reapply the same action at this fraction of its strength
   * and re-check. This is one shared scale across every finding in this first cut; a real system would
   * correct exposure, colour and denoise independently rather than share one number - noted, not hidden. */
  suggestedStrengthScale: number;
}

/** Regular sample grid, not every pixel: this runs after every action, so it must stay cheap. A regular
 * stride can in principle under-sample a perfectly periodic pattern at the same period as the stride -
 * not a realistic risk on a real photograph, but worth naming rather than assuming away. */
const SAMPLE_STRIDE = 4;

/** Median OKLab lightness, optionally restricted to pixels where `alphaMask` is above `alphaThreshold` -
 * same reasoning as detailRatio below: a Look step that deliberately darkens/brightens a background it
 * is softening should not be judged on that intended shift, only on what happened to the subject. */
function medianOklabLightness(pixels: Pixels, alphaMask?: Float32Array, alphaThreshold = 0.5): number {
  const values: number[] = [];
  for (let y = 0; y < pixels.height; y += SAMPLE_STRIDE) {
    for (let x = 0; x < pixels.width; x += SAMPLE_STRIDE) {
      if (alphaMask && alphaMask[y * pixels.width + x] < alphaThreshold) continue;
      const i = (y * pixels.width + x) * 4;
      const [l] = toOklab(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
      values.push(l);
    }
  }
  values.sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : 0;
}

/** How much local detail (one luma gradient step) survives, after versus before - same technique
 * autoCull.ts's scorePreview already uses to judge detail, applied here as a ratio rather than a score.
 *
 * When `alphaMask` is given, only pixels where it is above `alphaThreshold` are sampled - so a Look that
 * deliberately softens the background (src/engine/looks.ts) is judged on whether it preserved SUBJECT
 * detail, not on the background detail it was asked to remove. Without a mask, the whole frame is
 * sampled, as before (plain denoise with no subject has nothing else to judge detail against). */
function detailRatio(before: Pixels, after: Pixels, alphaMask?: Float32Array, alphaThreshold = 0.5): number {
  const gradientSum = (pixels: Pixels): number => {
    let sum = 0, count = 0;
    for (let y = SAMPLE_STRIDE; y < pixels.height - SAMPLE_STRIDE; y += SAMPLE_STRIDE) {
      for (let x = SAMPLE_STRIDE; x < pixels.width - SAMPLE_STRIDE; x += SAMPLE_STRIDE) {
        const i = (y * pixels.width + x) * 4;
        if (alphaMask && alphaMask[y * pixels.width + x] < alphaThreshold) continue;
        const right = ((y * pixels.width + x + 1) * 4);
        const down = (((y + 1) * pixels.width + x) * 4);
        sum += Math.abs(pixels.data[i] - pixels.data[right]) + Math.abs(pixels.data[i] - pixels.data[down]);
        count += 1;
      }
    }
    return count ? sum / count : 0;
  };
  const beforeDetail = gradientSum(before);
  return beforeDetail > 0.0001 ? gradientSum(after) / beforeDetail : 1;
}

const BRIGHTNESS_SHIFT_LIMIT = 0.12; // OKLab L is 0-1; a first-cut "that moved too far" band, not calibrated.
const DENOISE_DETAIL_FLOOR = 0.55;   // Lost nearly half the local detail: treat as over-smoothed, not just softened.

/**
 * Checks one action's result against its input. Pass `subject` (0-1 mask, same size as `after`) when a
 * mask exists, so colour findings can tell subject from surroundings, same as `checkColour` already does.
 *
 * `detailScope`: 'frame' (default) judges detail loss over the whole photo - right for a plain, no-mask
 * action such as runDenoiseAction's background-only pass. 'subject' restricts the detail-loss check to
 * `subject`'s masked-in region - right for a Look step that is deliberately softening the BACKGROUND
 * (src/engine/looks.ts): the background is meant to lose detail there, so judging the whole frame would
 * misreport an intended look as an overshoot. 'subject' falls back to 'frame' if `subject` is absent.
 */
export function verifyEdit(
  before: Pixels, after: Pixels, subject?: Float32Array, detailScope: 'frame' | 'subject' = 'frame',
): CourseCorrection {
  const reasons: string[] = [];
  let scale = 1;

  const colour = checkColour({ after, before, subject });
  const overSaturated = colour.findings.find(isOversaturated);
  if (overSaturated) { reasons.push('Colour is too strong or has clipped (lost detail in intense colour).'); scale *= 0.7; }
  const cast = colour.findings.find((f): f is ColourFinding & { id: 'cast' } => f.id === 'cast' && f.amount === 'clear');
  if (cast) { reasons.push(`A clear ${cast.direction} colour cast.`); scale *= 0.7; }

  const brightnessMask = detailScope === 'subject' && subject ? subject : undefined;
  const brightnessShift = medianOklabLightness(after, brightnessMask) - medianOklabLightness(before, brightnessMask);
  if (brightnessShift > BRIGHTNESS_SHIFT_LIMIT) { reasons.push('The result is noticeably brighter than the original.'); scale *= 0.7; }
  if (brightnessShift < -BRIGHTNESS_SHIFT_LIMIT) { reasons.push('The result is noticeably darker than the original.'); scale *= 0.7; }

  const detail = detailScope === 'subject' && subject ? detailRatio(before, after, subject) : detailRatio(before, after);
  if (detail < DENOISE_DETAIL_FLOOR) {
    reasons.push(detailScope === 'subject' ? 'Softening has smoothed away too much detail on the subject itself.' : 'Denoising has smoothed away too much real detail.');
    scale *= 0.5;
  }

  return { ok: reasons.length === 0, reasons, suggestedStrengthScale: reasons.length ? scale : 1 };
}

function isOversaturated(finding: ColourFinding): boolean {
  return finding.id === 'clippedColour' || (finding.id === 'strongColour' && finding.severity === 'warning');
}
