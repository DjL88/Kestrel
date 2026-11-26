/**
 * Reading ICC colour profiles, enough to soft proof: how a photo will look when a printer and paper reproduce it.
 *
 * Supported: the lookup tables printer and paper profiles carry (lut8 `mft1`, lut16 `mft2`, and ICC v4 `mAB `/`mBA `),
 * with a Lab or XYZ connection space, for RGB, CMYK or grey devices. Anything else is refused in words; a profile we
 * cannot read is never half-applied. Pure: no DOM, no I/O.
 */

export type IccClass = 'prtr' | 'mntr' | 'scnr' | 'spac' | 'link' | 'abst' | 'nmcl' | string;

interface Curve { kind: 'identity' }
type CurveFn = (x: number) => number;

interface LutTransform {
  inChannels: number;
  outChannels: number;
  /** Normalised 0..1 in, normalised 0..1 out, in the profile's own encoding. */
  run: (input: readonly number[]) => number[];
}

export interface IccProfile {
  description: string;
  version: number;
  deviceClass: IccClass;
  colourSpace: string;
  pcs: 'Lab ' | 'XYZ ';
  /** PCS → device, and device → PCS, for relative colorimetric when the profile has it (else perceptual). */
  toDevice: LutTransform;
  fromDevice: LutTransform;
  intent: 'relative' | 'perceptual';
  /** How Lab is packed for each table (v2 lut16 uses 0xFF00 for 100; everything else 0xFFFF). */
  labEncoding: { toDevice: 'v2' | 'v4'; fromDevice: 'v2' | 'v4' };
}

export class IccProfileError extends Error {}

const text4 = (view: DataView, at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
const s15 = (view: DataView, at: number) => view.getInt32(at) / 65536;

function interpolateTable(table: ArrayLike<number>, scale: number): CurveFn {
  const last = table.length - 1;
  return (x) => {
    const at = Math.min(1, Math.max(0, x)) * last;
    const i = Math.min(last - 1, Math.floor(at));
    if (last < 1) return table[0] / scale;
    const f = at - i;
    return (table[i] * (1 - f) + table[i + 1] * f) / scale;
  };
}

/** A `curv` or `para` element. Returns the function and the bytes it used (for v4 element lists, 4-byte aligned). */
function readCurve(view: DataView, at: number): { fn: CurveFn; size: number } {
  const type = text4(view, at);
  if (type === 'curv') {
    const count = view.getUint32(at + 8);
    const size = 12 + count * 2;
    if (count === 0) return { fn: (x) => x, size };
    if (count === 1) { const gamma = view.getUint16(at + 12) / 256; return { fn: (x) => Math.max(0, x) ** gamma, size }; }
    const table = new Uint16Array(count);
    for (let i = 0; i < count; i++) table[i] = view.getUint16(at + 12 + i * 2);
    return { fn: interpolateTable(table, 65535), size };
  }
  if (type === 'para') {
    const kind = view.getUint16(at + 8);
    const counts = [1, 3, 4, 5, 7];
    if (kind > 4) throw new IccProfileError('This profile uses a curve type InFlight cannot read.');
    const p = Array.from({ length: counts[kind] }, (_, i) => s15(view, at + 12 + i * 4));
    const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = p;
    const fn: CurveFn = kind === 0 ? (x) => Math.max(0, x) ** g
      : kind === 1 ? (x) => (x >= -b / a ? Math.max(0, a * x + b) ** g : 0)
      : kind === 2 ? (x) => (x >= -b / a ? Math.max(0, a * x + b) ** g + c : c)
      : kind === 3 ? (x) => (x >= d ? Math.max(0, a * x + b) ** g : c * x)
      : (x) => (x >= d ? Math.max(0, a * x + b) ** g + e : c * x + f);
    return { fn, size: 12 + counts[kind] * 4 };
  }
  throw new IccProfileError(`This profile uses a curve type (${type.trim()}) InFlight cannot read.`);
}

/** Multilinear lookup in an n-dimensional grid of `out` values per node. */
function clutLookup(grid: readonly number[], out: number, data: ArrayLike<number>, scale: number): (input: readonly number[]) => number[] {
  const n = grid.length;
  const strides = new Array<number>(n);
  let stride = out;
  for (let d = n - 1; d >= 0; d--) { strides[d] = stride; stride *= grid[d]; }
  if (stride !== data.length) throw new IccProfileError('This profile’s colour table is the wrong size.');
  return (input) => {
    const base = new Array<number>(n), frac = new Array<number>(n);
    for (let d = 0; d < n; d++) {
      const at = Math.min(1, Math.max(0, input[d] ?? 0)) * (grid[d] - 1);
      const i = Math.min(grid[d] - 2, Math.floor(at));
      base[d] = Math.max(0, i); frac[d] = grid[d] > 1 ? at - base[d] : 0;
    }
    const result = new Array<number>(out).fill(0);
    for (let corner = 0; corner < 1 << n; corner++) {
      let weight = 1, offset = 0;
      for (let d = 0; d < n; d++) {
        const up = (corner >> d) & 1;
        if (up && grid[d] < 2) { weight = 0; break; }
        weight *= up ? frac[d] : 1 - frac[d];
        offset += (base[d] + up) * strides[d];
      }
      if (weight === 0) continue;
      for (let o = 0; o < out; o++) result[o] += weight * data[offset + o];
    }
    return result.map((value) => value / scale);
  };
}

function readLut(view: DataView, at: number, size: number, pcsIsXyzInput: boolean): { lut: LutTransform; lab: 'v2' | 'v4' } {
  const type = text4(view, at);
  if (type === 'mft2' || type === 'mft1') {
    const wide = type === 'mft2';
    const inCh = view.getUint8(at + 8), outCh = view.getUint8(at + 9), points = view.getUint8(at + 10);
    if (!inCh || !outCh || points < 2 || inCh > 8) throw new IccProfileError('This profile’s colour table is not readable.');
    const matrix = Array.from({ length: 9 }, (_, i) => s15(view, at + 12 + i * 4));
    const inEntries = wide ? view.getUint16(at + 48) : 256, outEntries = wide ? view.getUint16(at + 50) : 256;
    const bytes = wide ? 2 : 1, scale = wide ? 65535 : 255;
    let cursor = at + (wide ? 52 : 48);
    const readArray = (count: number) => {
      if (cursor + count * bytes > at + size) throw new IccProfileError('This profile is cut short.');
      const values = new (wide ? Uint16Array : Uint8Array)(count);
      for (let i = 0; i < count; i++) values[i] = wide ? view.getUint16(cursor + i * 2) : view.getUint8(cursor + i);
      cursor += count * bytes;
      return values;
    };
    const inputs = Array.from({ length: inCh }, () => interpolateTable(readArray(inEntries), scale));
    const clut = clutLookup(new Array(inCh).fill(points), outCh, readArray(points ** inCh * outCh), scale);
    const outputs = Array.from({ length: outCh }, () => interpolateTable(readArray(outEntries), scale));
    const useMatrix = pcsIsXyzInput && inCh === 3;
    return {
      lab: wide ? 'v2' : 'v4',
      lut: {
        inChannels: inCh, outChannels: outCh,
        run: (input) => {
          let values = input;
          if (useMatrix) values = [0, 1, 2].map((r) => matrix[r * 3] * input[0] + matrix[r * 3 + 1] * input[1] + matrix[r * 3 + 2] * input[2]);
          return clut(values.map((v, i) => inputs[i](v))).map((v, i) => outputs[i](v));
        },
      },
    };
  }
  if (type === 'mAB ' || type === 'mBA ') {
    const forward = type === 'mAB ';
    const inCh = view.getUint8(at + 8), outCh = view.getUint8(at + 9);
    const offsets = [12, 16, 20, 24, 28].map((o) => view.getUint32(at + o));
    const [offB, offMatrix, offM, offClut, offA] = offsets;
    const curves = (offset: number, count: number): CurveFn[] | null => {
      if (!offset) return null;
      let cursor = at + offset;
      return Array.from({ length: count }, () => {
        const { fn, size: used } = readCurve(view, cursor);
        cursor += (used + 3) & ~3;
        return fn;
      });
    };
    // Curves sit on the PCS side (B), the device side (A), and M between the matrix and the table.
    const pcsCh = forward ? outCh : inCh, devCh = forward ? inCh : outCh;
    const B = curves(offB, pcsCh), M = curves(offM, pcsCh), A = curves(offA, devCh);
    const matrix = offMatrix ? Array.from({ length: 12 }, (_, i) => s15(view, at + offMatrix + i * 4)) : null;
    let clut: ((input: readonly number[]) => number[]) | null = null;
    if (offClut) {
      const c = at + offClut;
      const clutIn = forward ? inCh : inCh, clutOut = forward ? outCh : outCh;
      const grid = Array.from({ length: clutIn }, (_, i) => view.getUint8(c + i));
      const precision = view.getUint8(c + 16);
      const count = grid.reduce((a, b) => a * b, 1) * clutOut;
      const data = new Uint16Array(count);
      for (let i = 0; i < count; i++) data[i] = precision === 1 ? view.getUint8(c + 20 + i) : view.getUint16(c + 20 + i * 2);
      clut = clutLookup(grid, clutOut, data, precision === 1 ? 255 : 65535);
    }
    const apply = (fns: CurveFn[] | null, v: readonly number[]) => fns ? v.map((x, i) => fns[i](x)) : [...v];
    const mat = (v: readonly number[]) => matrix && v.length === 3
      ? [0, 1, 2].map((r) => matrix[r * 3] * v[0] + matrix[r * 3 + 1] * v[1] + matrix[r * 3 + 2] * v[2] + matrix[9 + r]) : [...v];
    const run = forward
      ? (v: readonly number[]) => apply(B, mat(apply(M, clut ? clut(apply(A, v)) : apply(A, v))))
      : (v: readonly number[]) => apply(A, (() => { const m = apply(M, mat(apply(B, v))); return clut ? clut(m) : m; })());
    return { lab: 'v4', lut: { inChannels: inCh, outChannels: outCh, run } };
  }
  throw new IccProfileError(`This profile stores its colours in a way (${type.trim()}) InFlight cannot read yet.`);
}

function readDescription(view: DataView, at: number): string {
  const type = text4(view, at);
  if (type === 'desc') {
    const count = view.getUint32(at + 8);
    let out = '';
    for (let i = 0; i < count && i < 256; i++) { const c = view.getUint8(at + 12 + i); if (!c) break; out += String.fromCharCode(c); }
    return out;
  }
  if (type === 'mluc') {
    const records = view.getUint32(at + 8);
    if (!records) return '';
    const length = view.getUint32(at + 20), offset = view.getUint32(at + 24);
    let out = '';
    for (let i = 0; i + 1 < length && i < 512; i += 2) out += String.fromCharCode(view.getUint16(at + offset + i));
    return out.replace(/\0+$/, '');
  }
  return '';
}

export function parseIccProfile(bytes: Uint8Array): IccProfile {
  if (bytes.length < 132) throw new IccProfileError('This is not an ICC colour profile.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (text4(view, 36) !== 'acsp') throw new IccProfileError('This is not an ICC colour profile.');
  const pcs = text4(view, 20);
  if (pcs !== 'Lab ' && pcs !== 'XYZ ') throw new IccProfileError('This profile has no standard colour connection, so it cannot be used to proof.');
  const tags = new Map<string, { offset: number; size: number }>();
  const count = view.getUint32(128);
  for (let i = 0; i < count && 132 + i * 12 + 12 <= bytes.length; i++) {
    const entry = 132 + i * 12;
    const offset = view.getUint32(entry + 4), size = view.getUint32(entry + 8);
    if (offset + size <= bytes.length) tags.set(text4(view, entry), { offset, size });
  }
  const pick = (relative: string, perceptual: string) => tags.get(relative) ?? tags.get(perceptual);
  const toTag = pick('B2A1', 'B2A0'), fromTag = pick('A2B1', 'A2B0');
  if (!toTag || !fromTag) throw new IccProfileError('This profile has no printer colour tables. Choose the profile for your printer and paper.');
  const to = readLut(view, toTag.offset, toTag.size, pcs === 'XYZ ');
  const from = readLut(view, fromTag.offset, fromTag.size, false);
  if (to.lut.inChannels !== 3 || from.lut.outChannels !== 3 || to.lut.outChannels !== from.lut.inChannels)
    throw new IccProfileError('This profile’s colour tables do not match each other.');
  const desc = tags.get('desc');
  return {
    description: (desc ? readDescription(view, desc.offset) : '').trim() || 'Unnamed profile',
    version: view.getUint8(8),
    deviceClass: text4(view, 12),
    colourSpace: text4(view, 16).trim(),
    pcs,
    toDevice: to.lut, fromDevice: from.lut,
    intent: tags.has('B2A1') && tags.has('A2B1') ? 'relative' : 'perceptual',
    labEncoding: { toDevice: to.lab, fromDevice: from.lab },
  };
}

// ---- sRGB ↔ Lab (D50) -------------------------------------------------------------------------------------------

const D50 = [0.9642, 1, 0.8249];
const SRGB_TO_XYZ_D50 = [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733];
const XYZ_D50_TO_SRGB = [3.1338561, -1.6168667, -0.4906146, -0.9787684, 1.9161415, 0.033454, 0.0719453, -0.2289914, 1.4052427];
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const mul = (m: readonly number[], v: readonly number[]) => [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export function srgbToLab(rgb: readonly number[]): [number, number, number] {
  const [x, y, z] = mul(SRGB_TO_XYZ_D50, rgb.map(toLinear)).map((v, i) => v / D50[i]);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
export function labToSrgb(lab: readonly number[]): [number, number, number] {
  const fy = (lab[0] + 16) / 116;
  const xyz = [fInv(fy + lab[1] / 500) * D50[0], fInv(fy) * D50[1], fInv(fy - lab[2] / 200) * D50[2]];
  const rgb = mul(XYZ_D50_TO_SRGB, xyz).map((v) => toGamma(Math.min(1, Math.max(0, v))));
  return [rgb[0], rgb[1], rgb[2]];
}
const labToXyz = (lab: readonly number[]) => {
  const fy = (lab[0] + 16) / 116;
  return [fInv(fy + lab[1] / 500) * D50[0], fInv(fy) * D50[1], fInv(fy - lab[2] / 200) * D50[2]];
};
const xyzToLab = (xyz: readonly number[]) => {
  const [x, y, z] = xyz.map((v, i) => v / D50[i]);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};

const XYZ_SCALE = 32768 / 65535;
function encodePcs(profile: IccProfile, lab: readonly number[], encoding: 'v2' | 'v4'): number[] {
  if (profile.pcs === 'XYZ ') return labToXyz(lab).map((v) => v * XYZ_SCALE);
  const k = encoding === 'v2' ? 65280 / 65535 : 1;
  return [lab[0] / 100 * k, (lab[1] + 128) / 255 * k, (lab[2] + 128) / 255 * k];
}
function decodePcs(profile: IccProfile, values: readonly number[], encoding: 'v2' | 'v4'): number[] {
  if (profile.pcs === 'XYZ ') return xyzToLab(values.map((v) => v / XYZ_SCALE));
  const k = encoding === 'v2' ? 65535 / 65280 : 1;
  return [values[0] * k * 100, values[1] * k * 255 - 128, values[2] * k * 255 - 128];
}

/** sRGB (0..1) → what the printer would make of it, back in sRGB, and how far it moved (ΔE 1976). */
export function proofColour(profile: IccProfile, rgb: readonly number[]): { rgb: [number, number, number]; deltaE: number } {
  const lab = srgbToLab(rgb);
  const device = profile.toDevice.run(encodePcs(profile, lab, profile.labEncoding.toDevice));
  const printed = decodePcs(profile, profile.fromDevice.run(device), profile.labEncoding.fromDevice);
  const deltaE = Math.hypot(lab[0] - printed[0], lab[1] - printed[1], lab[2] - printed[2]);
  return { rgb: labToSrgb(printed), deltaE };
}

export interface ProofLut { size: number; rgb: Float32Array; deltaE: Float32Array; profile: string; intent: IccProfile['intent'] }

/** Precompute the proof on a grid, so a whole photo is proofed with one trilinear lookup per pixel. */
export function buildProofLut(profile: IccProfile, size = 33): ProofLut {
  const rgb = new Float32Array(size ** 3 * 3), deltaE = new Float32Array(size ** 3);
  for (let r = 0; r < size; r++) for (let g = 0; g < size; g++) for (let b = 0; b < size; b++) {
    const i = (r * size + g) * size + b;
    const proof = proofColour(profile, [r / (size - 1), g / (size - 1), b / (size - 1)]);
    rgb.set(proof.rgb, i * 3);
    deltaE[i] = proof.deltaE;
  }
  return { size, rgb, deltaE, profile: profile.description, intent: profile.intent };
}

/** Colours that move further than this when printed are counted as ones the printer cannot reach. */
export const OUT_OF_GAMUT_DELTA_E = 6;

/**
 * Proof RGBA pixels in place. With `markOutOfGamut`, colours the printer cannot reach are shown as diagonal grey stripes
 * (a pattern, not a colour alone). With `showProof` false only those marks are drawn on the picture as it is.
 * Returns the share of pixels that are out of reach.
 */
export function applyProofLut(lut: ProofLut, pixels: Uint8ClampedArray, width: number, markOutOfGamut: boolean, showProof = true): number {
  const n = lut.size - 1, s = lut.size;
  let outside = 0;
  const out = [0, 0, 0];
  for (let p = 0, px = 0; p < pixels.length; p += 4, px++) {
    const fr = pixels[p] / 255 * n, fg = pixels[p + 1] / 255 * n, fb = pixels[p + 2] / 255 * n;
    const r0 = Math.min(n - 1, Math.floor(fr)), g0 = Math.min(n - 1, Math.floor(fg)), b0 = Math.min(n - 1, Math.floor(fb));
    const dr = fr - r0, dg = fg - g0, db = fb - b0;
    out[0] = out[1] = out[2] = 0;
    let dE = 0;
    for (let c = 0; c < 8; c++) {
      const ur = c & 1, ug = (c >> 1) & 1, ub = (c >> 2) & 1;
      const w = (ur ? dr : 1 - dr) * (ug ? dg : 1 - dg) * (ub ? db : 1 - db);
      if (!w) continue;
      const i = ((r0 + ur) * s + g0 + ug) * s + b0 + ub;
      out[0] += w * lut.rgb[i * 3]; out[1] += w * lut.rgb[i * 3 + 1]; out[2] += w * lut.rgb[i * 3 + 2];
      dE += w * lut.deltaE[i];
    }
    let write = showProof;
    if (dE > OUT_OF_GAMUT_DELTA_E) {
      outside++;
      if (markOutOfGamut) {
        const x = px % width, y = (px - x) / width;
        const stripe = ((x + y) >> 2) & 1 ? 0.15 : 0.85;
        out[0] = out[1] = out[2] = stripe;
        write = true;
      }
    }
    if (write) { pixels[p] = out[0] * 255; pixels[p + 1] = out[1] * 255; pixels[p + 2] = out[2] * 255; }
  }
  return pixels.length ? outside / (pixels.length / 4) : 0;
}
