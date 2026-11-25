import type { Rgb16Image } from './master16';

/**
 * A 16-bit-per-channel RGB PNG from the high-precision working picture: no 8-bit step anywhere. Rows are Sub-filtered
 * and deflated through the platform's `CompressionStream('deflate')` (zlib format, as PNG requires) in bands, so a
 * 45-megapixel picture never needs a second full-size copy. Tagged sRGB, the same truthful output claim as the TIFF.
 */
export async function encodePng16(image: Rgb16Image, rowsPerBand = 64): Promise<Blob> {
  const { width, height, data } = image;
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      width > 0x7fffffff || height > 0x7fffffff || !(data instanceof Uint16Array) || data.length !== pixels * 3) {
    throw new Error('The 16-bit picture has invalid dimensions or pixel data.');
  }
  const stride = width * 6;
  const compressed = new CompressionStream('deflate');
  const writer = compressed.writable.getWriter();
  const collected = new Response(compressed.readable).arrayBuffer();
  for (let top = 0; top < height; top += rowsPerBand) {
    const rows = Math.min(rowsPerBand, height - top);
    const band = new Uint8Array(rows * (stride + 1));
    for (let r = 0; r < rows; r += 1) {
      const out = r * (stride + 1);
      band[out] = 1; // Sub filter: each byte minus the same byte of the pixel to its left.
      const row = (top + r) * width * 3;
      for (let i = 0; i < width * 3; i += 1) {
        const value = data[row + i];
        const at = out + 1 + i * 2;
        const left = i >= 3 ? data[row + i - 3] : 0;
        band[at] = ((value >> 8) - (left >> 8)) & 0xff;
        band[at + 1] = ((value & 0xff) - (left & 0xff)) & 0xff;
      }
    }
    await writer.write(band);
  }
  await writer.close();
  const idat = new Uint8Array(await collected);

  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr.set([16, 2, 0, 0, 0], 8); // 16 bits per sample, truecolour RGB, deflate, adaptive filtering, no interlace
  const parts: Uint8Array[] = [PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('sRGB', new Uint8Array([0]))];
  const IDAT_MAX = 1 << 20;
  for (let at = 0; at < idat.length; at += IDAT_MAX) parts.push(chunk('IDAT', idat.subarray(at, at + IDAT_MAX)));
  parts.push(chunk('IEND', new Uint8Array(0)));
  return new Blob(parts as Uint8Array<ArrayBuffer>[], { type: 'image/png' });
}

export interface PngProof { width: number; height: number; bitDepth: number; colourType: number; srgb: boolean; idatBytes: number }

/**
 * Read a PNG back and say what it really is: size, bit depth and colour type from IHDR, with every chunk's CRC checked.
 * Use it to prove an export is 16-bit, never to assume it.
 */
export function provePng(bytes: ArrayBuffer | Uint8Array): PngProof {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length < 8 + 25 + 12 || PNG_SIGNATURE.some((value, i) => view[i] !== value)) throw new Error('Not a PNG file.');
  const data = new DataView(view.buffer, view.byteOffset, view.byteLength);
  let at = 8;
  let proof: PngProof | null = null;
  let ended = false;
  while (at + 12 <= view.length) {
    const length = data.getUint32(at);
    if (at + 12 + length > view.length) throw new Error('The PNG is truncated.');
    const type = String.fromCharCode(...view.subarray(at + 4, at + 8));
    if (crc32(view.subarray(at + 4, at + 8 + length)) !== data.getUint32(at + 8 + length)) throw new Error(`The PNG ${type} chunk is damaged.`);
    if (type === 'IHDR') {
      if (proof || length !== 13) throw new Error('The PNG header is invalid.');
      proof = { width: data.getUint32(at + 8), height: data.getUint32(at + 12), bitDepth: view[at + 16], colourType: view[at + 17], srgb: false, idatBytes: 0 };
    } else if (!proof) {
      throw new Error('The PNG does not start with its header.');
    } else if (type === 'sRGB') proof.srgb = true;
    else if (type === 'IDAT') proof.idatBytes += length;
    else if (type === 'IEND') { ended = true; break; }
    at += 12 + length;
  }
  if (!proof || !ended || !proof.idatBytes) throw new Error('The PNG has no complete picture.');
  return proof;
}

/**
 * Read a 16-bit RGB PNG back to its pixels (every PNG filter, CRCs checked by `provePng`). For proving what an export
 * really contains, value by value, never for guessing. Refuses any other kind of PNG.
 */
export async function readPng16(bytes: ArrayBuffer | Uint8Array): Promise<Rgb16Image> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const proof = provePng(view);
  if (proof.bitDepth !== 16 || proof.colourType !== 2) throw new Error(`Not a 16-bit RGB PNG (bit depth ${proof.bitDepth}, colour type ${proof.colourType}).`);
  const data = new DataView(view.buffer, view.byteOffset, view.byteLength);
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 12 <= view.length;) {
    const length = data.getUint32(at);
    const type = String.fromCharCode(...view.subarray(at + 4, at + 8));
    if (type === 'IDAT') idat.push(view.slice(at + 8, at + 8 + length));
    if (type === 'IEND') break;
    at += 12 + length;
  }
  if (view[8 + 8 + 12] !== 0) throw new Error('Interlaced PNGs are not read here.');
  const inflated = new Uint8Array(await new Response(new Blob(idat as Uint8Array<ArrayBuffer>[]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const { width, height } = proof;
  const stride = width * 6;
  if (inflated.length !== height * (stride + 1)) throw new Error('The PNG picture data has the wrong length.');
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (stride + 1)];
    const line = inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 6 ? rows[out + i - 6] : 0;
      const up = y > 0 ? rows[out - stride + i] : 0;
      const corner = y > 0 && i >= 6 ? rows[out - stride + i - 6] : 0;
      let value: number;
      if (filter === 0) value = line[i];
      else if (filter === 1) value = line[i] + left;
      else if (filter === 2) value = line[i] + up;
      else if (filter === 3) value = line[i] + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        value = line[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner);
      } else throw new Error(`Unknown PNG filter ${filter}.`);
      rows[out + i] = value & 0xff;
    }
  }
  const pixels = new Uint16Array(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (rows[i * 2] << 8) | rows[i * 2 + 1];
  return { width, height, data: pixels };
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
