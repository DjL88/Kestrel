import { THUMB, bestTurn } from '../core/orientMatch';
import { proveTiff16 } from '../core/tiff16Proof';
import type { NativeRawMasterRecipe, NativeRawMasterFraming } from '../core/nativeRawMaster';
import { hasNativeRaw } from './desktopShell';
import { developRawInBrowser, inspectSensorModeInBrowser, sensorModeInBrowser, webRawAvailable } from './rawWasm';

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
 * Developing a RAW file's sensor data. One decoder everywhere (crates/kestrel-raw, Nikon HE/HE* included): linked
 * natively into the desktop app, and the same Rust code compiled to WebAssembly in the browser and on phones and
 * tablets. The operating system's own decoder is only a last resort on a Mac, after InFlight's has failed.
 */
export const canDevelopRaw = () => hasNativeRaw() || webRawAvailable();

/** The 16-bit TIFF master and DNG copies are written by the desktop app only, for now. */
export const canExportRawMaster = () => hasNativeRaw();

/**
 * Send a RAW file to the desktop app's decoder and get back the full-size developed picture as a JPEG. The original file
 * is not changed. Rejects with a plain message when the camera or compression mode cannot be read.
 */
export async function developRaw(file: Blob, extension = 'nef'): Promise<Blob> {
  // Do not silently reinterpret unknown formats (or path-like values) as a Nikon NEF or any one maker's format.
  // The native decoder independently validates its extension as a second boundary.
  const normalizedExtension = validateRawExtension(extension);
  if (!hasNativeRaw()) return developRawInBrowser(file);
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
 * Decode the sensor-derived RGB16 working raster, rather than the JPEG used by
 * the legacy review/editor route. The same InFlight Rust decoder runs through
 * Tauri on desktop and WASM on web; platform codec support is NOT guaranteed.
 * The returned buffer is display-encoded RGB16, not a verified linear camera
 * master. Consumers must separately verify original hash, colour evidence and
 * HE/HE* distribution rights before promoting it to an archival master.
 * Caller owns this scratch buffer; original RAW bytes are never modified.
 */
export async function developRawRgb16(file: Blob): Promise<ArrayBuffer> {
  const { parseRgb16 } = await import('../core/master16');
  let picture: ArrayBuffer;
  if (!hasNativeRaw()) {
    const { developRaw16InBrowser } = await import('./rawWasm');
    picture = await developRaw16InBrowser(file);
  } else {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      picture = await invoke<ArrayBuffer>('develop_raw_rgb16', new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      throw new Error(typeof error === 'string' ? error : 'This RAW file could not be developed.');
    }
  }
  parseRgb16(picture, true); // Validate the decoder's fresh buffer in place when possible.
  return picture;
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
    proveTiff16(result); // Structural proof only; sensor/colour/rights require separate evidence.
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
    proveTiff16(result); // Never offer a malformed or 8-bit output as a precision TIFF.
    return new Blob([result], { type: 'image/tiff' });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'Could not produce the edited 16-bit RAW master.');
  }
}

/** How a RAW's sensor data is stored, as far as decoding is concerned. */
export type RawSensorMode = 'nikon-he' | 'nikon-he-star' | 'other';

/** Enough of the file's start for its headers; the rest of a 60 MB RAW is never read for this. */
const SENSOR_MODE_PREFIX = 4 * 1024 * 1024;
/** Never read more than this for the check; the headers of every body tested sit within 8 MiB. */
const SENSOR_MODE_LIMIT = 64 * 1024 * 1024;

/** Ask with 4 MiB, then twice as much each time the headers run further, up to the limit or the whole file. */
async function stepwise(file: Blob, ask: (prefixBytes: number) => Promise<string>): Promise<RawSensorMode> {
  for (let bytes = SENSOR_MODE_PREFIX; ; bytes *= 2) {
    const mode = await ask(Math.min(bytes, file.size));
    if (mode === 'nikon-he' || mode === 'nikon-he-star') return mode;
    if (mode !== 'need-more' || bytes >= file.size || bytes >= SENSOR_MODE_LIMIT) return 'other';
  }
}

/**
 * Whether a NEF is Nikon High Efficiency (HE or HE*), read from the file's headers only (natively on desktop, by the
 * WebAssembly pipeline in the browser). Anything else, or anything unreadable, is 'other': it only ever adds a label.
 */
export async function rawSensorMode(file: Blob, filename: string): Promise<RawSensorMode> {
  if (!/\.nef$/i.test(filename)) return 'other';
  if (!hasNativeRaw()) return webRawAvailable() ? stepwise(file, (bytes) => sensorModeInBrowser(file, bytes)) : 'other';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await stepwise(file, async (bytes) => invoke<string>('raw_sensor_mode', new Uint8Array(await file.slice(0, bytes).arrayBuffer()),
      { headers: { 'x-file-length': String(file.size) } }));
  } catch {
    return 'other';
  }
}

/**
 * Strict preflight for experimental Nikon precision output. Unlike rawSensorMode,
 * an incomplete/unavailable header inspection is never interpreted as a verified
 * non-HE NEF. A positive 'other' answer only means the decoder inspected enough
 * header bytes to classify the compression; it is not a licence grant.
 */
export async function verifiedNikonSensorMode(
  file: Blob,
  ask: (prefix: number) => Promise<string>,
): Promise<RawSensorMode | 'unknown'> {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return 'unknown';
  for (let bytes = SENSOR_MODE_PREFIX; ; bytes *= 2) {
    const length = Math.min(bytes, file.size);
    let mode: string;
    try {
      mode = await ask(length);
    } catch {
      return 'unknown';
    }
    if (mode === 'nikon-he' || mode === 'nikon-he-star' || mode === 'other') return mode;
    if (mode !== 'need-more' || length === file.size || length >= SENSOR_MODE_LIMIT) return 'unknown';
  }
}

/** Fail closed if a Nikon compression header cannot be positively classified. */
export async function requireVerifiedNikonPrecisionMode(file: Blob): Promise<void> {
  if (!hasNativeRaw() && !webRawAvailable()) {
    throw new Error('Nikon RAW compression could not be verified; no precision export was made.');
  }
  const ask = !hasNativeRaw()
    ? (bytes: number) => inspectSensorModeInBrowser(file, bytes)
    : async (bytes: number) => {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<string>('raw_sensor_mode', new Uint8Array(await file.slice(0, bytes).arrayBuffer()),
        { headers: { 'x-file-length': String(file.size) } });
    };
  const mode = await verifiedNikonSensorMode(file, ask);
  if (mode !== 'other') {
    throw new Error(mode === 'unknown'
      ? 'Nikon RAW compression could not be verified; no precision export was made.'
      : 'Nikon HE/HE* precision export requires separate commercial codec clearance.');
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

export async function thumbOf(bitmap: ImageBitmap): Promise<Float32Array> {
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
