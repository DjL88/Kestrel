import { applyDetailRgb16, applyPhotoEditLinear, detailParams, hasDetail, isNeutralTone, type PhotoEdit } from './photoEdits';
import { cropRectangle, rotationCoverage, type PhotoFraming } from './photoFraming';
import { THUMB, type Thumb } from './orientMatch';
import { LOCAL_KEYS, validMasks, type Mask } from './maskTypes';
import { effectiveAlpha } from './masks';
import { noiseStrength } from './noiseReduction';
import { denoiseChromaRgb16 } from './chromaDenoise16';

/**
 * Kestrel's 16-bit export. The RAW decoder's full-size 16-bit picture (display-encoded sRGB, as it was before the editor's
 * 8-bit JPEG was made from it) goes through the same edit maths as the screen, and is written as a 16-bit TIFF. Pure:
 * the same code on desktop, web and phones.
 */
export interface Rgb16Image {
  width: number;
  height: number;
  /** R, G, B per pixel, row by row, 0 to 65535. */
  data: Uint16Array;
}

/** Read the decoder's layout: width/height (u32), then RGB samples (u16), little-endian.
 * By default the returned image owns a copy to keep existing callers isolated.
 * shareFreshDecoderBuffer is only for the newly developed, owned working
 * ArrayBuffer (NOT an original RAW file): it avoids copying an entire 45MP
 * RGB16 frame when the platform is little-endian. The export is allowed to
 * edit that working buffer in place. Big-endian hosts always copy.
 */
export function parseRgb16(buffer: ArrayBuffer, shareFreshDecoderBuffer = false): Rgb16Image {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8) throw new Error('The 16-bit picture is empty.');
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  // Reject corrupt or hostile dimensions before constructing a large typed array.
  // 80 MP is the same hard ceiling as the 16-bit denoiser; a valid 45 MP Z8
  // frame remains supported. The byte-length equality also rejects trailing
  // payloads that could otherwise be mistaken for a different photo.
  const pixels = width * height;
  if (!width || !height || !Number.isSafeInteger(pixels) || pixels > 80_000_000 ||
      buffer.byteLength !== 8 + pixels * 6) {
    throw new Error('The 16-bit picture has invalid dimensions or incomplete pixel data.');
  }
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (shareFreshDecoderBuffer && littleEndian) {
    return { width, height, data: new Uint16Array(buffer, 8, width * height * 3) };
  }
  const data = new Uint16Array(width * height * 3);
  if (littleEndian) data.set(new Uint16Array(buffer, 8, width * height * 3));
  else for (let i = 0; i < data.length; i += 1) data[i] = view.getUint16(8 + i * 2, true);
  return { width, height, data };
}

/** A THUMB x THUMB greyscale copy (0 to 255), to compare with the picture the editor shows (see `bestTurn`). */
export function thumbRgb16(image: Rgb16Image): Thumb {
  const sums = new Float64Array(THUMB * THUMB);
  const counts = new Uint32Array(THUMB * THUMB);
  const stepY = Math.max(1, Math.floor(image.height / (THUMB * 8)));
  const stepX = Math.max(1, Math.floor(image.width / (THUMB * 8)));
  for (let y = 0; y < image.height; y += stepY) {
    const ty = Math.min(THUMB - 1, Math.floor(y * THUMB / image.height));
    for (let x = 0; x < image.width; x += stepX) {
      const i = (y * image.width + x) * 3;
      const cell = ty * THUMB + Math.min(THUMB - 1, Math.floor(x * THUMB / image.width));
      sums[cell] += (0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]) / 257;
      counts[cell] += 1;
    }
  }
  return Float32Array.from(sums, (sum, cell) => counts[cell] ? sum / counts[cell] : 0);
}

/** Why this edit cannot go through the 16-bit export yet, in plain words, or null when it can. */
const EXPORT_EDIT_KEYS = new Set([
  'exposure', 'warmth', 'colour', 'brightness', 'contrast', 'highlights',
  'shadows', 'whites', 'blacks', 'vibrance', 'texture', 'clarity',
  'sharpen', 'denoise', 'masks',
]);

/** Stop rather than quietly export a future or malformed edit that this
 * high-precision renderer cannot faithfully reproduce. */
export function master16Blocker(edit: PhotoEdit | undefined, framing: PhotoFraming | undefined): string | null {
  if (edit) {
    for (const key of Object.keys(edit)) {
      if (!EXPORT_EDIT_KEYS.has(key)) return `The 16-bit TIFF cannot include the "${key}" adjustment yet.`;
    }
    // Saved projects can contain values from older versions or corrupted JSON.
    // A NaN/Infinity or non-number must never silently become black/white
    // archival pixels in a purportedly faithful 16-bit master.
    for (const key of EXPORT_EDIT_KEYS) {
      if (key === 'masks') continue;
      const value = edit[key as keyof PhotoEdit];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
        return `The saved "${key}" adjustment is invalid, so no 16-bit TIFF was made.`;
      }
    }
    if (edit.masks !== undefined && !validMasks(edit.masks)) {
      return 'One or more saved masks could not be safely included in the 16-bit TIFF.';
    }
  }
  if (framing && (
    !Number.isInteger(framing.turns) || !Number.isFinite(framing.straighten) ||
    !Number.isFinite(framing.x) || !Number.isFinite(framing.y) ||
    (framing.ratio !== null && (!(framing.ratio > 0) || !Number.isFinite(framing.ratio))) ||
    (framing.size !== undefined && (!(framing.size > 0) || !Number.isFinite(framing.size)))
  )) return 'The saved crop or rotation is invalid, so no 16-bit TIFF was made.';
  return null;
}

/**
 * Rotate the sensor-derived picture to match the editor, apply straightening
 * with the preview's centre/coverage geometry, then cut the saved crop.
 * A neutral straighten retains the original exact integer sample mapping.
 * Non-zero straighten inverse-samples the decoded 16-bit pixels bilinearly;
 * it neither goes through an 8-bit canvas nor allocates a rotated full frame.
 * extraTurns first aligns the RAW to the picture the editor shows.
 */
export function frameRgb16(image: Rgb16Image, framing: PhotoFraming, extraTurns = 0, reuseIdentity = false): Rgb16Image {
  const turns = (((framing.turns + extraTurns) % 4) + 4) % 4;
  const sideways = turns % 2 === 1;
  const width = sideways ? image.height : image.width;
  const height = sideways ? image.width : image.height;
  const crop = cropRectangle(width, height, framing);
  // Only the export path opts in: its source is a freshly decoded scratch
  // buffer that no other UI or persistent store can observe. No crop, turn,
  // straighten or dimension change means there is nothing to resample; keep
  // the source's 16-bit pixels in place and avoid a whole-frame copy.
  if (reuseIdentity && turns === 0 && Math.abs(framing.straighten) <= 1e-6 &&
      crop.x === 0 && crop.y === 0 && crop.width === image.width && crop.height === image.height) {
    return image;
  }
  const out = new Uint16Array(crop.width * crop.height * 3);
  const { width: w, height: h, data } = image;
  const straighten = Math.abs(framing.straighten) > 1e-6;
  const angle = framing.straighten * Math.PI / 180;
  const coverage = straighten ? rotationCoverage(width, height, angle) : 1;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let y = 0; y < crop.height; y += 1) {
    const ty = crop.y + y;
    for (let x = 0; x < crop.width; x += 1) {
      const tx = crop.x + x;
      // Where this turned pixel comes from in the picture as decoded.
      const sx = turns === 0 ? tx : turns === 1 ? ty : turns === 2 ? w - 1 - tx : w - 1 - ty;
      const sy = turns === 0 ? ty : turns === 1 ? h - 1 - tx : turns === 2 ? h - 1 - ty : tx;
      const from = (sy * w + sx) * 3;
      const to = (y * crop.width + x) * 3;
      if (!straighten) {
        out[to] = data[from];
        out[to + 1] = data[from + 1];
        out[to + 2] = data[from + 2];
        continue;
      }
      // A destination pixel centre, in the rotated-but-uncropped canvas.
      // Inverse of drawFramedPhoto's rotate(angle) and scale(coverage).
      const dx = tx + 0.5 - width / 2;
      const dy = ty + 0.5 - height / 2;
      const px = (cos * dx + sin * dy) / coverage + width / 2 - 0.5;
      const py = (-sin * dx + cos * dy) / coverage + height / 2 - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(px)));
      const y0 = Math.max(0, Math.min(height - 1, Math.floor(py)));
      const x1 = Math.max(0, Math.min(width - 1, x0 + 1));
      const y1 = Math.max(0, Math.min(height - 1, y0 + 1));
      const fx = Math.max(0, Math.min(1, px - x0));
      const fy = Math.max(0, Math.min(1, py - y0));
      const xy = (xx: number, yy: number) => {
        const a = turns === 0 ? xx : turns === 1 ? yy : turns === 2 ? w - 1 - xx : w - 1 - yy;
        const b = turns === 0 ? yy : turns === 1 ? h - 1 - xx : turns === 2 ? h - 1 - yy : xx;
        return (b * w + a) * 3;
      };
      const topLeft = xy(x0, y0), topRight = xy(x1, y0);
      const bottomLeft = xy(x0, y1), bottomRight = xy(x1, y1);
      for (let c = 0; c < 3; c++) {
        const top = data[topLeft + c] * (1 - fx) + data[topRight + c] * fx;
        const bottom = data[bottomLeft + c] * (1 - fx) + data[bottomRight + c] * fx;
        out[to + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return { width: crop.width, height: crop.height, data: out };
}

const TO_LINEAR = Float32Array.from({ length: 65536 }, (_, i) => {
  const v = i / 65535;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

/** Apply global or local tone to display-encoded 16-bit samples without
 * collapsing them to 8 bits. Deliberately does not apply detail or masks. */
function applyToneRgb16(data: Uint16Array, edit: PhotoEdit): void {
  if (isNeutralTone(edit)) return;
  const CHUNK = 16384;
  const floats = new Float32Array(CHUNK * 4);
  for (let start = 0; start < data.length / 3; start += CHUNK) {
    const count = Math.min(CHUNK, data.length / 3 - start);
    for (let p = 0; p < count; p += 1) {
      const i = (start + p) * 3;
      floats[p * 4] = TO_LINEAR[data[i]];
      floats[p * 4 + 1] = TO_LINEAR[data[i + 1]];
      floats[p * 4 + 2] = TO_LINEAR[data[i + 2]];
    }
    applyPhotoEditLinear(floats.subarray(0, count * 4), edit);
    for (let p = 0; p < count; p += 1) {
      const i = (start + p) * 3;
      data[i] = Math.round(floats[p * 4] * 65535);
      data[i + 1] = Math.round(floats[p * 4 + 1] * 65535);
      data[i + 2] = Math.round(floats[p * 4 + 2] * 65535);
    }
  }
}

/**
 * Apply local Texture, Clarity and Sharpening at the *same image-wide radius*
 * as the preview's adjusted full photo. Each stripe takes an immutable halo
 * of input pixels, applies the mask's tone and detail to that small scratch
 * region, then blends only its interior using Kestrel's existing mask alpha.
 * This preserves the distinction between original feather texture and
 * background without a 45 MP second image. Earlier masks are committed in
 * recipe order; subsequent masks always see their result, like the screen.
 */
function applyDetailMaskRgb16(image: Rgb16Image, mask: Mask, masks: readonly Mask[], local: PhotoEdit, bandPixels: number): void {
  const { width, height, data } = image;
  const edge = Math.max(width, height);
  const d = detailParams(local, edge);
  const denoiseRadius = noiseStrength(local.denoise) > 0 ? ((local.denoise ?? 0) > 1 ? 2 : 1) : 0;
  const margin = Math.max(d.sharpenRadius, d.textureRadius, d.clarityRadius, denoiseRadius);
  // A band's top halo is retained before writing its interior. Ensuring at
  // least one margin's worth of interior keeps the previous original halo
  // sufficient, even for Clarity on a full-resolution Nikon image.
  const rows = Math.max(margin, Math.floor(bandPixels / width), 1);
  const stride = width * 3;
  let kept: Uint16Array | null = null;
  for (let from = 0; from < height; from += rows) {
    const to = Math.min(height, from + rows);
    const first = Math.max(0, from - margin);
    const last = Math.min(height, to + margin);
    const source = data.slice(first * stride, last * stride);
    if (kept && first < from) source.set(kept, 0);
    // Capture the original (not locally adjusted) lower halo for next stripe.
    kept = to < height ? source.slice((Math.max(first, to - margin) - first) * stride, (to - first) * stride) : null;
    if (denoiseRadius > 0) denoiseChromaRgb16(source, width, last - first, noiseStrength(local.denoise), denoiseRadius as 1 | 2);
    applyToneRgb16(source, local);
    applyDetailRgb16(source, width, last - first, local, edge);
    const bandHeight = to - from;
    const alpha = effectiveAlpha(mask, masks, width, bandHeight, {
      aspect: height / width,
      view: { x: 0, y: from / height, w: 1, h: bandHeight / height },
    });
    for (let p = 0; p < alpha.length; p += 1) {
      const a = alpha[p];
      if (a <= 0) continue;
      const original = (from * width + p) * 3;
      const adjusted = ((from - first) * width + p) * 3;
      for (let c = 0; c < 3; c++) {
        data[original + c] = Math.round(data[original + c] * (1 - a) + source[adjusted + c] * a);
      }
    }
  }
}

/**
 * Apply the *same mask alpha and mask ordering* as the live editor to 16-bit RGB,
 * without converting the master through an 8-bit canvas. The current master is
 * display-encoded sRGB, so local tones use the same decode → tone → encode maths
 * as the 8-bit screen. This is preview-parity, not a claim of scene-linear masks.
 *
 * Calculate alpha for only a bounded row band: a 45 MP file never allocates
 * a second full-size RGBA float image or an entire full-size alpha plane.
 * Other masks may limit this mask, exactly as in the preview renderer.
 */
export function applyToneMasksRgb16(image: Rgb16Image, masks: readonly Mask[] | undefined, detailBandPixels = 220000): void {
  if (!masks?.length) return;
  const { width, height, data } = image;
  // 256k pixels = about 4 MiB temporary RGBA floats + 1 MiB alpha.
  const rows = Math.max(1, Math.floor(262144 / width));
  for (const mask of masks) {
    if (!LOCAL_KEYS.some((key) => !!mask.edit[key])) continue;
    const local: PhotoEdit = { exposure: 0, warmth: 0, colour: 0, ...mask.edit };
    if (hasDetail(local) || noiseStrength(local.denoise) > 0) {
      applyDetailMaskRgb16(image, mask, masks, local, detailBandPixels);
      continue;
    }
    if (isNeutralTone(local)) continue;
    for (let from = 0; from < height; from += rows) {
      const bandHeight = Math.min(rows, height - from);
      const alpha = effectiveAlpha(mask, masks, width, bandHeight, {
        aspect: height / width,
        view: { x: 0, y: from / height, w: 1, h: bandHeight / height },
      });
      if (!alpha.some((value) => value > 0)) continue;
      const count = width * bandHeight;
      const rgba = new Float32Array(count * 4);
      for (let p = 0; p < count; p++) {
        const src = (from * width + p) * 3, dst = p * 4;
        rgba[dst] = TO_LINEAR[data[src]];
        rgba[dst + 1] = TO_LINEAR[data[src + 1]];
        rgba[dst + 2] = TO_LINEAR[data[src + 2]];
        rgba[dst + 3] = 1;
      }
      applyPhotoEditLinear(rgba, local);
      for (let p = 0; p < count; p++) {
        const strength = alpha[p];
        if (strength <= 0) continue;
        const src = (from * width + p) * 3, dst = p * 4;
        const rest = 1 - strength;
        // Match Kestrel's current visible 8-bit mask compositing formula,
        // at 16-bit sample precision. A later scene-linear overhaul must
        // update the screen and master together, with reference tests.
        data[src] = Math.round(data[src] * rest + rgba[dst] * 65535 * strength);
        data[src + 1] = Math.round(data[src + 1] * rest + rgba[dst + 1] * 65535 * strength);
        data[src + 2] = Math.round(data[src + 2] * rest + rgba[dst + 2] * 65535 * strength);
      }
    }
  }
}

/** Apply the edit in place: conservative chroma denoise, tone/colour,
 * global Texture/Clarity/Sharpening and then the same local mask ordering as screen. */
export function editRgb16(image: Rgb16Image, edit: PhotoEdit): void {
  const { data } = image;
  const chroma = noiseStrength(edit.denoise);
  if (chroma > 0) denoiseChromaRgb16(data, image.width, image.height, chroma, (edit.denoise ?? 0) > 1 ? 2 : 1);
  applyToneRgb16(data, edit);
  applyDetailRgb16(data, image.width, image.height, edit, Math.max(image.width, image.height));
  applyToneMasksRgb16(image, edit.masks);
}

/**
 * Standard sRGB ICC profile generated with LittleCMS. The decoder currently hands
 * this exporter display-encoded sRGB; this is a truthful *output* tag, not a claim
 * of a scene-linear working space or Nikon colour parity. Preserve the original
 * ICC bytes and only advertise other profiles after a measured colour transform.
 *
 * Embedded profile: 588 bytes, RGB monitor colour space, 'acsp' ICC signature.
 */
const SRGB_ICC_BASE64 = 'AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oACwATAA4ADAAeYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c';
const SRGB_ICC_PROFILE = Uint8Array.from(atob(SRGB_ICC_BASE64), (char) => char.charCodeAt(0));

/** A baseline uncompressed 16-bit RGB TIFF, tagged with the actual output sRGB ICC profile. */
export function encodeTiff16(image: Rgb16Image): Blob {
  const { width, height } = image;
  // TIFF strip offsets/counts below use 32-bit fields. Refuse corrupt or
  // impossible buffers rather than writing a plausible-looking damaged master.
  const pixels = width * height;
  const bytes = pixels * 6;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || !Number.isSafeInteger(pixels) ||
      bytes > 0xffffffff - 65536 ||
      !(image.data instanceof Uint16Array) || image.data.length !== pixels * 3) {
    throw new Error('The 16-bit picture has invalid dimensions or pixel data.');
  }
  const entries: Array<[tag: number, type: number, count: number, value: number]> = [];
  const SHORT = 3, LONG = 4, RATIONAL = 5, ASCII = 2, UNDEFINED = 7;
  const software = 'Kestrel\0';
  const entryCount = 15;
  const ifdOffset = 8;
  const extra = ifdOffset + 2 + entryCount * 12 + 4;
  const bitsOffset = extra;
  const resolutionOffset = bitsOffset + 6;
  const softwareOffset = resolutionOffset + 16;
  const profileOffset = softwareOffset + software.length + (software.length % 2);
  const dataOffset = profileOffset + SRGB_ICC_PROFILE.length + (SRGB_ICC_PROFILE.length % 2);
  const byteCount = width * height * 6;
  entries.push(
    [256, LONG, 1, width], [257, LONG, 1, height], [258, SHORT, 3, bitsOffset], [259, SHORT, 1, 1], [262, SHORT, 1, 2],
    [273, LONG, 1, dataOffset], [277, SHORT, 1, 3], [278, LONG, 1, height], [279, LONG, 1, byteCount],
    [282, RATIONAL, 1, resolutionOffset], [283, RATIONAL, 1, resolutionOffset + 8], [284, SHORT, 1, 1], [296, SHORT, 1, 2],
    [305, ASCII, software.length, softwareOffset], [34675, UNDEFINED, SRGB_ICC_PROFILE.length, profileOffset],
  );
  const header = new ArrayBuffer(dataOffset);
  const view = new DataView(header);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entryCount, true);
  entries.forEach(([tag, type, count, value], index) => {
    const at = ifdOffset + 2 + index * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    if (type === SHORT && count === 1) view.setUint16(at + 8, value, true);
    else view.setUint32(at + 8, value, true);
  });
  view.setUint32(ifdOffset + 2 + entryCount * 12, 0, true);
  for (let c = 0; c < 3; c += 1) view.setUint16(bitsOffset + c * 2, 16, true);
  for (const at of [resolutionOffset, resolutionOffset + 8]) { view.setUint32(at, 300, true); view.setUint32(at + 4, 1, true); }
  for (let i = 0; i < software.length; i += 1) view.setUint8(softwareOffset + i, software.charCodeAt(i));
  new Uint8Array(header, profileOffset, SRGB_ICC_PROFILE.length).set(SRGB_ICC_PROFILE);
  let samples = image.data;
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
    samples = new Uint16Array(image.data.length);
    const out = new DataView(samples.buffer);
    image.data.forEach((value, i) => out.setUint16(i * 2, value, true));
  }
  return new Blob([header, samples as Uint16Array<ArrayBuffer>], { type: 'image/tiff' });
}
