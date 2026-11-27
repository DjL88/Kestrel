import { applyCanvasPhotoEdit } from '../../core/canvasEdit';
import { measureOnImageAdvice, type OnImageAdvice, type SubjectBox } from '../../core/onImageAdvice';
import type { PhotoEdit } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize, type PhotoFraming } from '../../core/photoFraming';

/** Advice is measured at this long edge: small enough to run in a few milliseconds, large enough to place a clip. */
const ADVICE_EDGE = 256;

/** The subject finder reports its box on the whole preview, so it is only valid while the framing leaves the picture whole. */
export const framingIsWhole = (framing: PhotoFraming | undefined): boolean => {
  const f = framing ?? DEFAULT_FRAMING;
  return f.ratio === null && f.turns === 0 && f.straighten === 0 && (f.size === undefined || f.size === 1);
};

/**
 * Measure the advice for the picture as shown: the preview framed as the photo is framed, once without the edit (the
 * measured original) and once with it, both at preview size. Null when a canvas is not available. The subject is used
 * only when the framing leaves the picture whole, otherwise the colour is left "not judged" rather than guessed.
 */
export function measureAdviceFor(image: HTMLImageElement, edit: PhotoEdit, framing: PhotoFraming | undefined, subject: SubjectBox | null): OnImageAdvice | null {
  const framingNow = framing ?? DEFAULT_FRAMING;
  const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framingNow);
  const before = document.createElement('canvas');
  try {
    drawFramedPhoto(image, before, framingNow, { scale: Math.min(1, ADVICE_EDGE / Math.max(width, height)) });
    const beforeContext = before.getContext('2d', { willReadFrequently: true });
    if (!beforeContext) return null;
    const original = beforeContext.getImageData(0, 0, before.width, before.height);
    const after = document.createElement('canvas');
    after.width = before.width; after.height = before.height;
    const afterContext = after.getContext('2d', { willReadFrequently: true });
    if (!afterContext) return null;
    afterContext.putImageData(original, 0, 0);
    applyCanvasPhotoEdit(after, edit);
    const edited = afterContext.getImageData(0, 0, after.width, after.height);
    after.width = 0; after.height = 0;
    return measureOnImageAdvice(
      { data: original.data, width: original.width, height: original.height },
      { data: edited.data, width: edited.width, height: edited.height },
      framingIsWhole(framing) ? subject : null,
    );
  } finally { before.width = 0; before.height = 0; }
}
