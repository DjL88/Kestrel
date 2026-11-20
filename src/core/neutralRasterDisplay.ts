import { isNeutralEdit, type PhotoEdit } from './photoEdits';
import type { PhotoFraming } from './photoFraming';

/** The browser can show the raster directly when the editor has no pixels or geometry to change. */
export function canShowNeutralRaster(edit: PhotoEdit, framing: PhotoFraming): boolean {
  return isNeutralEdit(edit) && framing.ratio === null && framing.turns === 0 && framing.straighten === 0
    && (framing.size ?? 1) === 1 && framing.x === 0.5 && framing.y === 0.5;
}
