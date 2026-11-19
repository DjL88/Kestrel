import { applyDetailRgb16, applyPhotoEditLinear, isNeutralTone, type PhotoEdit } from './photoEdits';
import { cropRectangle, type PhotoFraming } from './photoFraming';
import { THUMB, type Thumb } from './orientMatch';
import { hasActiveMasks } from './maskTypes';
import { hasNoiseReduction } from './noiseReduction';

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

/** Read the decoder's layout: width and height (u32), then RGB samples (u16), all little-endian. */
export function parseRgb16(buffer: ArrayBuffer): Rgb16Image {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8) throw new Error('The 16-bit picture is empty.');
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  if (!width || !height || buffer.byteLength !== 8 + width * height * 6) throw new Error('The 16-bit picture is incomplete.');
  const data = new Uint16Array(width * height * 3);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] === 1) data.set(new Uint16Array(buffer, 8, width * height * 3));
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
export function master16Blocker(edit: PhotoEdit | undefined, framing: PhotoFraming | undefined): string | null {
  if (edit && hasActiveMasks(edit.masks)) return 'The 16-bit TIFF does not include masks yet. The normal export keeps them.';
  if (edit && hasNoiseReduction(edit)) return 'The 16-bit TIFF does not include Noise reduction yet. The normal export keeps it.';
  if (framing && Math.abs(framing.straighten) > 1e-6) return 'The 16-bit TIFF does not include straightening yet. The normal export keeps it.';
  return null;
}

/**
 * Turn the picture clockwise by `turns` quarter turns, then cut out the framing's crop, exactly as the editor frames it
 * (`drawFramedPhoto` without straightening). `extraTurns` first lines the picture up with the one the editor shows.
 */
export function frameRgb16(image: Rgb16Image, framing: PhotoFraming, extraTurns = 0): Rgb16Image {
  const turns = (((framing.turns + extraTurns) % 4) + 4) % 4;
  const sideways = turns % 2 === 1;
  const width = sideways ? image.height : image.width;
  const height = sideways ? image.width : image.height;
  const crop = cropRectangle(width, height, framing);
  const out = new Uint16Array(crop.width * crop.height * 3);
  const { width: w, height: h, data } = image;
  for (let y = 0; y < crop.height; y += 1) {
    const ty = crop.y + y;
    for (let x = 0; x < crop.width; x += 1) {
      const tx = crop.x + x;
      // Where this turned pixel comes from in the picture as decoded.
      const sx = turns === 0 ? tx : turns === 1 ? ty : turns === 2 ? w - 1 - tx : w - 1 - ty;
      const sy = turns === 0 ? ty : turns === 1 ? h - 1 - tx : turns === 2 ? h - 1 - ty : tx;
      const from = (sy * w + sx) * 3;
      const to = (y * crop.width + x) * 3;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
    }
  }
  return { width: crop.width, height: crop.height, data: out };
}

const TO_LINEAR = Float32Array.from({ length: 65536 }, (_, i) => {
  const v = i / 65535;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

/** Apply the edit in place: the whole-photo tone and colour, then Texture, Clarity and Sharpening. */
export function editRgb16(image: Rgb16Image, edit: PhotoEdit): void {
  const { data } = image;
  if (!isNeutralTone(edit)) {
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
  applyDetailRgb16(data, image.width, image.height, edit, Math.max(image.width, image.height));
}

/** A baseline, uncompressed, 16-bit RGB TIFF (little-endian), readable by every editor. No colour profile yet: sRGB values. */
export function encodeTiff16(image: Rgb16Image): Blob {
  const { width, height } = image;
  const entries: Array<[tag: number, type: number, count: number, value: number]> = [];
  const SHORT = 3, LONG = 4, RATIONAL = 5, ASCII = 2;
  const software = 'Kestrel\0';
  const entryCount = 14;
  const ifdOffset = 8;
  const extra = ifdOffset + 2 + entryCount * 12 + 4;
  const bitsOffset = extra;
  const resolutionOffset = bitsOffset + 6;
  const softwareOffset = resolutionOffset + 16;
  const dataOffset = softwareOffset + software.length + (software.length % 2);
  const byteCount = width * height * 6;
  entries.push(
    [256, LONG, 1, width], [257, LONG, 1, height], [258, SHORT, 3, bitsOffset], [259, SHORT, 1, 1], [262, SHORT, 1, 2],
    [273, LONG, 1, dataOffset], [277, SHORT, 1, 3], [278, LONG, 1, height], [279, LONG, 1, byteCount],
    [282, RATIONAL, 1, resolutionOffset], [283, RATIONAL, 1, resolutionOffset + 8], [284, SHORT, 1, 1], [296, SHORT, 1, 2],
    [305, ASCII, software.length, softwareOffset],
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
  let samples = image.data;
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
    samples = new Uint16Array(image.data.length);
    const out = new DataView(samples.buffer);
    image.data.forEach((value, i) => out.setUint16(i * 2, value, true));
  }
  return new Blob([header, samples as Uint16Array<ArrayBuffer>], { type: 'image/tiff' });
}
