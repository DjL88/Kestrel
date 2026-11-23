import { DEFAULT_CROP } from './cropOps';
import type { SizePreset } from '../ui/contract';

/**
 * Each photo's own set of formats on top of the built-in list: which built-ins are switched off, and any custom or duplicated
 * formats. Stored on the photo (so it is saved, backed up and used by the export) and read defensively, because a stored value
 * can come from an older build or a damaged file.
 */
export interface CustomFormat { id: string; label: string; width: number; height: number }
export interface FormatSet { disabled: string[]; custom: CustomFormat[]; /** Explicit opt-in for built-ins disabled by default. */ enabled?: string[]; /** Legacy output-size override, retained only for reading old project metadata; never applied to Original. */ originalSize?: { width: number; height: number } }

export const EMPTY_FORMATS: FormatSet = { disabled: [], custom: [] };
export const MAX_CUSTOM_FORMATS = 24;
const MAX_SIDE = 20000;
const CUSTOM_ID = /^custom-[a-z0-9]{3,40}$/;

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 80;

export function readFormats(raw: unknown): FormatSet {
  if (!raw || typeof raw !== 'object') return { disabled: [], custom: [] };
  const value = raw as Record<string, unknown>;
  const disabled = Array.isArray(value.disabled) ? [...new Set(value.disabled.filter(isId))] : [];
  const seen = new Set<string>();
  const custom: CustomFormat[] = [];
  for (const entry of Array.isArray(value.custom) ? value.custom : []) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !CUSTOM_ID.test(item.id) || seen.has(item.id)) continue;
    const width = Number(item.width), height = Number(item.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) continue;
    const label = typeof item.label === 'string' ? item.label.trim().slice(0, 60) : '';
    seen.add(item.id);
    custom.push({ id: item.id, label: label || `${width}×${height}`, width, height });
    if (custom.length >= MAX_CUSTOM_FORMATS) break;
  }
  const enabled = Array.isArray(value.enabled) ? [...new Set(value.enabled.filter(isId))].filter((id) => !disabled.includes(id)) : [];
  const original = value.originalSize as Record<string, unknown> | undefined;
  const originalSize = original && validCustomSize(Number(original.width), Number(original.height))
    ? { width: Number(original.width), height: Number(original.height) } : undefined;
  return { disabled, custom, ...(enabled.length ? { enabled } : {}), ...(originalSize ? { originalSize } : {}) };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** "4:5" when the ratio is a small whole one, otherwise the plain size. */
export function ratioLabelFor(width: number, height: number): string {
  const divisor = gcd(width, height);
  const w = width / divisor, h = height / divisor;
  return w <= 21 && h <= 21 ? `${w}:${h}` : `${width}×${height}`;
}

/**
 * The historical 'orig-3x2' identifier remains for saved crop/board data.
 * It now means Original, NOT a mandatory 3:2 crop. The size is taken from the
 * imported file's known dimensions, never a saved output override.
 * No metadata = no invented 3000×2000 original.
 */
export const ORIGINAL_FORMAT_ID = 'orig-3x2';
export const THREE_TWO_FORMAT_ID = 'format-3x2';

/** Original cannot be resized. Add a separate custom format for another output size. */
export function setOriginalOutputSize(_raw: unknown, _width: number, _height: number): FormatSet | undefined {
  return undefined;
}

export function resetOriginalOutputSize(raw: unknown): FormatSet {
  const { originalSize: _unused, ...rest } = readFormats(raw);
  return rest;
}

/** The built-ins with this photo's switches applied, followed by its custom ones. */
export function applyFormats(
  defaults: readonly SizePreset[], raw: unknown,
  nativeSize?: { width: number; height: number } | null,
): SizePreset[] {
  const formats = readFormats(raw);
  // A legacy originalSize is deliberately ignored: Original always represents imported pixels.
  const original = nativeSize && validCustomSize(nativeSize.width, nativeSize.height) ? nativeSize : null;
  const base = defaults.map((size) => ({
    ...size,
    ...(size.id === ORIGINAL_FORMAT_ID ? {
      label: 'Original',
      width: original?.width ?? 1,
      height: original?.height ?? 1,
      ratioLabel: original ? ratioLabelFor(original.width, original.height) : 'Unknown',
    } : {}),
    enabled: !formats.disabled.includes(size.id) &&
      (formats.enabled?.includes(size.id) === true || size.enabled) &&
      (size.id !== ORIGINAL_FORMAT_ID || !!original),
  }));
  const extra: SizePreset[] = formats.custom.map((custom, index) => ({
    id: custom.id, label: custom.label, platform: 'custom', width: custom.width, height: custom.height,
    ratioLabel: ratioLabelFor(custom.width, custom.height), kind: 'photo', enabled: !formats.disabled.includes(custom.id), linked: true,
    crop: { ...DEFAULT_CROP }, boardX: 40 * (index + 1), boardY: 40 * (index + 1),
  }));
  return [...base, ...extra];
}

/** Toggle without losing a built-in's original default (including opt-in presets). */
export function toggleFormat(raw: unknown, id: string, defaultEnabled = true): FormatSet {
  const formats = readFormats(raw);
  const isEnabled = !formats.disabled.includes(id) && (formats.enabled?.includes(id) === true || defaultEnabled);
  const enabled = (formats.enabled ?? []).filter((entry) => entry !== id);
  if (isEnabled) return { ...formats, disabled: [...formats.disabled, id], ...(enabled.length ? { enabled } : { enabled: undefined }) };
  const nextEnabled = defaultEnabled ? enabled : [...enabled, id];
  return { ...formats, disabled: formats.disabled.filter((entry) => entry !== id), ...(nextEnabled.length ? { enabled: nextEnabled } : { enabled: undefined }) };
}

export function validCustomSize(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= MAX_SIDE && height <= MAX_SIDE;
}

/** A new custom format, or undefined when the size is not usable or the photo already has the most formats allowed. */
export function addFormat(raw: unknown, label: string, width: number, height: number, id: string): FormatSet | undefined {
  const formats = readFormats(raw);
  if (!validCustomSize(width, height) || formats.custom.length >= MAX_CUSTOM_FORMATS || !CUSTOM_ID.test(id)) return undefined;
  return { ...formats, custom: [...formats.custom, { id, label: label.trim().slice(0, 60) || `${width}×${height}`, width, height }] };
}

/** Delete: a custom format is removed; a built-in is switched off (it can be switched back on in the Formats panel). */
export function removeFormat(raw: unknown, id: string): FormatSet {
  const formats = readFormats(raw);
  if (formats.custom.some((custom) => custom.id === id)) return { ...formats, custom: formats.custom.filter((custom) => custom.id !== id), disabled: formats.disabled.filter((entry) => entry !== id), enabled: formats.enabled?.filter((entry) => entry !== id) };
  return { ...formats, disabled: formats.disabled.includes(id) ? formats.disabled : [...formats.disabled, id], enabled: formats.enabled?.filter((entry) => entry !== id) };
}

export const newCustomId = (seed: string) => `custom-${seed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12).padEnd(3, '0')}`;

/**
 * Per-format "linked" overrides (paper-clipped to the active edit group vs independent), keyed by format id. A format with
 * no entry is linked — that is every format's starting state — so the map only needs to record the ones the person has
 * unlinked or deliberately relinked, and a damaged or stale value just falls back to "linked" rather than losing formats.
 */
export type SizeLinkedSet = Record<string, boolean>;

export function readSizeLinked(raw: unknown): SizeLinkedSet {
  if (!raw || typeof raw !== 'object') return {};
  const result: SizeLinkedSet = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isId(id) && typeof value === 'boolean') result[id] = value;
  }
  return result;
}

export function isSizeLinked(raw: unknown, id: string): boolean {
  const linked = readSizeLinked(raw);
  return id in linked ? linked[id] : true;
}

export function toggleSizeLinked(raw: unknown, id: string): SizeLinkedSet {
  const linked = readSizeLinked(raw);
  const next = id in linked ? !linked[id] : false;
  return { ...linked, [id]: next };
}

/** Applies this photo's linked overrides to a list of sizes (built-in defaults plus any custom formats). */
export function applySizeLinked(sizes: readonly SizePreset[], raw: unknown): SizePreset[] {
  const linked = readSizeLinked(raw);
  return sizes.map((size) => (size.id in linked ? { ...size, linked: linked[size.id] } : size));
}

/**
 * Rotate format / swap width and height: changes the output canvas's own orientation (4:3 landscape <-> 3:4
 * portrait, A4 portrait <-> A4 landscape), never the photograph's pixels or EXIF orientation - that stays
 * rotateCrop's job (a different, separately-labelled command). Width and height swap; ratioLabel is
 * recomputed from the new pair so a label like "4:3" correctly becomes "3:4" rather than staying stale.
 *
 * zoom resets to DEFAULT_CROP.zoom (1): renderV2Export's own cover-fit formula - `max(out.w/fw, out.h/fh) *
 * zoom` - already scales to whichever frame it is given, so zoom=1 is a valid, fully-covering fit for the
 * *new* width/height just as it was for the old ones, with no letterboxing and no guessed-at correction
 * factor. panX/panY (the focal point), the inset/flip/rotate/border fields, and everything else about the
 * format (id, label, platform, kind, enabled, linked, board position) are left exactly as they were - the
 * owner's spec: keep the subject's focal point as much as possible and let the photographer reposition and
 * zoom afterwards, rather than this function inventing a "perfectly preserving" zoom from geometry it
 * cannot see from here (the actual pixel/crop-rect math lives in renderV2Export.ts and Canvas.tsx, not in
 * any file this function touches).
 */
export function swapFormatOrientation(size: SizePreset): SizePreset {
  const width = size.height, height = size.width;
  return {
    ...size,
    width,
    height,
    ratioLabel: ratioLabelFor(width, height),
    crop: { ...size.crop, zoom: DEFAULT_CROP.zoom },
  };
}
