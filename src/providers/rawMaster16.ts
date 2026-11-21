import type { TiffExportMetadata } from '../core/tiffExportMetadata';
import { editRgb16, encodeTiff16, frameRgb16, master16Blocker, thumbRgb16 } from '../core/master16';
import { bestTurn } from '../core/orientMatch';
import type { PhotoEdit } from '../core/photoEdits';
import { DEFAULT_FRAMING, type PhotoFraming } from '../core/photoFraming';
import { thumbOf } from './rawDevelop';
import { openSensorWorkingRaster } from './rawWorkingRaster';

/**
 * The edited photo as a 16-bit TIFF, made from the RAW sensor data with the same edit maths as the screen. `shown` is the
 * picture the editor frames (the developed RAW, turned to match the camera's preview where that was needed), so the
 * crop lands in the same place. Refuses, in plain words, edits it cannot carry yet; never drops one.
 */
export async function exportRaw16Tiff(original: Blob, filename: string, shown: HTMLImageElement, edit: PhotoEdit, framing: PhotoFraming | undefined, metadata?: TiffExportMetadata | null): Promise<Blob> {
  const blocker = master16Blocker(edit, framing);
  if (blocker) throw new Error(blocker);
  const { image: picture } = await openSensorWorkingRaster(original, filename);
  const bitmap = await createImageBitmap(shown);
  let turn: number;
  try {
    const shownPortrait = bitmap.height > bitmap.width;
    // Same shape as the editor's picture or a quarter turn of it; anything else is not the same photo.
    const sameShape = Math.abs(bitmap.width / bitmap.height - picture.width / picture.height) < 0.02;
    const turnedShape = Math.abs(bitmap.width / bitmap.height - picture.height / picture.width) < 0.02;
    if (!sameShape && !turnedShape) throw new Error('The RAW sensor data does not match the picture being edited, so no TIFF was made.');
    turn = bestTurn({ thumb: await thumbOf(bitmap), portrait: shownPortrait }, { thumb: thumbRgb16(picture), portrait: picture.height > picture.width });
    if (turnedShape && !sameShape && turn % 180 === 0) turn = 90;
  } finally {
    bitmap.close();
  }
  // If both framing and orientation are identity, reuse the working picture.
  // A real crop, quarter-turn or straighten still allocates its own result.
  const framed = frameRgb16(picture, framing ?? DEFAULT_FRAMING, turn / 90, true);
  editRgb16(framed, edit);
  return encodeTiff16(framed, metadata);
}
