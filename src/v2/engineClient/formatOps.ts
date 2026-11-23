import { DEFAULT_CROP } from './cropOps';
import type { SizePreset } from '../ui/contract';

/**
 * Each photo's own set of formats on top of the built-in list: which built-ins are switched off, and any custom or duplicated
 * formats. Stored on the photo (so it is saved, backed up and used by the export) and read defensively, because a stored value
 * can come from an older build or a damaged file.
 */
export interface CustomFormat { id: string; label: string; width: number; height: number }
export interface FormatSet { disabled: string[]; custom: CustomFormat[] }

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
  return { disabled, custom };
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
  const base = defaults.map((size) => (formats.disabled.includes(size.id) ? { ...size, enabled: false } : size));
  const extra: SizePreset[] = formats.custom.map((custom, index) => ({
    id: custom.id, label: custom.label, platform: 'custom', width: custom.width, height: custom.height,
    ratioLabel: ratioLabelFor(custom.width, custom.height), kind: 'photo', enabled: !formats.disabled.includes(custom.id), linked: true,
    crop: { ...DEFAULT_CROP }, boardX: 40 * (index + 1), boardY: 40 * (index + 1),
  }));
  return [...base, ...extra];
}

export function toggleFormat(raw: unknown, id: string): FormatSet {
  const formats = readFormats(raw);
  return { ...formats, disabled: formats.disabled.includes(id) ? formats.disabled.filter((entry) => entry !== id) : [...formats.disabled, id] };
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
  if (formats.custom.some((custom) => custom.id === id)) return { ...formats, custom: formats.custom.filter((custom) => custom.id !== id), disabled: formats.disabled.filter((entry) => entry !== id) };
  return formats.disabled.includes(id) ? formats : { ...formats, disabled: [...formats.disabled, id] };
}

export const newCustomId = (seed: string) => `custom-${seed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12).padEnd(3, '0')}`;
