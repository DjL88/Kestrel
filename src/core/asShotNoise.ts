import { recordEdit } from './editHistory';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';
import { isRawPreviewFile } from './rawFormats';
import type { PhotoFrame } from './types';

/**
 * The "As shot" look's luminance noise reduction for RAWs.
 *
 * Every RAW starts out looking like the camera's own JPEG, and the camera smooths luminance grain at high ISO. Without
 * it a high-ISO RAW looked much grainier than the camera's picture, and averaging that grain in display brightness made
 * dark feathers look milky (owner's ISO 10,000 puffin). It is conservative (nothing up to ISO 800, then a gentle rise
 * per doubling of ISO) and it is never hidden: it is the real starting value of Enhance's Luminance slider, recorded in
 * History as a step InFlight made ("As shot"), undone by one Undo, and what "Reset" goes back to. Photos imported before
 * this existed are left exactly as they are, and a person's own edits are never changed.
 */

/** No luminance smoothing up to this ISO: low-ISO grain is fine detail, not noise. */
export const AS_SHOT_NOISE_FROM_ISO = 800;
/** Slider points added for each doubling of ISO above AS_SHOT_NOISE_FROM_ISO. */
export const AS_SHOT_NOISE_PER_STOP = 6.5;
/** Never more than this from the default, however high the ISO (the slider runs 0 to 100). */
export const AS_SHOT_NOISE_MAX = 40;
/** One engine step is 50 slider points (src/v2/engineClient/recipeMap.ts). */
const SLIDER_PER_STEP = 50;

/** The starting Luminance slider value (0 to 100, whole points) for a RAW shot at this ISO; 0 when the ISO is unknown. */
export function asShotLuminanceSlider(iso: number | undefined): number {
  if (typeof iso !== 'number' || !Number.isFinite(iso) || iso <= AS_SHOT_NOISE_FROM_ISO) return 0;
  return Math.min(AS_SHOT_NOISE_MAX, Math.round(Math.log2(iso / AS_SHOT_NOISE_FROM_ISO) * AS_SHOT_NOISE_PER_STOP));
}

/** The same in the recipe's own units (0 to 2). */
export const asShotLuminanceStep = (iso: number | undefined) => asShotLuminanceSlider(iso) / SLIDER_PER_STEP;

/**
 * A newly imported photo with its As shot noise reduction as its first recipe step, made by InFlight. Unchanged for a
 * photo that is not a RAW, has no ISO above the threshold, or already carries an edit (a person's, or one brought in).
 */
export function withAsShotNoise(frame: PhotoFrame, at: number): PhotoFrame {
  if (!isRawPreviewFile(frame.filename) || frame.edit || frame.asShotLuminance !== undefined) return frame;
  const iso = frame.exif?.iso;
  const step = asShotLuminanceStep(iso);
  if (!step) return frame;
  const recorded = recordEdit({ ...frame, asShotLuminance: step }, { edit: { ...DEFAULT_EDIT, denoiseLuminance: step } }, at,
    { by: 'as-shot', notes: [`Luminance noise reduction ${asShotLuminanceSlider(iso)} for ISO ${Math.round(iso!).toLocaleString('en-GB')}, as the camera's own picture has.`] });
  return recorded;
}

/** What "Reset" goes back to: the photo's As shot recipe when it has one, otherwise no edit at all. */
export function asShotEdit(frame: Pick<PhotoFrame, 'asShotLuminance'>): PhotoEdit | undefined {
  const step = frame.asShotLuminance;
  return typeof step === 'number' && Number.isFinite(step) && step > 0 ? { ...DEFAULT_EDIT, denoiseLuminance: step } : undefined;
}
