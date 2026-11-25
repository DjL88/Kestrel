import type { TiffExportMetadata } from '../core/tiffExportMetadata';
import { editRgb16, encodeTiff16, frameRgb16, master16Blocker, shrinkRgb16, thumbRgb16, type Rgb16Image } from '../core/master16';
import { bestTurn } from '../core/orientMatch';
import type { PhotoEdit } from '../core/photoEdits';
import { DEFAULT_FRAMING, lensCentre, type PhotoFraming } from '../core/photoFraming';
import { encodePng16, provePng } from '../core/png16';
import { thumbOf } from './rawDevelop';
import { openSensorWorkingRaster } from './rawWorkingRaster';

/**
 * The edited photo at 16 bits per channel, made from the RAW sensor data with the same edit maths as the screen. `shown`
 * is the picture the editor frames (the developed RAW, turned to match the camera's preview where that was needed), so
 * the crop lands in the same place. Refuses, in plain words, edits it cannot carry yet; never drops one. No 8-bit step.
 */
export async function renderRaw16(original: Blob, filename: string, shown: HTMLImageElement, edit: PhotoEdit, framing: PhotoFraming | undefined, options?: { originalSha256: string; signal?: AbortSignal }): Promise<Rgb16Image> {
  options?.signal?.throwIfAborted();
  const blocker = master16Blocker(edit, framing);
  if (blocker) throw new Error(blocker);
  const { image: picture } = await openSensorWorkingRaster(original, filename, undefined, options?.originalSha256);
  options?.signal?.throwIfAborted();
  const turn = await turnToShown(picture, shown);
  // If both framing and orientation are identity, reuse the working picture.
  // A real crop, quarter-turn or straighten still allocates its own result.
  options?.signal?.throwIfAborted();
  const framed = frameRgb16(picture, framing ?? DEFAULT_FRAMING, turn / 90, true);
  editRgb16(framed, edit, lensCentre(picture.width, picture.height, framing ?? DEFAULT_FRAMING, turn / 90));
  return framed;
}

/** The quarter turn that puts the sensor picture the way the editor shows it; throws if they are not the same photo. */
async function turnToShown(picture: Rgb16Image, shown: HTMLImageElement): Promise<number> {
  const bitmap = await createImageBitmap(shown);
  try {
    const shownPortrait = bitmap.height > bitmap.width;
    // Same shape as the editor's picture or a quarter turn of it; anything else is not the same photo.
    const sameShape = Math.abs(bitmap.width / bitmap.height - picture.width / picture.height) < 0.02;
    const turnedShape = Math.abs(bitmap.width / bitmap.height - picture.height / picture.width) < 0.02;
    if (!sameShape && !turnedShape) throw new Error('The RAW sensor data does not match the picture being edited, so no 16-bit file was made.');
    let turn = bestTurn({ thumb: await thumbOf(bitmap), portrait: shownPortrait }, { thumb: thumbRgb16(picture), portrait: picture.height > picture.width });
    if (turnedShape && !sameShape && turn % 180 === 0) turn = 90;
    return turn;
  } finally {
    bitmap.close();
  }
}

/** A small 16-bit copy of the RAW develop, kept while a photo is open so its histogram can be measured at 16 bits. */
export interface Raw16Working {
  picture: Rgb16Image;
  turn: number;
}

/** Develop the RAW at 16 bits once and keep a measuring-size copy (longest edge maxEdge). Same checks as renderRaw16. */
export async function openRaw16Working(original: Blob, filename: string, shown: HTMLImageElement, maxEdge = 512, options?: { originalSha256: string; signal?: AbortSignal }): Promise<Raw16Working> {
  options?.signal?.throwIfAborted();
  const { image: full } = await openSensorWorkingRaster(original, filename, undefined, options?.originalSha256);
  options?.signal?.throwIfAborted();
  const turn = await turnToShown(full, shown);
  return { picture: shrinkRgb16(full, maxEdge), turn };
}

/** The kept copy with this edit and framing applied, by the same 16-bit maths as the export; null when an edit cannot be carried at 16 bits yet. */
export function renderRaw16Working(working: Raw16Working, edit: PhotoEdit, framing: PhotoFraming | undefined): Rgb16Image | null {
  if (master16Blocker(edit, framing)) return null;
  const { picture, turn } = working;
  const framed = frameRgb16({ ...picture, data: picture.data.slice() }, framing ?? DEFAULT_FRAMING, turn / 90, true);
  editRgb16(framed, edit, lensCentre(picture.width, picture.height, framing ?? DEFAULT_FRAMING, turn / 90));
  return framed;
}

/** The edited photo as a 16-bit TIFF (see renderRaw16). */
export async function exportRaw16Tiff(original: Blob, filename: string, shown: HTMLImageElement, edit: PhotoEdit, framing: PhotoFraming | undefined, metadata?: TiffExportMetadata | null, options?: { originalSha256: string; signal?: AbortSignal }): Promise<Blob> {
  return encodeTiff16(await renderRaw16(original, filename, shown, edit, framing, options), metadata);
}

/** The edited photo as a 16-bit PNG (see renderRaw16), read back and refused unless it really is 16-bit RGB. */
export async function exportRaw16Png(original: Blob, filename: string, shown: HTMLImageElement, edit: PhotoEdit, framing: PhotoFraming | undefined, options?: { originalSha256: string; signal?: AbortSignal }): Promise<Blob> {
  const image = await renderRaw16(original, filename, shown, edit, framing, options);
  options?.signal?.throwIfAborted();
  const png = await encodePng16(image);
  const proof = provePng(await png.arrayBuffer());
  if (proof.bitDepth !== 16 || proof.colourType !== 2 || proof.width !== image.width || proof.height !== image.height)
    throw new Error('The PNG was not written as full-size 16-bit RGB, so it was not saved.');
  return png;
}
