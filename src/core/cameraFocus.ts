/**
 * Where the camera itself says it focused, read from the maker note the camera wrote into the file. Pure: bytes in,
 * a small record out, nothing guessed. Today this reads Nikon's AFInfo2 record (Expeed 6 and Expeed 7 bodies, the
 * Z 8, Z 9, Z f, Z6III, Z50II and Z5II included), at the offsets ExifTool's public Nikon tag tables document. Other makers
 * and other Nikon layouts give `null`, which means "the file does not say" and is never shown as a focus miss.
 *
 * `area` is the camera's own coordinates, as fractions of the frame the camera measured it in (the sensor, before any
 * rotation for a portrait photo). `uprightArea` is the same box turned by the file's EXIF Orientation, so it lands on the
 * picture as it is shown; it is absent when the orientation is one InFlight cannot read, so a box is never drawn askew.
 */

export type CameraAfAreaMode = 'pinpoint' | 'single' | 'dynamic' | 'wide-s' | 'wide-l' | 'wide-custom' | 'auto' | '3d-tracking';

export interface CameraFocus {
  /** Which record this came from, so a later reader for another maker cannot be confused with it. */
  source: 'nikon-afinfo2';
  /** The AF-area mode active when the shutter fired. Absent when the code is one InFlight does not know. */
  areaMode?: CameraAfAreaMode;
  /** The camera's own focus verdict, when it records one: true for "in focus", false for "out of focus". */
  focusConfirmed?: boolean;
  /** The AF area's top-left corner and size, each a fraction (0 to 1) of the frame. Absent when the camera chose
   * points from its auto-area grid without recording a position. */
  area?: FocusArea;
  /** `area` turned to the picture as shown (after the EXIF Orientation). Absent when there is no area, or the
   * orientation is unreadable. Records read before this field existed lack it too. */
  uprightArea?: FocusArea;
}

export interface FocusArea { x: number; y: number; width: number; height: number }

const ORIENTATION_WORDS: Record<string, number> = {
  'horizontal (normal)': 1, 'mirror horizontal': 2, 'rotate 180': 3, 'mirror vertical': 4,
  'mirror horizontal and rotate 270 cw': 5, 'rotate 90 cw': 6, 'mirror horizontal and rotate 90 cw': 7, 'rotate 270 cw': 8,
};

/** The EXIF Orientation as its number (1 to 8), from the number or exifr's words. Missing means 1, as EXIF says;
 * anything else unreadable gives null. */
export function orientationCode(value: unknown): number | null {
  if (value === undefined || value === null) return 1;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 && value <= 8 ? value : null;
  if (typeof value === 'string') return ORIENTATION_WORDS[value.trim().toLowerCase()] ?? null;
  return null;
}

/** Turns a box measured on the sensor into the picture as shown, for EXIF Orientation 1 to 8. */
export function orientFocusArea(area: FocusArea, orientation: number): FocusArea {
  const { x, y, width: w, height: h } = area;
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const box = (bx: number, by: number, bw: number, bh: number): FocusArea => ({ x: round(bx), y: round(by), width: round(bw), height: round(bh) });
  switch (orientation) {
    case 2: return box(1 - x - w, y, w, h);
    case 3: return box(1 - x - w, 1 - y - h, w, h);
    case 4: return box(x, 1 - y - h, w, h);
    case 5: return box(y, x, h, w);
    case 6: return box(1 - y - h, x, h, w);
    case 7: return box(1 - y - h, 1 - x - w, h, w);
    case 8: return box(y, 1 - x - w, h, w);
    default: return box(x, y, w, h);
  }
}

type Read16 = (at: number) => number;

function tiffReader(bytes: Uint8Array, base: number): { u16: Read16; u32: (at: number) => number } | null {
  if (bytes.length < base + 8) return null;
  const order = String.fromCharCode(bytes[base], bytes[base + 1]);
  if (order !== 'MM' && order !== 'II') return null;
  const big = order === 'MM';
  const u16 = (at: number) => {
    const p = base + at;
    if (p < base || p + 2 > bytes.length) return -1;
    return big ? (bytes[p] << 8) | bytes[p + 1] : bytes[p] | (bytes[p + 1] << 8);
  };
  const u32 = (at: number) => {
    const p = base + at;
    if (p < base || p + 4 > bytes.length) return -1;
    const b = [bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]];
    const [a, c, d, e] = big ? b : b.reverse();
    return ((a << 24) >>> 0) + (c << 16) + (d << 8) + e;
  };
  return u16(2) === 42 ? { u16, u32 } : null;
}

/** The bytes of one tag in a Nikon type-3 maker note ("Nikon\0", version, then its own TIFF header), or null. */
function nikonTag(makerNote: Uint8Array, wanted: number): { bytes: Uint8Array; u16: Read16 } | null {
  const head = String.fromCharCode(...makerNote.subarray(0, 6));
  if (head !== 'Nikon\0') return null;
  const base = 10;
  const tiff = tiffReader(makerNote, base);
  if (!tiff) return null;
  const ifd = tiff.u32(4);
  const count = tiff.u16(ifd);
  if (ifd < 8 || count <= 0 || count > 512) return null;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (tiff.u16(entry) !== wanted) continue;
    const type = tiff.u16(entry + 2), length = tiff.u32(entry + 4);
    if (type !== 7 || length <= 0 || length > 4096) return null;
    const start = length <= 4 ? base + entry + 8 : base + tiff.u32(entry + 8);
    if (start < base || start + length > makerNote.length) return null;
    const bytes = makerNote.subarray(start, start + length);
    const big = makerNote[base] === 0x4d;
    return { bytes, u16: (at) => (at + 2 > bytes.length ? -1 : big ? (bytes[at] << 8) | bytes[at + 1] : bytes[at] | (bytes[at + 1] << 8)) };
  }
  return null;
}

/** Nikon's hybrid-AF area codes (Z bodies), from ExifTool's AFInfo2V0300/V0400 tables. */
const NIKON_AREA_MODES: Record<number, CameraAfAreaMode> = {
  192: 'pinpoint', 193: 'single', 194: 'dynamic', 195: 'wide-s', 196: 'wide-l', 197: 'auto', 199: 'auto',
  204: 'dynamic', 205: 'dynamic', 206: 'dynamic', 207: '3d-tracking', 208: 'wide-custom',
};

/** AFInfo2 (maker-note tag 0x00B7) from a Nikon Expeed 6 or Expeed 7 body. Other versions give null. */
export function parseNikonAfInfo2(record: Uint8Array, u16: Read16): CameraFocus | null {
  if (record.length < 0x36) return null;
  const version = String.fromCharCode(...record.subarray(0, 4));
  const expeed7 = /^040[012]$/.test(version);
  if (!expeed7 && !/^030[01]$/.test(version)) return null;
  if (expeed7 && record.length < 0x4b) return null;
  const at = expeed7 ? 0x3e : 0x2a;
  const result: CameraFocus = { source: 'nikon-afinfo2' };
  const mode = NIKON_AREA_MODES[record[5]];
  if (mode && record[4] === 2) result.areaMode = mode;
  if (expeed7 && (record[0x4a] === 0 || record[0x4a] === 1)) result.focusConfirmed = record[0x4a] === 1;
  const [imageW, imageH, centreX, centreY, areaW, areaH] = [0, 2, 4, 6, 8, 10].map((offset) => u16(at + offset));
  const coordinates = record[7] === 1;
  if (coordinates && imageW > 0 && imageH > 0 && centreX > 0 && centreY > 0 && centreX <= imageW && centreY <= imageH && areaW > 0 && areaH > 0) {
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const x = clamp((centreX - areaW / 2) / imageW), y = clamp((centreY - areaH / 2) / imageH);
    const right = clamp((centreX + areaW / 2) / imageW), bottom = clamp((centreY + areaH / 2) / imageH);
    const round = (value: number) => Math.round(value * 10_000) / 10_000;
    result.area = { x: round(x), y: round(y), width: round(right - x), height: round(bottom - y) };
  }
  return result.areaMode || result.area || result.focusConfirmed !== undefined ? result : null;
}

/**
 * Where the camera focused, from a file's maker note. `make` is the EXIF Make. Returns null when the maker is not one
 * InFlight reads yet, or the record is missing, unknown or damaged: never a guess.
 */
export function readCameraFocus(makerNote: Uint8Array | undefined | null, make: unknown, orientation?: unknown): CameraFocus | null {
  if (!(makerNote instanceof Uint8Array) || typeof make !== 'string') return null;
  if (!/^nikon/i.test(make.trim())) return null;
  try {
    const tag = nikonTag(makerNote, 0x00b7);
    const focus = tag ? parseNikonAfInfo2(tag.bytes, tag.u16) : null;
    const code = orientationCode(orientation);
    if (focus?.area && code !== null) focus.uprightArea = orientFocusArea(focus.area, code);
    return focus;
  } catch {
    return null;
  }
}
