import { isNeutralEdit, type PhotoEdit } from './photoEdits';
import { cropRectangle, type PhotoFraming } from './photoFraming';

/**
 * "Never worse than the original before editing" (ROADMAP K.1).
 *
 * With nothing changed, the large view shows the decoded original itself (the browser's own colour-managed, full-size
 * picture) instead of a redrawn copy. A redrawn copy is capped in size for speed and, on most browsers, squeezed into
 * sRGB, so it can only ever match the original or look worse. As soon as anything changes the pixels (an edit, a crop,
 * a turn or straightening) the processed picture is shown instead.
 */
export function showsOriginalPixels(edit: PhotoEdit | null | undefined, framing: PhotoFraming, size: { width: number; height: number }): boolean {
  if (edit && !isNeutralEdit(edit)) return false;
  return isIdentityFraming(framing, size);
}

/** True when the framing leaves every pixel where it is: no turn, no straightening, and the crop is the whole photo. */
export function isIdentityFraming(framing: PhotoFraming, size: { width: number; height: number }): boolean {
  if (framing.turns % 4 !== 0 || framing.straighten !== 0) return false;
  if (!(size.width > 0 && size.height > 0)) return false;
  const crop = cropRectangle(size.width, size.height, framing);
  return crop.x === 0 && crop.y === 0 && crop.width === size.width && crop.height === size.height;
}

export type CanvasColourSpace = 'srgb' | 'display-p3';

/**
 * Which colour space the editor's screen canvases use. Display P3 only where the browser can draw in it and the screen
 * can show it; everywhere else stays sRGB, exactly as before. The edit maths is unchanged: Display P3 uses the same
 * tone curve as sRGB, so the sliders behave the same and wide-gamut colours are simply not clipped first.
 */
export function canvasColourSpace(support: { p3Canvas: boolean; wideGamutScreen: boolean }): CanvasColourSpace {
  return support.p3Canvas && support.wideGamutScreen ? 'display-p3' : 'srgb';
}
