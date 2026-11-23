import { DEFAULT_CROP } from './cropOps';
import type { SizePreset } from '../ui/contract';

/**
 * Each photo's own set of formats on top of the built-in list: which built-ins are switched off, and any custom or duplicated
 * formats. Stored on the photo (so it is saved, backed up and used by the export) and read defensively, because a stored value
 * can come from an older build or a damaged file.
 */
export interface CustomFormat { id: string; label: string; width: number; height: number }
export interface FormatSet { disabled: string[]; custom: CustomFormat[]; /** Explicit opt-in for built-ins disabled by default. */ enabled?: string[] }

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
  return { disabled, custom, ...(enabled.length ? { enabled } : {}) };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** "4:5" when the ratio is a small whole one, otherwise the plain size. */
export function ratioLabelFor(width: number, height: number): string {
  const divisor = gcd(width, height);
  const w = width / divisor, h = height / divisor;
  return w <= 21 && h <= 21 ? `${w}:${h}` : `${width}×${height}`;
}

/** The built-in formats with this photo's switches applied, followed by its custom ones. */
export function applyFormats(defaults: readonly SizePreset[], raw: unknown): SizePreset[] {
  const formats = readFormats(raw);
  const base = defaults.map((size) => ({ ...size, enabled: !formats.disabled.includes(size.id) &&
    (formats.enabled?.includes(size.id) === true || size.enabled) }));
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
