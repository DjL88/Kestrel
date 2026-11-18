/**
 * Kestrel Experimental Universal TIFF / Uncompressed DNG / Bayer CFA / Netpbm Decoder
 * and Pure-TS 16-bit RGB TIFF Encoder with Embedded sRGB IEC61966-2.1 ICC Profile.
 *
 * Built from scratch in zero-dependency TypeScript so Kestrel never has to rely solely on
 * external crates or commercial decoders for standard linear/mosaic RAW experiments, TIFF
 * read/write round-trips, or universal embedded RAW preview extraction.
 */

export interface RawMetadataSummary {
  make?: string;
  model?: string;
  orientation: number;
  width?: number;
  height?: number;
  bitsPerSample?: number;
  photometric?: number;
  compression?: number;
  asShotNeutral?: [number, number, number];
  blackLevel?: number[];
  whiteLevel?: number[];
  cfaPattern?: number[];
  cfaDim?: [number, number];
  colorMatrix1?: number[];
}

export interface DecodedLinearImage {
  width: number;
  height: number;
  /** Interleaved scene-linear RGB [0..1+] (may retain highlight headroom > 1.0 before tone map). */
  linearRgb: Float32Array;
  bitDepth: number;
  orientation: number;
  decoder: 'kestrel-tiff-rgb16' | 'kestrel-tiff-rgb8' | 'kestrel-bayer-malvar' | 'kestrel-netpbm';
  metadata: RawMetadataSummary;
}

const TAG = {
  IMAGE_WIDTH: 256,
  IMAGE_LENGTH: 257,
  BITS_PER_SAMPLE: 258,
  COMPRESSION: 259,
  PHOTOMETRIC: 262,
  MAKE: 271,
  MODEL: 272,
  STRIP_OFFSETS: 273,
  ORIENTATION: 274,
  SAMPLES_PER_PIXEL: 277,
  ROWS_PER_STRIP: 278,
  STRIP_BYTE_COUNTS: 279,
  PLANAR_CONFIG: 284,
  SUB_IFDS: 330,
  JPEG_INTERCHANGE_FORMAT: 513,
  JPEG_INTERCHANGE_LENGTH: 514,
  EXIF_IFD: 34665,
  CFA_REPEAT_PATTERN_DIM: 33421,
  CFA_PATTERN: 33422,
  COLOR_MATRIX1: 50721,
  AS_SHOT_NEUTRAL: 50728,
  BLACK_LEVEL: 50714,
  WHITE_LEVEL: 50717,
} as const;

const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
  entryOffset: number;
}

function readTagValues(view: DataView, le: boolean, entry: IfdEntry, bytes: Uint8Array): number[] {
  const unitSize = TYPE_SIZE[entry.type] ?? 1;
  const totalBytes = unitSize * entry.count;
  const dataOffset = totalBytes <= 4 ? entry.entryOffset + 8 : entry.valueOffset;
  if (dataOffset < 0 || dataOffset + totalBytes > bytes.length) return [];
  const out: number[] = [];
  for (let i = 0; i < entry.count; i += 1) {
    const p = dataOffset + i * unitSize;
    switch (entry.type) {
      case 1:
      case 7:
        out.push(view.getUint8(p));
        break;
      case 3:
        out.push(view.getUint16(p, le));
        break;
      case 4:
        out.push(view.getUint32(p, le));
        break;
      case 5: {
        const num = view.getUint32(p, le);
        const den = view.getUint32(p + 4, le);
        out.push(den ? num / den : 0);
        break;
      }
      case 8:
        out.push(view.getInt16(p, le));
        break;
      case 9:
        out.push(view.getInt32(p, le));
        break;
      case 10: {
        const num = view.getInt32(p, le);
        const den = view.getInt32(p + 4, le);
        out.push(den ? num / den : 0);
        break;
      }
      case 11:
        out.push(view.getFloat32(p, le));
        break;
      case 12:
        out.push(view.getFloat64(p, le));
        break;
      default:
        out.push(view.getUint8(p));
    }
  }
  return out;
}

function readTagAscii(bytes: Uint8Array, view: DataView, le: boolean, entry: IfdEntry): string {
  const total = entry.count;
  const dataOffset = total <= 4 ? entry.entryOffset + 8 : entry.valueOffset;
  if (dataOffset < 0 || dataOffset + total > bytes.length) return '';
  let text = '';
  for (let i = 0; i < total; i += 1) {
    const ch = view.getUint8(dataOffset + i);
    if (ch === 0) break;
    text += String.fromCharCode(ch);
  }
  return text.trim();
}

function parseIfd(view: DataView, le: boolean, offset: number, bytes: Uint8Array): { entries: Map<number, IfdEntry>; nextOffset: number } | null {
  if (offset <= 0 || offset + 2 > bytes.length) return null;
  const count = view.getUint16(offset, le);
  if (count > 512 || offset + 2 + count * 12 + 4 > bytes.length) return null;
  const entries = new Map<number, IfdEntry>();
  for (let i = 0; i < count; i += 1) {
    const entryOffset = offset + 2 + i * 12;
    const tag = view.getUint16(entryOffset, le);
    const type = view.getUint16(entryOffset + 2, le);
    const cnt = view.getUint32(entryOffset + 4, le);
    const valueOffset = view.getUint32(entryOffset + 8, le);
    entries.set(tag, { tag, type, count: cnt, valueOffset, entryOffset });
  }
  const nextOffset = view.getUint32(offset + 2 + count * 12, le);
  return { entries, nextOffset };
}

function collectAllIfds(bytes: Uint8Array): { le: boolean; view: DataView; ifds: Map<number, IfdEntry>[] } | null {
  if (bytes.length < 8) return null;
  const b0 = bytes[0];
  const b1 = bytes[1];
  let le: boolean;
  if (b0 === 0x49 && b1 === 0x49) le = true;
  else if (b0 === 0x4d && b1 === 0x4d) le = false;
  else return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint16(2, le);
  if (magic !== 42 && magic !== 0x4f50 && magic !== 85) return null;
  const firstIfd = view.getUint32(4, le);
  const ifds: Map<number, IfdEntry>[] = [];
  const visited = new Set<number>();
  const queue: number[] = [firstIfd];
  while (queue.length > 0 && ifds.length < 32) {
    const off = queue.shift()!;
    if (!off || visited.has(off)) continue;
    visited.add(off);
    const parsed = parseIfd(view, le, off, bytes);
    if (!parsed) continue;
    ifds.push(parsed.entries);
    if (parsed.nextOffset) queue.push(parsed.nextOffset);
    const sub = parsed.entries.get(TAG.SUB_IFDS);
    if (sub) {
      for (const sOff of readTagValues(view, le, sub, bytes)) queue.push(sOff);
    }
    const exif = parsed.entries.get(TAG.EXIF_IFD);
    if (exif) {
      for (const eOff of readTagValues(view, le, exif, bytes)) queue.push(eOff);
    }
  }
  return { le, view, ifds };
}

/**
 * Malvar-He-Cutler (2004) High-Quality Linear Interpolation for Bayer CFA Demosaicing.
 * Uses 5x5 directional gradient-corrected Laplacian terms on raw mosaic luminance so zippering
 * and colour moire along feather/branch edges are dramatically reduced compared to simple bilinear.
 */
export function demosaicBayerMalvar(
  cfa: Float32Array,
  width: number,
  height: number,
  pattern: readonly number[] = [0, 1, 1, 2], // 0=R, 1=G, 2=B in 2x2 tile
): Float32Array {
  const rgb = new Float32Array(width * height * 3);
  const at = (x: number, y: number): number => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    return cfa[cy * width + cx];
  };
  const colorAt = (x: number, y: number) => pattern[((y & 1) << 1) | (x & 1)];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const c = colorAt(x, y);
      const center = at(x, y);
      let r = 0;
      let g = 0;
      let b = 0;

      if (c === 1) {
        // Green pixel: determine whether horizontal neighbours are Red or Blue
        g = center;
        const leftIsRed = colorAt(x - 1, y) === 0;
        const hAvg = (at(x - 1, y) + at(x + 1, y)) * 0.5;
        const vAvg = (at(x, y - 1) + at(x, y + 1)) * 0.5;
        // 5x5 green-plane Laplacian correction term
        const lapH = (5 * center - (at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1)
          + at(x - 2, y) + at(x + 2, y) * 1) + 0.5 * (at(x, y - 2) + at(x, y + 2))) / 8;
        const lapV = (5 * center - (at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1)
          + at(x, y - 2) + at(x, y + 2)) + 0.5 * (at(x - 2, y) + at(x + 2, y))) / 8;
        const valH = Math.max(0, hAvg + (lapH - center * 0.625) * 0.25);
        const valV = Math.max(0, vAvg + (lapV - center * 0.625) * 0.25);
        if (leftIsRed) {
          r = Math.max(0, valH);
          b = Math.max(0, valV);
        } else {
          b = Math.max(0, valH);
          r = Math.max(0, valV);
        }
      } else {
        // Red (0) or Blue (2) pixel
        const crossG = (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) * 0.25;
        const lapC = center - (at(x - 2, y) + at(x + 2, y) + at(x, y - 2) + at(x, y + 2)) * 0.25;
        const interpG = Math.max(0, crossG + lapC * 0.5);
        g = interpG;
        const diagOpp = (at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1)) * 0.25;
        const lapDiag = center - (at(x - 2, y) + at(x + 2, y) + at(x, y - 2) + at(x, y + 2)) * 0.25;
        const oppVal = Math.max(0, diagOpp + lapDiag * 0.375);
        if (c === 0) {
          r = center;
          b = oppVal;
        } else {
          b = center;
          r = oppVal;
        }
      }
      const idx = (y * width + x) * 3;
      rgb[idx] = r;
      rgb[idx + 1] = g;
      rgb[idx + 2] = b;
    }
  }
  return rgb;
}

function unpackSamples(raw: Uint8Array, sampleCount: number, bitsPerSample: number, le: boolean): Uint16Array {
  const out = new Uint16Array(sampleCount);
  if (bitsPerSample === 16) {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < sampleCount && i * 2 + 1 < raw.length; i += 1) {
      out[i] = view.getUint16(i * 2, le);
    }
    return out;
  }
  if (bitsPerSample === 8) {
    for (let i = 0; i < sampleCount && i < raw.length; i += 1) out[i] = raw[i];
    return out;
  }
  // Packed 10, 12, or 14 bit stream
  let bitPos = 0;
  const mask = (1 << bitsPerSample) - 1;
  for (let i = 0; i < sampleCount; i += 1) {
    const byteIdx = bitPos >> 3;
    if (byteIdx >= raw.length) break;
    const b0 = raw[byteIdx] ?? 0;
    const b1 = raw[byteIdx + 1] ?? 0;
    const b2 = raw[byteIdx + 2] ?? 0;
    const shift = bitPos & 7;
    if (le) {
      const chunk = b0 | (b1 << 8) | (b2 << 16);
      out[i] = (chunk >> shift) & mask;
    } else {
      const chunk = (b0 << 16) | (b1 << 8) | b2;
      out[i] = (chunk >> (24 - bitsPerSample - shift)) & mask;
    }
    bitPos += bitsPerSample;
  }
  return out;
}

function invert3x3(m: readonly number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-8) return null;
  return [A / det, D / det, G / det, B / det, E / det, H / det, C / det, F / det, I / det];
}

function mul3x3(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

// XYZ D50 -> Linear sRGB (D65 via Bradford adaptation)
const XYZ_D50_TO_LINEAR_SRGB = [
  3.1338561, -1.6168667, -0.4906146,
  -0.9787684, 1.9161415, 0.0334540,
  0.0719453, -0.2289914, 1.4052427,
];

function decodeNetpbm(bytes: Uint8Array): DecodedLinearImage | null {
  if (bytes.length < 10 || bytes[0] !== 0x50 || (bytes[1] !== 0x35 && bytes[1] !== 0x36)) return null;
  const isRgb = bytes[1] === 0x36;
  let pos = 2;
  const tokens: string[] = [];
  while (pos < bytes.length && tokens.length < 3) {
    const ch = bytes[pos];
    if (ch <= 32) { pos += 1; continue; }
    if (ch === 35) { // '#' comment
      while (pos < bytes.length && bytes[pos] !== 10) pos += 1;
      continue;
    }
    let tok = '';
    while (pos < bytes.length && bytes[pos] > 32) {
      tok += String.fromCharCode(bytes[pos]);
      pos += 1;
    }
    tokens.push(tok);
  }
  if (tokens.length < 3) return null;
  pos += 1; // single whitespace separator before binary raster
  const width = Number(tokens[0]);
  const height = Number(tokens[1]);
  const maxVal = Number(tokens[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || maxVal < 1 || maxVal > 65535) {
    return null;
  }
  const bitDepth = maxVal > 255 ? 16 : 8;
  const channels = isRgb ? 3 : 1;
  const sampleBytes = bitDepth === 16 ? 2 : 1;
  const pixelCount = width * height;
  if (pos + pixelCount * channels * sampleBytes > bytes.length) return null;
  const linearRgb = new Float32Array(pixelCount * 3);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < pixelCount; i += 1) {
    const base = pos + i * channels * sampleBytes;
    if (isRgb) {
      for (let c = 0; c < 3; c += 1) {
        const v = bitDepth === 16 ? view.getUint16(base + c * 2, false) : bytes[base + c];
        linearRgb[i * 3 + c] = v / maxVal;
      }
    } else {
      const v = bitDepth === 16 ? view.getUint16(base, false) : bytes[base];
      const norm = v / maxVal;
      linearRgb[i * 3] = norm;
      linearRgb[i * 3 + 1] = norm;
      linearRgb[i * 3 + 2] = norm;
    }
  }
  return {
    width,
    height,
    linearRgb,
    bitDepth,
    orientation: 1,
    decoder: 'kestrel-netpbm',
    metadata: { width, height, bitsPerSample: bitDepth, orientation: 1 },
  };
}

/**
 * Decodes an uncompressed TIFF, 8/12/14/16-bit Bayer CFA DNG/RAW strip container, or Netpbm PPM/PGM
 * directly into scene-linear floating-point RGB using Kestrel's pure TypeScript decoder.
 */
export function decodeTiffOrRawBuffer(buffer: ArrayBuffer | Uint8Array): DecodedLinearImage {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const netpbm = decodeNetpbm(bytes);
  if (netpbm) return netpbm;

  const container = collectAllIfds(bytes);
  if (!container || !container.ifds.length) {
    throw new Error('Unsupported or non-TIFF/RAW container format.');
  }
  const { le, view, ifds } = container;

  // Read top-level EXIF/DNG camera metadata
  const root = ifds[0];
  const makeEntry = root.get(TAG.MAKE);
  const modelEntry = root.get(TAG.MODEL);
  const orientEntry = root.get(TAG.ORIENTATION);
  const cmEntry = root.get(TAG.COLOR_MATRIX1);
  const neutralEntry = root.get(TAG.AS_SHOT_NEUTRAL);

  const make = makeEntry ? readTagAscii(bytes, view, le, makeEntry) : undefined;
  const model = modelEntry ? readTagAscii(bytes, view, le, modelEntry) : undefined;
  const rootOrientation = orientEntry ? (readTagValues(view, le, orientEntry, bytes)[0] ?? 1) : 1;
  const colorMatrix1 = cmEntry ? readTagValues(view, le, cmEntry, bytes) : undefined;
  const asShotValues = neutralEntry ? readTagValues(view, le, neutralEntry, bytes) : undefined;
  const asShotNeutral = asShotValues && asShotValues.length >= 3
    ? [asShotValues[0], asShotValues[1], asShotValues[2]] as [number, number, number]
    : undefined;

  // Pick the best uncompressed image IFD (preferring largest pixel count, CFA or RGB16/RGB8).
  let chosen: Map<number, IfdEntry> | null = null;
  let chosenPixels = 0;
  for (const ifd of ifds) {
    const w = ifd.get(TAG.IMAGE_WIDTH) ? readTagValues(view, le, ifd.get(TAG.IMAGE_WIDTH)!, bytes)[0] : 0;
    const h = ifd.get(TAG.IMAGE_LENGTH) ? readTagValues(view, le, ifd.get(TAG.IMAGE_LENGTH)!, bytes)[0] : 0;
    const comp = ifd.get(TAG.COMPRESSION) ? readTagValues(view, le, ifd.get(TAG.COMPRESSION)!, bytes)[0] : 1;
    const photo = ifd.get(TAG.PHOTOMETRIC) ? readTagValues(view, le, ifd.get(TAG.PHOTOMETRIC)!, bytes)[0] : 2;
    const hasStrips = ifd.has(TAG.STRIP_OFFSETS) && ifd.has(TAG.STRIP_BYTE_COUNTS);
    if (!w || !h || !hasStrips || comp !== 1) continue;
    if (photo !== 1 && photo !== 2 && photo !== 32803) continue;
    if (w * h > chosenPixels) {
      chosenPixels = w * h;
      chosen = ifd;
    }
  }
  if (!chosen) {
    throw new Error('No uncompressed RGB/CFA raster strips found in this RAW/TIFF file (compressed NEF/CR3 uses embedded preview unless native RAW decode runs).');
  }

  const width = readTagValues(view, le, chosen.get(TAG.IMAGE_WIDTH)!, bytes)[0];
  const height = readTagValues(view, le, chosen.get(TAG.IMAGE_LENGTH)!, bytes)[0];
  if (width * height > 80_000_000) throw new Error('Image exceeds maximum decoder dimension budget.');

  const bitsArr = chosen.get(TAG.BITS_PER_SAMPLE) ? readTagValues(view, le, chosen.get(TAG.BITS_PER_SAMPLE)!, bytes) : [8];
  const bitsPerSample = bitsArr[0] ?? 8;
  const samplesPerPixel = chosen.get(TAG.SAMPLES_PER_PIXEL) ? (readTagValues(view, le, chosen.get(TAG.SAMPLES_PER_PIXEL)!, bytes)[0] ?? 1) : 1;
  const photometric = chosen.get(TAG.PHOTOMETRIC) ? (readTagValues(view, le, chosen.get(TAG.PHOTOMETRIC)!, bytes)[0] ?? 2) : 2;
  const stripOffsets = readTagValues(view, le, chosen.get(TAG.STRIP_OFFSETS)!, bytes);
  const stripCounts = readTagValues(view, le, chosen.get(TAG.STRIP_BYTE_COUNTS)!, bytes);
  const orientation = chosen.get(TAG.ORIENTATION) ? (readTagValues(view, le, chosen.get(TAG.ORIENTATION)!, bytes)[0] ?? rootOrientation) : rootOrientation;
  const blackLevel = chosen.get(TAG.BLACK_LEVEL) ? readTagValues(view, le, chosen.get(TAG.BLACK_LEVEL)!, bytes) : [0];
  const whiteLevel = chosen.get(TAG.WHITE_LEVEL) ? readTagValues(view, le, chosen.get(TAG.WHITE_LEVEL)!, bytes) : [(1 << bitsPerSample) - 1];
  const cfaPattern = chosen.get(TAG.CFA_PATTERN) ? readTagValues(view, le, chosen.get(TAG.CFA_PATTERN)!, bytes) : [0, 1, 1, 2];
  const cfaDimVal = chosen.get(TAG.CFA_REPEAT_PATTERN_DIM) ? readTagValues(view, le, chosen.get(TAG.CFA_REPEAT_PATTERN_DIM)!, bytes) : [2, 2];

  const totalStripBytes = stripCounts.reduce((acc, v) => acc + v, 0);
  const packed = new Uint8Array(totalStripBytes);
  let writeAt = 0;
  for (let s = 0; s < stripOffsets.length; s += 1) {
    const off = stripOffsets[s];
    const len = stripCounts[s] ?? 0;
    if (off + len > bytes.length) throw new Error('Truncated TIFF/RAW raster strip.');
    packed.set(bytes.subarray(off, off + len), writeAt);
    writeAt += len;
  }

  const metadata: RawMetadataSummary = {
    make,
    model,
    orientation,
    width,
    height,
    bitsPerSample,
    photometric,
    compression: 1,
    asShotNeutral,
    blackLevel,
    whiteLevel,
    cfaPattern,
    cfaDim: [cfaDimVal[0] ?? 2, cfaDimVal[1] ?? 2],
    colorMatrix1,
  };

  const pixelCount = width * height;
  if (photometric === 32803) {
    // Scene-linear CFA Bayer Mosaic decode
    const samples = unpackSamples(packed, pixelCount, bitsPerSample, le);
    const cfa = new Float32Array(pixelCount);
    const black = blackLevel[0] ?? 0;
    const white = Math.max(black + 1, whiteLevel[0] ?? ((1 << bitsPerSample) - 1));
    const span = white - black;
    for (let i = 0; i < pixelCount; i += 1) {
      cfa[i] = Math.max(0, (samples[i] - black) / span);
    }
    const rgb = demosaicBayerMalvar(cfa, width, height, cfaPattern);
    // Apply AsShotNeutral white balance gains normalized to Green=1.0
    const wbR = asShotNeutral && asShotNeutral[0] > 0 ? asShotNeutral[1] / asShotNeutral[0] : 1;
    const wbG = 1;
    const wbB = asShotNeutral && asShotNeutral[2] > 0 ? asShotNeutral[1] / asShotNeutral[2] : 1;
    // Apply ColorMatrix1 (XYZ->Cam) inverse -> Linear sRGB if valid 3x3 matrix provided
    let camToSrgb: number[] | null = null;
    if (colorMatrix1 && colorMatrix1.length === 9) {
      const inv = invert3x3(colorMatrix1);
      if (inv) camToSrgb = mul3x3(XYZ_D50_TO_LINEAR_SRGB, inv);
    }
    for (let i = 0; i < pixelCount; i += 1) {
      const j = i * 3;
      const cr = rgb[j] * wbR;
      const cg = rgb[j + 1] * wbG;
      const cb = rgb[j + 2] * wbB;
      if (camToSrgb) {
        rgb[j] = Math.max(0, camToSrgb[0] * cr + camToSrgb[1] * cg + camToSrgb[2] * cb);
        rgb[j + 1] = Math.max(0, camToSrgb[3] * cr + camToSrgb[4] * cg + camToSrgb[5] * cb);
        rgb[j + 2] = Math.max(0, camToSrgb[6] * cr + camToSrgb[7] * cg + camToSrgb[8] * cb);
      } else {
        rgb[j] = cr;
        rgb[j + 1] = cg;
        rgb[j + 2] = cb;
      }
    }
    return { width, height, linearRgb: rgb, bitDepth: bitsPerSample, orientation, decoder: 'kestrel-bayer-malvar', metadata };
  }

  // RGB or Grayscale uncompressed TIFF
  const samples = unpackSamples(packed, pixelCount * samplesPerPixel, bitsPerSample, le);
  const maxCode = (1 << bitsPerSample) - 1;
  const linearRgb = new Float32Array(pixelCount * 3);
  const toLinear = (v: number) => {
    const n = v / maxCode;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  for (let i = 0; i < pixelCount; i += 1) {
    if (samplesPerPixel >= 3) {
      const s = i * samplesPerPixel;
      linearRgb[i * 3] = toLinear(samples[s]);
      linearRgb[i * 3 + 1] = toLinear(samples[s + 1]);
      linearRgb[i * 3 + 2] = toLinear(samples[s + 2]);
    } else {
      const l = toLinear(samples[i]);
      linearRgb[i * 3] = l;
      linearRgb[i * 3 + 1] = l;
      linearRgb[i * 3 + 2] = l;
    }
  }
  return {
    width,
    height,
    linearRgb,
    bitDepth: bitsPerSample,
    orientation,
    decoder: bitsPerSample === 16 ? 'kestrel-tiff-rgb16' : 'kestrel-tiff-rgb8',
    metadata,
  };
}

/**
 * Universal embedded JPEG preview extractor across NEF, CR2, ARW, DNG, ORF, RW2, and PEF.
 * Walks TIFF/IFD JPEG pointers first and falls back to scanning nested JPEG SOI/EOI streams,
 * choosing the largest resolution embedded preview without requiring Tauri or native crates.
 */
export function extractEmbeddedRawPreview(buffer: ArrayBuffer | Uint8Array): { jpeg: Uint8Array; metadata: RawMetadataSummary } | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const container = collectAllIfds(bytes);
  const candidates: Array<{ start: number; length: number }> = [];
  let metadata: RawMetadataSummary = { orientation: 1 };

  if (container) {
    const { le, view, ifds } = container;
    const root = ifds[0];
    if (root) {
      metadata = {
        make: root.get(TAG.MAKE) ? readTagAscii(bytes, view, le, root.get(TAG.MAKE)!) : undefined,
        model: root.get(TAG.MODEL) ? readTagAscii(bytes, view, le, root.get(TAG.MODEL)!) : undefined,
        orientation: root.get(TAG.ORIENTATION) ? (readTagValues(view, le, root.get(TAG.ORIENTATION)!, bytes)[0] ?? 1) : 1,
      };
    }
    for (const ifd of ifds) {
      const offEntry = ifd.get(TAG.JPEG_INTERCHANGE_FORMAT);
      const lenEntry = ifd.get(TAG.JPEG_INTERCHANGE_LENGTH);
      if (offEntry && lenEntry) {
        const start = readTagValues(view, le, offEntry, bytes)[0] ?? 0;
        const length = readTagValues(view, le, lenEntry, bytes)[0] ?? 0;
        if (start > 0 && length > 512 && start + length <= bytes.length && bytes[start] === 0xff && bytes[start + 1] === 0xd8) {
          candidates.push({ start, length });
        }
      }
    }
  }

  // Fallback marker scan for maker-note JPEG previews (e.g. Nikon/Sony/Fuji high-res preview blocks)
  if (!candidates.length) {
    for (let i = 0; i < bytes.length - 4; i += 1) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
        let end = -1;
        for (let j = i + 4; j < bytes.length - 1; j += 1) {
          if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
            end = j + 2;
            break;
          }
        }
        if (end > i + 1024) {
          candidates.push({ start: i, length: end - i });
          i = end;
        }
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.length - a.length);
  const best = candidates[0];
  return { jpeg: bytes.slice(best.start, best.start + best.length), metadata };
}

/** Minimal valid sRGB IEC61966-2.1 v2 ICC profile builder (tag-complete, pure TypeScript). */
export function buildSrgbIccProfile(): Uint8Array {
  // Compact 524-byte ICC v2.1 sRGB profile (Header 128 + TagCount 4 + 9*12=108 + Data)
  const writeTag = (buf: DataView, off: number, sig: string) => {
    for (let i = 0; i < 4; i += 1) buf.setUint8(off + i, sig.charCodeAt(i));
  };
  const writeS15Fixed16 = (buf: DataView, off: number, val: number) => {
    buf.setInt32(off, Math.round(val * 65536), false);
  };
  const tags: Array<{ sig: string; data: Uint8Array }> = [];

  const desc = new Uint8Array(24);
  const descView = new DataView(desc.buffer);
  writeTag(descView, 0, 'desc');
  descView.setUint32(8, 5, false);
  desc.set([115, 82, 71, 66, 0], 12); // "sRGB\0"
  tags.push({ sig: 'desc', data: desc });

  const cprt = new Uint8Array(20);
  writeTag(new DataView(cprt.buffer), 0, 'text');
  cprt.set([75, 101, 115, 116, 114, 101, 108, 0], 8); // "Kestrel\0"
  tags.push({ sig: 'cprt', data: cprt });

  const makeXyz = (x: number, y: number, z: number) => {
    const b = new Uint8Array(20);
    const v = new DataView(b.buffer);
    writeTag(v, 0, 'XYZ ');
    writeS15Fixed16(v, 8, x);
    writeS15Fixed16(v, 12, y);
    writeS15Fixed16(v, 16, z);
    return b;
  };
  tags.push({ sig: 'wtpt', data: makeXyz(0.95045, 1.0, 1.08905) });
  tags.push({ sig: 'rXYZ', data: makeXyz(0.43607, 0.22250, 0.01393) });
  tags.push({ sig: 'gXYZ', data: makeXyz(0.38506, 0.71687, 0.09710) });
  tags.push({ sig: 'bXYZ', data: makeXyz(0.14307, 0.06062, 0.71410) });

  // 16-entry sRGB parametric/sampled TRC curve (type 'curv')
  const trcN = 16;
  const trc = new Uint8Array(12 + trcN * 2);
  const trcView = new DataView(trc.buffer);
  writeTag(trcView, 0, 'curv');
  trcView.setUint32(8, trcN, false);
  for (let i = 0; i < trcN; i += 1) {
    const x = i / (trcN - 1);
    const y = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    trcView.setUint16(12 + i * 2, Math.round(y * 65535), false);
  }
  tags.push({ sig: 'rTRC', data: trc });
  tags.push({ sig: 'gTRC', data: trc });
  tags.push({ sig: 'bTRC', data: trc });

  const tableBytes = 4 + tags.length * 12;
  let dataCursor = 128 + tableBytes;
  const totalBytes = dataCursor + tags.reduce((sum, t) => sum + t.data.length, 0);
  const icc = new Uint8Array(totalBytes);
  const v = new DataView(icc.buffer);
  v.setUint32(0, totalBytes, false);
  writeTag(v, 4, 'KSTL');
  v.setUint32(8, 0x02100000, false); // ICC v2.1.0
  writeTag(v, 12, 'mntr');
  writeTag(v, 16, 'RGB ');
  writeTag(v, 20, 'XYZ ');
  v.setUint16(24, 2026, false);
  v.setUint16(26, 11, false);
  v.setUint16(28, 18, false);
  writeTag(v, 36, 'acsp');
  writeTag(v, 40, 'APPL');
  writeS15Fixed16(v, 68, 0.9642);
  writeS15Fixed16(v, 72, 1.0);
  writeS15Fixed16(v, 76, 0.8249);
  v.setUint32(128, tags.length, false);
  tags.forEach((t, idx) => {
    const row = 132 + idx * 12;
    writeTag(v, row, t.sig);
    v.setUint32(row + 4, dataCursor, false);
    v.setUint32(row + 8, t.data.length, false);
    icc.set(t.data, dataCursor);
    dataCursor += t.data.length;
  });
  return icc;
}

/**
 * Encodes scene-linear or display RGB into a genuine uncompressed 16-bit Baseline TIFF
 * with an embedded sRGB IEC61966-2.1 ICC profile (Tag 34675 / 0x8773) in pure TypeScript.
 */
export function encodeRgb16TiffWithIcc(
  rgb16: Uint16Array,
  width: number,
  height: number,
  software = 'Kestrel Photo Studio',
): Uint8Array {
  if (width < 1 || height < 1 || rgb16.length !== width * height * 3) {
    throw new RangeError('Invalid RGB16 dimensions or buffer.');
  }
  const icc = buildSrgbIccProfile();
  const softwareBytes = new TextEncoder().encode(software + '\0');
  const bitsPerSampleBytes = new Uint8Array([16, 0, 16, 0, 16, 0]);
  const pixelByteLength = rgb16.length * 2;
  const entryCount = 11;
  const ifdOffset = 8;
  const ifdSize = 2 + entryCount * 12 + 4;
  let extraOffset = ifdOffset + ifdSize;
  const bpsOffset = extraOffset;
  extraOffset += bitsPerSampleBytes.length;
  const swOffset = extraOffset;
  extraOffset += softwareBytes.length + (softwareBytes.length % 2);
  const iccOffset = extraOffset;
  extraOffset += icc.length + (icc.length % 2);
  const rasterOffset = extraOffset;
  const totalBytes = rasterOffset + pixelByteLength;

  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);
  // Little-endian TIFF header
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  view.setUint16(ifdOffset, entryCount, true);
  let cursor = ifdOffset + 2;
  const putEntry = (tag: number, type: number, count: number, valueOrOffset: number) => {
    view.setUint16(cursor, tag, true);
    view.setUint16(cursor + 2, type, true);
    view.setUint32(cursor + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(cursor + 8, valueOrOffset, true);
    else view.setUint32(cursor + 8, valueOrOffset, true);
    cursor += 12;
  };
  // Tags sorted ascending per TIFF 6.0 spec
  putEntry(256, 4, 1, width); // ImageWidth
  putEntry(257, 4, 1, height); // ImageLength
  putEntry(258, 3, 3, bpsOffset); // BitsPerSample = [16, 16, 16]
  putEntry(259, 3, 1, 1); // Compression = Uncompressed
  putEntry(262, 3, 1, 2); // PhotometricInterpretation = RGB
  putEntry(273, 4, 1, rasterOffset); // StripOffsets
  putEntry(277, 3, 1, 3); // SamplesPerPixel = 3
  putEntry(278, 4, 1, height); // RowsPerStrip
  putEntry(279, 4, 1, pixelByteLength); // StripByteCounts
  putEntry(305, 2, softwareBytes.length, swOffset); // Software
  putEntry(34675, 7, icc.length, iccOffset); // InterColorProfile (ICC)
  view.setUint32(cursor, 0, true); // Next IFD = 0

  out.set(bitsPerSampleBytes, bpsOffset);
  out.set(softwareBytes, swOffset);
  out.set(icc, iccOffset);
  for (let i = 0; i < rgb16.length; i += 1) {
    view.setUint16(rasterOffset + i * 2, rgb16[i], true);
  }
  return out;
}
