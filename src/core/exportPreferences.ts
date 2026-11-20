import { customFormat, formatById, type BarStyle, type Fit, type CustomSize } from './exportFormats';
import { NO_OVERLAY, type OverlayOptions } from './exportOverlay';
import type { NameTemplate } from './exportNaming';
import { parseWatermark } from './watermarkStore';

export const EXPORT_PREFERENCES_KEY = 'kestrel.exportPreferences.v1';

export interface ExportPreferences {
  fits: Record<string, Fit>;
  overrides: Record<string, { prefix?: string; quality?: number }>;
  turned: Record<string, boolean>;
  bars: BarStyle;
}

export function readExportPreferences(storage: Pick<Storage, 'getItem'>): ExportPreferences {
  const result: ExportPreferences = { fits: {}, overrides: {}, turned: {}, bars: 'white' };
  try {
    const saved = JSON.parse(storage.getItem(EXPORT_PREFERENCES_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return result;
    if (saved.bars === 'white' || saved.bars === 'black' || saved.bars === 'blur') result.bars = saved.bars;
    for (const [id, fit] of Object.entries(saved.fits ?? {})) {
      if (formatById(id) && (fit === 'fill' || fit === 'bars' || fit === 'keep')) result.fits[id] = fit;
    }
    for (const [id, value] of Object.entries(saved.turned ?? {})) {
      if (formatById(id) && typeof value === 'boolean') result.turned[id] = value;
    }
    for (const [id, value] of Object.entries(saved.overrides ?? {})) {
      if (!formatById(id) || !value || typeof value !== 'object') continue;
      const { prefix, quality } = value as { prefix?: unknown; quality?: unknown };
      result.overrides[id] = {
        ...(typeof prefix === 'string' ? { prefix: prefix.slice(0, 24) } : {}),
        ...(typeof quality === 'number' && Number.isFinite(quality) && quality >= 0 && quality <= 1 ? { quality } : {}),
      };
    }
  } catch { /* Optional preferences must not prevent opening Export. */ }
  return result;
}

export const EXPORT_PRESETS_KEY = 'kestrel.exportPresets.v1';
export interface ExportPreset extends ExportPreferences {
  name: string;
  formats: string[];
  /** Optional for presets saved before complete export recipes were supported. */
  overlay?: OverlayOptions;
  naming?: NameTemplate;
  custom?: CustomSize;
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Presets contain presentation choices only, never photo IDs, source paths or permissions. */
function readOverlay(value: unknown): OverlayOptions | undefined {
  if (!object(value)) return undefined;
  const watermark = parseWatermark(JSON.stringify(value.watermark ?? null));
  // Match the upload control: portable raster artwork only, with a bounded local payload.
  if (watermark.imageData && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(watermark.imageData) ||
      watermark.imageData.length > 4_000_024)) {
    watermark.imageData = undefined;
    if (watermark.kind === 'image') watermark.on = false;
  }
  return {
    ...NO_OVERLAY, on: value.on === true,
    title: typeof value.title === 'string' ? value.title.slice(0, 100) : '',
    location: typeof value.location === 'string' ? value.location.slice(0, 100) : '',
    align: value.align === 'centre' || value.align === 'right' ? value.align : 'left',
    scale: bounded(value.scale, 0.75, 1.75, 1), shade: bounded(value.shade, 0, 1, 0.62),
    camera: value.camera !== false, lens: value.lens !== false, settings: value.settings !== false,
    date: value.date === true, place: value.place === 'top' ? 'top' : 'bottom',
    tone: value.tone === 'dark' ? 'dark' : 'light', watermark,
  };
}

function readCustom(value: unknown): CustomSize | undefined {
  if (!object(value) || (value.format !== 'jpeg' && value.format !== 'png') ||
      !['keep', 'fill', 'bars'].includes(value.fit as string) || typeof value.prefix !== 'string') return undefined;
  const custom: CustomSize = {
    width: value.width as number, height: value.height as number, fit: value.fit as Fit,
    format: value.format, quality: value.quality as number,
    prefix: value.prefix.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 24),
  };
  return 'format' in customFormat(custom) ? custom : undefined;
}

export function readExportPresets(storage: Pick<Storage, 'getItem'>): ExportPreset[] {
  try {
    const saved: unknown = JSON.parse(storage.getItem(EXPORT_PRESETS_KEY) ?? 'null');
    if (!Array.isArray(saved)) return [];
    const names = new Set<string>();
    const presets: ExportPreset[] = [];
    for (const entry of saved.slice(0, 20)) {
      if (!object(entry) || typeof entry.name !== 'string' || !Array.isArray(entry.formats)) continue;
      const name = entry.name.trim().slice(0, 40);
      const formats = [...new Set<string>(entry.formats.filter((id: unknown) => typeof id === 'string' && formatById(id)))];
      const custom = readCustom(entry.custom);
      if (!name || (!formats.length && !custom) || names.has(name.toLowerCase())) continue;
      names.add(name.toLowerCase());
      const overlay = readOverlay(entry.overlay);
      const naming = object(entry.naming) && typeof entry.naming.name === 'string'
        ? { name: entry.naming.name.slice(0, 60), numbers: entry.naming.numbers === 'sequence' ? 'sequence' as const : 'original' as const }
        : undefined;
      presets.push({ ...readExportPreferences({ getItem: () => JSON.stringify(entry) }), name, formats,
        ...(overlay ? { overlay } : {}), ...(naming ? { naming } : {}), ...(custom ? { custom } : {}),
      });
    }
    return presets;
  } catch {
    return [];
  }
}
