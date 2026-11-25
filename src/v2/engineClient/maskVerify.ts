import { runMaskAction, type MaskActionResult } from '../../engine/maskAction';
import { applyCanvasPhotoEdit } from '../../core/canvasEdit';
import { effectiveAlpha, fullContext } from '../../core/masks';
import { darkenOutsideMask } from '../../core/visionGuardian';
import { askGuardianAbout, canvasJpeg } from '../../providers/visionGuardian';
import { hasLocalVision } from '../../providers/localVision';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../../core/photoFraming';
import { hasActiveMasks, type Mask } from '../../core/maskTypes';
import type { Pixels } from '../../core/colourCheck';
import type { PhotoFrame } from '../../core/types';

/** Long edge this check renders at: big enough to judge a mask's real effect honestly, small enough to
 * stay quick after a slider settles. Same bounded-preview convention as runDenoise.ts's working edge. */
export const MASK_VERIFY_EDGE = 1600;

export interface MaskVerifyResult {
  masks: Mask[];
  verification: MaskActionResult['verification'];
  attempts: number;
}

/**
 * Runs a photo's masks through the real, decide -> render -> verify -> retry engine action every other
 * local-adjustment capability already gets (`engine/maskAction.ts`'s `runMaskAction`), instead of trusting
 * a dragged slider value at face value - the gap V2's Masks panel shipped with (docs/ROADMAP.md, 22 Nov
 * 2026: "the engine's verified-and-retried runMaskAction is not used here (V1 does not use it either)").
 *
 * Deliberately rendered on the WHOLE framed photo (`drawFramedPhoto`/`framedSize`), never on any one
 * format's cropped canvas: that is the same source every V2 `SizePreset` crop is only ever a CSS window
 * onto (`EngineSurface.tsx`'s `FrameImage`, and `renderV2Export.ts`'s own comment to the same effect -
 * "the edit is applied to the whole framed picture first, so masks stay in place whatever the crop"). A
 * mask's honesty check has to look at the same pixels its edit actually changes, not at whichever crop or
 * output size happens to be active when the check runs, or a mask could read as fine at one format's
 * resolution/crop and wrong at another's. Passing no crop/size parameter here at all - only the frame and
 * its own framing - is what makes that true by construction, not by convention.
 *
 * Only the masks' own local effect is judged (the whole-photo recipe is held neutral for this check),
 * matching `maskAction.ts`'s own narrower job: it decides whether a mask's edit strength held up, not
 * whether the photo's global exposure/colour did.
 *
 * NOT done here: verification is frame-scoped (`subject` is never passed to `runMaskAction`), even for a
 * Subject/Background mask whose effect is concentrated in one region - a genuinely overdone subject-only
 * edit can be diluted by the rest of the frame and read as milder than it is. That is a conservative gap
 * (it can under-flag, never over-flag, and never changes a mask's shape or position), left as the next
 * step rather than guessed at here; see MasksPanel's subject alpha (`core/maskTypes.ts`) for what a
 * follow-up would thread through.
 */
export async function verifyFrameMasks(source: HTMLImageElement, frame: PhotoFrame, signal?: AbortSignal): Promise<MaskVerifyResult | null> {
  const masks = frame.edit?.masks;
  if (!masks || !hasActiveMasks(masks)) return null;
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width: fw, height: fh } = framedSize(source.naturalWidth, source.naturalHeight, framing);
  const scale = Math.min(1, MASK_VERIFY_EDGE / Math.max(fw, fh));
  const canvas = document.createElement('canvas');
  try {
    drawFramedPhoto(source, canvas, framing, { scale });
    signal?.throwIfAborted();
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || canvas.width < 16 || canvas.height < 16) return null;
    const imageEdge = Math.max(fw, fh) * scale;
    const snapshot = context.getImageData(0, 0, canvas.width, canvas.height);
    const original: Pixels = { data: new Uint8ClampedArray(snapshot.data), width: snapshot.width, height: snapshot.height };
    // Each attempt renders from a fresh copy of the unedited pixels (never the previous attempt's result),
    // the same convention runDenoise.ts's render() uses - a retry scales the ORIGINAL edit down, it does
    // not compound an already-rendered pass.
    const render = async (candidateMasks: Mask[]): Promise<Pixels> => {
      const working = document.createElement('canvas');
      working.width = original.width;
      working.height = original.height;
      const workingContext = working.getContext('2d', { willReadFrequently: true });
      if (!workingContext) throw new Error('Canvas unavailable');
      workingContext.putImageData(new ImageData(new Uint8ClampedArray(original.data), original.width, original.height), 0, 0);
      const maskOnly: PhotoEdit = { ...DEFAULT_EDIT, masks: candidateMasks };
      applyCanvasPhotoEdit(working, maskOnly, imageEdge, fullContext(working.width, working.height));
      const result = workingContext.getImageData(0, 0, working.width, working.height);
      working.width = 0;
      working.height = 0;
      return { data: result.data, width: result.width, height: result.height };
    };
    const outcome = await runMaskAction({ masks, render, original, maxRetries: 0, signal });
    signal?.throwIfAborted();
    return outcome;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Long edge of the picture the guardian looks at: the on-device model sees 512 px, so more is wasted work. */
export const MASK_GUARDIAN_EDGE = 768;

/** The words the guardian's mask questions use for this photo's subject: its name if it has one, else its kind. */
export function maskSubjectWord(frame: PhotoFrame): string | null {
  const name = frame.subjectNames?.find((entry) => entry.trim());
  if (name) return name;
  if (frame.subjectKind === 'landscape') return null;
  return frame.subjectKind === 'people' ? 'person' : frame.subjectKind === 'wildlife' ? 'animal' : 'main subject';
}

/** Identifies a subject mask's shape, so the guardian is asked once per shape, not after every slider change. */
export function subjectMaskShapeKey(frame: PhotoFrame, mask: Extract<Mask, { kind: 'subject' }>): string {
  const grid = mask.grid.data;
  return [frame.id, mask.id, mask.framingKey, grid.length, grid.slice(0, 24), grid.slice(-24), mask.strokes.length,
    JSON.stringify(mask.strokes.at(-1) ?? null).length, mask.detail ? 1 : 0, JSON.stringify(frame.framing ?? null)].join('|');
}

/**
 * Vision guardian for subject masks (owner decision 2, finish-line p3-guardian): two plain questions to the on-device
 * model about the photo with everything outside the mask darkened. "Is the bright area a bird?" catches a mask on the
 * wrong thing; "Is the whole bird inside the bright area?" catches a mask that misses wing tips, a tail or a head.
 * Advice only: true means the person should check the mask; the mask, its edit and the photo are never changed.
 * False with no model, no subject mask, no answer, agreement or doubt.
 */
export async function guardianDoubtsSubjectMask(source: HTMLImageElement, frame: PhotoFrame, mask: Extract<Mask, { kind: 'subject' }>, signal?: AbortSignal): Promise<boolean> {
  const word = maskSubjectWord(frame);
  if (!word || !hasLocalVision()) return false;
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width: fw, height: fh } = framedSize(source.naturalWidth, source.naturalHeight, framing);
  const canvas = document.createElement('canvas');
  try {
    drawFramedPhoto(source, canvas, framing, { scale: Math.min(1, MASK_GUARDIAN_EDGE / Math.max(fw, fh)) });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || canvas.width < 16 || canvas.height < 16) return false;
    const masks = frame.edit?.masks ?? [];
    const alpha = effectiveAlpha({ ...mask, invert: false }, masks, canvas.width, canvas.height, fullContext(canvas.width, canvas.height));
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    darkenOutsideMask(image.data, alpha);
    context.putImageData(image, 0, 0);
    const jpeg = await canvasJpeg(canvas);
    signal?.throwIfAborted();
    if (!jpeg) return false;
    const found = await askGuardianAbout(jpeg, 'subjectFound', word);
    signal?.throwIfAborted();
    if (found?.verdict === 'disagrees') return true;
    const whole = await askGuardianAbout(jpeg, 'maskComplete', word);
    return whole?.verdict === 'disagrees';
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
