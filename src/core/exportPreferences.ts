import { formatById, type BarStyle, type Fit } from './exportFormats';

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
