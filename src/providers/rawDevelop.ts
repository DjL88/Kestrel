import { THUMB, bestTurn } from '../core/orientMatch';
import type { NativeRawMasterRecipe, NativeRawMasterFraming } from '../core/nativeRawMaster';
import { isDesktopApp } from './desktopShell';
import { developRawInBrowser, sensorModeInBrowser, webRawAvailable } from './rawWasm';

/** Fail closed before allocating/copying a potentially huge RAW file for native decoding. */
export function validateRawExtension(extension: string): string {
  const value = extension.toLowerCase();
  if (!/^[a-z0-9]{2,5}$/.test(value) || !new Set([
    'nef', 'nrw', 'cr2', 'cr3', 'arw', 'raf', 'rw2', 'orf', 'pef', 'dng', 'srw', '3fr',
  ]).has(value)) {
    throw new Error('This RAW file type is not supported for development. The original is unchanged.');
  }
  return value;
}

/**
 * Developing a RAW file's sensor data: natively in the desktop app, and with the same Rust pipeline compiled to
 * WebAssembly in the browser when this build carries it.
 */
export const canDevelopRaw = () => isDesktopApp() || webRawAvailable();

/** The 16-bit TIFF master and DNG copies are written by the desktop app only, for now. */
export const canExportRawMaster = () => isDesktopApp();

/**
 * Send a RAW file to the desktop app's decoder and get back the full-size developed picture as a JPEG. The original file
 * is not changed. Rejects with a plain message when the camera or compression mode cannot be read.
 */
export async function developRaw(file: Blob, extension = 'nef'): Promise<Blob> {
  // Do not silently reinterpret unknown formats (or path-like values) as a Nikon NEF or any one maker's format.
  // The native decoder independently validates its extension as a second boundary.
  const normalizedExtension = validateRawExtension(extension);
  if (!isDesktopApp()) return developRawInBrowser(file);
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await invoke<ArrayBuffer>('develop_raw', bytes, { headers: { 'x-file-extension': normalizedExtension } });
    return new Blob([result], { type: 'image/jpeg' });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'This RAW file could not be developed.');
  }
}

/**
 * Experimental: decode a RAW file straight to a 16-bit TIFF, with none of the 8-bit JPEG intermediate `developRaw` uses.
 * No colour profile is embedded yet and Nikon High Efficiency files are not covered (no system-decoder fallback here), so
 * this is offered as an extra, clearly-labelled download next to the normal editor path, not a replacement for it.
 */
export async function developRawPrecision(file: Blob): Promise<Blob> {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await invoke<ArrayBuffer>('develop_raw_precision', bytes);
    return new Blob([result], { type: 'image/tiff' });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'A 16-bit TIFF could not be produced for this RAW file.');
  }
}

/**
 * Native 16-bit TIFF POC, edited from the original sensor RAW bytes rather than
 * the 8-bit JPEG preview. Preflight unsupported adjustments before invoking.
 * No validated ICC profile or HE/HE* guarantee yet; do not call it production.
 */
export async function developRawPrecisionEdited(file: Blob, recipe: NativeRawMasterRecipe, framing: NativeRawMasterFraming): Promise<Blob> {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await invoke<ArrayBuffer>('develop_raw_precision_edited', bytes, {
      headers: { 'x-kestrel-master-edit': JSON.stringify(recipe), 'x-kestrel-master-framing': JSON.stringify(framing) },
    });
    return new Blob([result], { type: 'image/tiff' });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'Could not produce the edited 16-bit RAW master.');
  }
}

/** How a RAW's sensor data is stored, as far as decoding is concerned. */
export type RawSensorMode = 'nikon-he' | 'nikon-he-star' | 'other';

/** Enough of the file's start for its headers; the rest of a 60 MB RAW is never read for this. */
const SENSOR_MODE_PREFIX = 4 * 1024 * 1024;

/**
 * Whether a NEF is Nikon High Efficiency (HE or HE*), read from the file's headers only (natively on desktop, by the
 * WebAssembly pipeline in the browser). Anything else, or anything unreadable, is 'other': it only ever adds a label.
 */
export async function rawSensorMode(file: Blob, filename: string): Promise<RawSensorMode> {
  if (!/\.nef$/i.test(filename)) return 'other';
  if (!isDesktopApp()) return webRawAvailable() ? sensorModeInBrowser(file, SENSOR_MODE_PREFIX) : 'other';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const prefix = new Uint8Array(await file.slice(0, SENSOR_MODE_PREFIX).arrayBuffer());
    const mode = await invoke<string>('raw_sensor_mode', prefix, { headers: { 'x-file-length': String(file.size) } });
    return mode === 'nikon-he' || mode === 'nikon-he-star' ? mode : 'other';
  } catch {
    return 'other';
  }
}

/** Plain words for how a developed picture was made from the sensor data. */
export function sensorModeLabel(mode: RawSensorMode): string | null {
  if (mode === 'nikon-he') return 'Nikon High Efficiency';
  if (mode === 'nikon-he-star') return 'Nikon High Efficiency*';
  return null;
}

/**
 * A lossless DNG of a Nikon High Efficiency NEF's sensor data, made by the desktop app's own decoder. The original is
 * only read. Rejects in plain words for files that need no copy (other NEF modes and makers already open everywhere).
 */
export async function rawDngCopy(file: Blob): Promise<Blob> {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await invoke<ArrayBuffer>('raw_dng_copy', bytes);
    return new Blob([result], { type: 'image/x-adobe-dng' });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'A DNG copy could not be made from this RAW file.');
  }
}

async function thumbOf(bitmap: ImageBitmap): Promise<Float32Array> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB; canvas.height = THUMB;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, THUMB, THUMB);
  const { data } = context.getImageData(0, 0, THUMB, THUMB);
  const out = new Float32Array(THUMB * THUMB);
  for (let i = 0; i < out.length; i += 1) out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return out;
}

/**
 * Turn a developed picture to match the camera's own preview. The sensor data is stored sideways-on and some cameras'
 * rotation flags say "normal" for an upright-portrait photo, so the preview, which the camera rotated, is the guide.
 * Returns the picture untouched when it already matches or there is no preview to compare with.
 */
export async function matchPreviewOrientation(developed: Blob, preview: Blob | null): Promise<Blob> {
  // Validate the decoder output before the editor replaces its current source.
  let picture: ImageBitmap;
  try {
    picture = await createImageBitmap(developed);
  } catch {
    throw new Error('The developed RAW picture could not be opened.');
  }

  let guide: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (!preview) return developed;
    guide = await createImageBitmap(preview);
    const turn = bestTurn(
      { thumb: await thumbOf(guide), portrait: guide.height > guide.width },
      { thumb: await thumbOf(picture), portrait: picture.height > picture.width },
    );
    if (turn === 0) return developed;
    canvas = document.createElement('canvas');
    const sideways = turn === 90 || turn === 270;
    canvas.width = sideways ? picture.height : picture.width;
    canvas.height = sideways ? picture.width : picture.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the orientation canvas.');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((turn * Math.PI) / 180);
    context.drawImage(picture, -picture.width / 2, -picture.height / 2);
    const target = canvas;
    const rotated = await new Promise<Blob | null>((resolve) => target.toBlob(resolve, 'image/jpeg', 0.95));
    if (!rotated || rotated.type !== 'image/jpeg' || rotated.size === 0) throw new Error('Could not encode the oriented picture.');
    return rotated;
  } catch (error) {
    // Orientation matching is optional once the full-size picture is readable.
    console.warn('RAW orientation matching failed; keeping the decoded orientation.', error);
    return developed;
  } finally {
    guide?.close();
    picture.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
