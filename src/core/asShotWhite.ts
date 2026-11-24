/**
 * White balance in kelvin (gap G4, ROADMAP.md). The RAW decoder (crates/kestrel-raw, `scene_develop::as_shot_white`)
 * estimates the camera's as-shot white from the file's own white-balance coefficients and colour matrix, and writes it
 * into a comment in the developed JPEG (`develop::with_as_shot_comment`). This module reads that comment and turns a
 * chosen temperature into channel gains on linear sRGB, relative to the as-shot white the develop already balanced to
 * neutral. The as-shot figure is an estimate, never the camera maker's own number; JPEGs and files without it keep the
 * relative Warmth control.
 */

export interface AsShotWhite {
  /** Correlated colour temperature, kelvin. */
  kelvin: number;
  /** Distance from the Planckian locus in CIE 1960 uv; positive is greener. */
  duv: number;
}

export const KELVIN_MIN = 2000;
export const KELVIN_MAX = 25000;
const PREFIX = 'InFlight-AsShotWhite/1 ';

export function validAsShot(value: unknown): value is AsShotWhite {
  if (typeof value !== 'object' || value === null) return false;
  const { kelvin, duv } = value as Record<string, unknown>;
  return typeof kelvin === 'number' && Number.isFinite(kelvin) && kelvin >= KELVIN_MIN && kelvin <= KELVIN_MAX
    && typeof duv === 'number' && Number.isFinite(duv) && Math.abs(duv) <= 0.05;
}

/** Read the decoder's as-shot comment from the start of a developed JPEG; null when there is none. */
export function readAsShotWhite(bytes: Uint8Array): AsShotWhite | null {
  if (bytes.length < 6 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  // Walk the header segments up to the first image data; the comment is written first, but tolerate others before it.
  for (let guard = 0; guard < 32 && at + 4 <= bytes.length; guard += 1) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) return null;
    if (marker === 0xfe) {
      const text = new TextDecoder().decode(bytes.subarray(at + 4, at + 2 + length));
      if (text.startsWith(PREFIX)) {
        const match = /^K=(\d+(?:\.\d+)?) Duv=(-?\d+(?:\.\d+)?)$/.exec(text.slice(PREFIX.length));
        const value = match ? { kelvin: Number(match[1]), duv: Number(match[2]) } : null;
        return validAsShot(value) ? value : null;
      }
    }
    at += 2 + length;
  }
  return null;
}

export async function readAsShotWhiteFromBlob(blob: Blob): Promise<AsShotWhite | null> {
  return readAsShotWhite(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()));
}

/** Chromaticity of the Planckian locus at `kelvin` (Kim et al. cubic spline, 1,667 to 25,000 K). */
export function planckianXy(kelvin: number): [number, number] {
  const t = Math.min(KELVIN_MAX, Math.max(1667, kelvin));
  const x = t <= 4000
    ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
    : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039;
  const y = t <= 2222
    ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
    : t <= 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

/** Linear sRGB (D65 primaries) of a white of chromaticity xy with Y = 1. */
function srgbOfXy([x, y]: [number, number]): [number, number, number] {
  const X = x / y;
  const Z = (1 - x - y) / y;
  return [
    3.2404542 * X - 1.5371385 - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 + 0.041556 * Z,
    0.0556434 * X - 0.2040259 + 1.0572252 * Z,
  ];
}

/**
 * Linear-sRGB channel gains that re-balance a picture developed at `asShotK` to `targetK` (a von Kries scaling on sRGB
 * primaries, an approximation of re-developing with new coefficients). Normalised so a neutral grey keeps its
 * brightness. A higher target means the light is taken as bluer, so the picture turns warmer, as in other editors.
 */
export function whiteBalanceGains(asShotK: number, targetK: number): [number, number, number] {
  const from = srgbOfXy(planckianXy(asShotK));
  const to = srgbOfXy(planckianXy(targetK));
  // Very warm targets put sRGB blue near zero; keep any one channel within 8 times either way.
  const raw = [0, 1, 2].map((c) => Math.min(8, Math.max(1 / 8, from[c] / Math.max(1e-6, to[c]))));
  const luma = 0.2126 * raw[0] + 0.7152 * raw[1] + 0.0722 * raw[2];
  return [raw[0] / luma, raw[1] / luma, raw[2] / luma];
}

/** A white-balance edit: the as-shot estimate it was made against, and the chosen temperature. */
export interface WhiteBalanceEdit {
  asShotK: number;
  kelvin: number;
}

export function validWhiteBalance(value: unknown): value is WhiteBalanceEdit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { asShotK, kelvin } = value as Record<string, unknown>;
  const inRange = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= KELVIN_MIN && v <= KELVIN_MAX;
  return inRange(asShotK) && inRange(kelvin) && Object.keys(value).every((k) => k === 'asShotK' || k === 'kelvin');
}

/** Absent, at the as-shot value, or malformed (ignored by renderers, refused by the 16-bit export). */
export function isNeutralWhiteBalance(value: unknown): boolean {
  return !validWhiteBalance(value) || Math.abs(value.kelvin - value.asShotK) < 1;
}
