import type { TiffExportMetadata } from '../core/tiffExportMetadata';
import { editRgb16, encodeTiff16, frameRgb16, master16Blocker, parseRgb16, thumbRgb16 } from '../core/master16';
import { bestTurn } from '../core/orientMatch';
import type { PhotoEdit } from '../core/photoEdits';
import { DEFAULT_FRAMING, type PhotoFraming } from '../core/photoFraming';
import { hasNativeRaw } from './desktopShell';
import { rawSensorMode, thumbOf } from './rawDevelop';
import { rawPrecisionEvidence } from './rawPrecisionGate';
import { developRaw16InBrowser } from './rawWasm';

/** The RAW file's full-size 16-bit picture from Kite44's decoder: natively on desktop, WebAssembly elsewhere. */
async function developRaw16(file: Blob): Promise<ArrayBuffer> {
  if (!hasNativeRaw()) return developRaw16InBrowser(file);
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<ArrayBuffer>('develop_raw_rgb16', new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'This RAW file could not be developed.');
  }
}

/**
 * The edited photo as a 16-bit TIFF, made from the RAW sensor data with the same edit maths as the screen. `shown` is the
 * picture the editor frames (the developed RAW, turned to match the camera's preview where that was needed), so the
 * crop lands in the same place. Refuses, in plain words, edits it cannot carry yet; never drops one.
 */
export async function exportRaw16Tiff(original: Blob, shown: HTMLImageElement, edit: PhotoEdit, framing: PhotoFraming | undefined, metadata?: TiffExportMetadata | null): Promise<Blob> {
  const blocker = master16Blocker(edit, framing);
  if (blocker) throw new Error(blocker);
  // Detect Nikon compression before allocating a full-size decoded buffer.
  // The current experimental exporter has no commercial HE/HE* clearance.
  // This is a conservative header check, not proof that every unknown mode is licensed.
  rawPrecisionEvidence(await rawSensorMode(original, 'source.nef'));
  // This is a freshly developed RGB working ArrayBuffer, not the original
  // RAW file's bytes. It can safely be edited in place on little-endian hosts
  // to avoid a second 270 MB RGB16 allocation for a 45MP image.
  const picture = parseRgb16(await developRaw16(original), true);
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
