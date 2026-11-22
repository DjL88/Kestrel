import type { Pixels } from '../core/colourCheck';
import type { Mask } from '../core/maskTypes';

/**
 * The wire format for a cloud processing job's uploaded input and downloaded result
 * (`docs/CLOUD-ENGINE-CONTRACT.md` calls this out as still unagreed: "Build the runner image and agree the
 * per-capability payload and output formats with its local verifier"). This module IS that agreement for
 * `denoise` and `mask` - `upscale` is deliberately not covered yet, see `cloudProcessingAttempt.ts`.
 *
 * Pure, dependency-free framing so it can be unit-tested in plain Node (no canvas, no DOM, no PNG codec):
 * a 4-byte big-endian header length, then a UTF-8 JSON header, then one or more fixed-size binary planes
 * whose sizes are derivable from the header's own `width`/`height` - so a decoder never has to guess where
 * one plane ends and the next begins. Pixel planes are raw RGBA8 (`Pixels.data`, uncompressed) rather than
 * a real image codec - larger on the wire than PNG/WebP would be, but needs no browser Canvas API and
 * nothing that only exists in a browser, keeping this module testable anywhere. A real deployment may want
 * to compress the planes before upload; that is a transport-level concern layered on top of this framing,
 * not a reason to change it.
 *
 * IMPORTANT: this format is only "real" once a Cloud Run runner image is built that reads it the same way.
 * Nothing in this repository builds that image - it is out of scope here (separate backend/infra work).
 * Until that exists, encoding/decoding against this format is internally consistent but not yet exercised
 * against a real external processor.
 */

export const CLOUD_JOB_PROTOCOL_VERSION = 1;

export type CloudJobCapability = 'denoise' | 'mask';

export interface CloudUploadHeader {
  protocol: typeof CLOUD_JOB_PROTOCOL_VERSION;
  capability: CloudJobCapability;
  width: number;
  height: number;
  /** Present only for `capability: 'denoise'`. */
  backgroundDenoise?: number;
  subjectDenoise?: number;
  /** Present only for `capability: 'mask'`. Already plain JSON-serialisable data - no functions, no
   * binary fields - so it travels in the header verbatim; nothing is re-derived or guessed here. */
  masks?: Mask[];
  /** True when a subject alpha plane follows the original pixel plane on the wire (used by either
   * capability to let the runner, and later the local verifier, judge the subject separately). */
  hasSubjectAlpha: boolean;
}

export interface CloudResultHeader {
  protocol: typeof CLOUD_JOB_PROTOCOL_VERSION;
  capability: CloudJobCapability;
  width: number;
  height: number;
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** Splits a framed buffer into its JSON header and the concatenated binary planes that follow it. Throws
 * on anything that does not parse as this exact framing - never returns a partially-read result. */
function splitFrame(bytes: Uint8Array): { header: unknown; planes: Uint8Array } {
  if (bytes.length < 4) throw new Error('Cloud job data is too short to contain a header.');
  const headerLength = readU32be(bytes, 0);
  if (headerLength < 2 || 4 + headerLength > bytes.length) throw new Error('Cloud job header length is invalid.');
  const headerText = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + headerLength));
  let header: unknown;
  try { header = JSON.parse(headerText); } catch { throw new Error('Cloud job header is not valid JSON.'); }
  return { header, planes: bytes.subarray(4 + headerLength) };
}

function frame(header: object, planes: Uint8Array[]): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  return concat([u32be(headerBytes.length), headerBytes, ...planes]);
}

function checkDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Cloud job pixel dimensions are invalid.');
  }
}

/** Builds the bytes to upload for a denoise job. `subjectAlpha`, when given, must be the same width*height
 * as `original` (one value per pixel). */
export function encodeDenoiseUpload(
  original: Pixels,
  backgroundDenoise: number,
  subjectDenoise?: number,
  subjectAlpha?: Float32Array,
): Uint8Array {
  checkDimensions(original.width, original.height);
  const pixelCount = original.width * original.height;
  if (original.data.length !== pixelCount * 4) throw new Error('Original pixel buffer does not match its own width/height.');
  if (subjectAlpha && subjectAlpha.length !== pixelCount) throw new Error('Subject alpha does not match the original image size.');
  const header: CloudUploadHeader = {
    protocol: CLOUD_JOB_PROTOCOL_VERSION,
    capability: 'denoise',
    width: original.width,
    height: original.height,
    backgroundDenoise,
    subjectDenoise,
    hasSubjectAlpha: Boolean(subjectAlpha),
  };
  const planes = [new Uint8Array(original.data.buffer, original.data.byteOffset, original.data.byteLength)];
  if (subjectAlpha) planes.push(new Uint8Array(subjectAlpha.buffer, subjectAlpha.byteOffset, subjectAlpha.byteLength));
  return frame(header, planes);
}

/** Builds the bytes to upload for a mask job. `masks` travels as plain data in the header - it is already
 * JSON-serialisable (see `Mask` in `core/maskTypes.ts`); nothing is re-encoded. */
export function encodeMaskUpload(original: Pixels, masks: Mask[], subjectAlpha?: Float32Array): Uint8Array {
  checkDimensions(original.width, original.height);
  const pixelCount = original.width * original.height;
  if (original.data.length !== pixelCount * 4) throw new Error('Original pixel buffer does not match its own width/height.');
  if (subjectAlpha && subjectAlpha.length !== pixelCount) throw new Error('Subject alpha does not match the original image size.');
  const header: CloudUploadHeader = {
    protocol: CLOUD_JOB_PROTOCOL_VERSION,
    capability: 'mask',
    width: original.width,
    height: original.height,
    masks,
    hasSubjectAlpha: Boolean(subjectAlpha),
  };
  const planes = [new Uint8Array(original.data.buffer, original.data.byteOffset, original.data.byteLength)];
  if (subjectAlpha) planes.push(new Uint8Array(subjectAlpha.buffer, subjectAlpha.byteOffset, subjectAlpha.byteLength));
  return frame(header, planes);
}

/** Reads back an upload this module framed - used by its own tests, and by anything standing in for the
 * (not-yet-built) runner image that needs to parse what the client actually sent. */
export function decodeUpload(bytes: Uint8Array): {
  header: CloudUploadHeader;
  original: Pixels;
  subjectAlpha?: Float32Array;
} {
  const { header, planes } = splitFrame(bytes);
  const h = header as CloudUploadHeader;
  if (h.protocol !== CLOUD_JOB_PROTOCOL_VERSION) throw new Error(`Unsupported cloud job protocol version: ${String((header as { protocol?: unknown })?.protocol)}.`);
  if (h.capability !== 'denoise' && h.capability !== 'mask') throw new Error(`Unsupported cloud job capability: ${String((header as { capability?: unknown })?.capability)}.`);
  checkDimensions(h.width, h.height);
  const pixelCount = h.width * h.height;
  const pixelBytes = pixelCount * 4;
  if (planes.length < pixelBytes) throw new Error('Cloud job data is shorter than its declared image.');
  const data = new Uint8ClampedArray(planes.slice(0, pixelBytes));
  const original: Pixels = { data, width: h.width, height: h.height };
  let subjectAlpha: Float32Array | undefined;
  if (h.hasSubjectAlpha) {
    const alphaBytes = pixelCount * 4; // Float32
    if (planes.length < pixelBytes + alphaBytes) throw new Error('Cloud job data is missing its declared subject alpha plane.');
    const alphaSlice = planes.slice(pixelBytes, pixelBytes + alphaBytes);
    subjectAlpha = new Float32Array(alphaSlice.buffer, alphaSlice.byteOffset, pixelCount);
  }
  return { header: h, original, subjectAlpha };
}

/** Builds the bytes a runner would return as a job's result. */
export function encodeResult(capability: CloudJobCapability, picture: Pixels): Uint8Array {
  checkDimensions(picture.width, picture.height);
  if (picture.data.length !== picture.width * picture.height * 4) throw new Error('Result pixel buffer does not match its own width/height.');
  const header: CloudResultHeader = { protocol: CLOUD_JOB_PROTOCOL_VERSION, capability, width: picture.width, height: picture.height };
  return frame(header, [new Uint8Array(picture.data.buffer, picture.data.byteOffset, picture.data.byteLength)]);
}

/** Reads back a job's result bytes. The caller must still separately verify the decoded picture before
 * trusting it - this function only parses the framing, it does not judge whether the picture is good. */
export function decodeResult(bytes: Uint8Array): { header: CloudResultHeader; picture: Pixels } {
  const { header, planes } = splitFrame(bytes);
  const h = header as CloudResultHeader;
  if (h.protocol !== CLOUD_JOB_PROTOCOL_VERSION) throw new Error(`Unsupported cloud job protocol version: ${String((header as { protocol?: unknown })?.protocol)}.`);
  if (h.capability !== 'denoise' && h.capability !== 'mask') throw new Error(`Unsupported cloud job capability: ${String((header as { capability?: unknown })?.capability)}.`);
  checkDimensions(h.width, h.height);
  const pixelBytes = h.width * h.height * 4;
  if (planes.length < pixelBytes) throw new Error('Cloud job result is shorter than its declared image.');
  const data = new Uint8ClampedArray(planes.slice(0, pixelBytes));
  return { header: h, picture: { data, width: h.width, height: h.height } };
}
