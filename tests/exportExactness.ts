import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

/**
 * Helpers for the export exactness proof (verified-asset-export-exactness.spec.ts).
 * The PNG reader here is deliberately independent of the browser: it proves the bytes written to disk, not what a
 * browser decoder makes of them (no colour management, no premultiplication).
 */

export interface DecodedPng { width: number; height: number; /** RGB, 8 bits per channel, row by row. */ rgb: Uint8Array }

/** Decode an 8-bit, non-interlaced RGB or RGBA PNG to RGB. Anything else is refused, never approximated. */
export function decodePng8(bytes: Uint8Array): DecodedPng {
  const decoded = decodePng(bytes);
  if (decoded.bitDepth !== 8) throw new Error(`Unsupported PNG layout: bit depth ${decoded.bitDepth}; an 8-bit PNG was expected.`);
  return { width: decoded.width, height: decoded.height, rgb: decoded.rgb };
}

/**
 * Decode a non-interlaced RGB or RGBA PNG of 8 or 16 bits per channel to RGB samples as stored: one byte per channel at
 * 8 bits, two big-endian bytes per channel at 16 bits (so a row hash covers every 16-bit value exactly).
 */
export function decodePng(bytes: Uint8Array): DecodedPng & { bitDepth: 8 | 16 } {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('Not a PNG.');
  let at = 8, width = 0, height = 0, bitDepth = 0, colourType = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colourType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if ((bitDepth !== 8 && bitDepth !== 16) || (colourType !== 2 && colourType !== 6) || interlace !== 0)
    throw new Error(`Unsupported PNG layout: bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace}.`);
  const sample = bitDepth / 8;
  const channels = (colourType === 6 ? 4 : 3) * sample;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error('PNG image data has the wrong length.');
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = up ? up[i] : 0;
      const c = up && i >= channels ? up[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`Unknown PNG filter ${filter}.`);
      out[i] = value & 255;
    }
  }
  const depth = bitDepth as 8 | 16;
  if (colourType === 2) return { width, height, rgb: rows, bitDepth: depth };
  const rgb = new Uint8Array(width * height * 3 * sample);
  const opaque = sample === 2 ? 0xffff : 0xff;
  for (let p = 0; p < width * height; p += 1) {
    const alphaAt = (p * 4 + 3) * sample;
    const alpha = sample === 2 ? (rows[alphaAt] << 8) | rows[alphaAt + 1] : rows[alphaAt];
    if (alpha !== opaque) throw new Error(`Exported pixel ${p % width},${Math.floor(p / width)} is not opaque.`);
    rgb.set(rows.subarray(p * 4 * sample, (p * 4 + 3) * sample), p * 3 * sample);
  }
  return { width, height, rgb, bitDepth: depth };
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** SHA-256 of each RGB row, so a mismatch can say where it starts without moving the whole picture between processes. */
export function rowHashes(image: DecodedPng & { bitDepth?: 8 | 16 }): string[] {
  const stride = image.width * 3 * ((image.bitDepth ?? 8) / 8);
  return Array.from({ length: image.height }, (_, y) => sha256(image.rgb.subarray(y * stride, (y + 1) * stride)));
}

/**
 * Freely licensed camera RAWs from raw.pixls.us (CC0), fetched by `node scripts/fetch-raw-samples.mjs --exactness`
 * into ./raw-samples (git-ignored, never committed). Each is pinned by SHA-256 so a changed download is refused.
 * The spec skips these, saying so, when the folder is absent (offline laptop); CI fetches them.
 */
export const LICENSED_RAWS: readonly { file: string; sha256: string; what: string }[] = [
  { file: '_IMG0114.DNG', sha256: '1e3352ccba0db428fd2a183718fc857fb283b1d43ad704305e5094c19e0a0428', what: 'Pentax K-3 Mark III, Adobe DNG' },
  { file: 'ILCE-7M4_DSC06681_APS-C-Raw-Compressed.ARW', sha256: '639a6d4db881f1359e3ea7e1137b314e59417d24e6d4d862b7202111a2c823b2', what: 'Sony A7 IV, compressed ARW' },
];

export function licensedRaw(sample: (typeof LICENSED_RAWS)[number]): Buffer | null {
  const folder = process.env.KESTREL_RAW_SAMPLES ?? join(process.cwd(), 'raw-samples');
  const path = join(folder, sample.file);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}
