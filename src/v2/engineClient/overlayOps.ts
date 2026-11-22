import type { OverlayAnchor, OverlaySettings, OverlayTextRow } from '../ui/contract';
import { createDefaultOverlay } from '../ui/stub';

const ANCHORS: readonly OverlayAnchor[] = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const FIELDS = ['camera', 'lens', 'aperture', 'shutter', 'iso', 'focalLength', 'species', 'custom'] as const;
const WEIGHTS = [400, 500, 600, 700] as const;

const num = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);

function readRow(raw: unknown, fallback: OverlayTextRow): OverlayTextRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id) return null;
  const fields = Array.isArray(row.fields) ? row.fields.filter((field): field is OverlayTextRow['fields'][number] => (FIELDS as readonly unknown[]).includes(field)) : fallback.fields;
  return {
    id: row.id,
    fields,
    customText: typeof row.customText === 'string' ? row.customText.slice(0, 200) : '',
    fontId: typeof row.fontId === 'string' && row.fontId ? row.fontId : fallback.fontId,
    sizePx: num(row.sizePx, fallback.sizePx, 8, 120),
    weight: (WEIGHTS as readonly unknown[]).includes(row.weight) ? (row.weight as OverlayTextRow['weight']) : fallback.weight,
    uppercase: row.uppercase === true,
    letterSpacing: num(row.letterSpacing, fallback.letterSpacing, -2, 10),
  };
}

/** The overlay stored on a photo, read defensively: anything missing or wrong falls back to the default (text and
 * watermark off). A stored overlay can come from an older build or a damaged file, so nothing is trusted. */
export function readOverlay(raw: unknown): OverlaySettings {
  // A new photo's watermark starts on 'auto': light or dark is chosen from the photo behind it.
  const base: OverlaySettings = { ...createDefaultOverlay(false), watermarkContrast: 'auto' };
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Record<string, unknown>;
  const anchor = (candidate: unknown, fallback: OverlayAnchor) => ((ANCHORS as readonly unknown[]).includes(candidate) ? (candidate as OverlayAnchor) : fallback);
  const rows = Array.isArray(value.rows) ? value.rows.map((row) => readRow(row, base.rows[0])).filter((row): row is OverlayTextRow => row !== null) : base.rows;
  return {
    ...base,
    textEnabled: value.textEnabled === true,
    textLayoutMode: value.textLayoutMode === 'cover-full' ? 'cover-full' : 'as-is',
    textPosition: anchor(value.textPosition, base.textPosition),
    textX: num(value.textX, base.textX, 4, 96), textY: num(value.textY, base.textY, 4, 96),
    textOffsetX: num(value.textOffsetX, 0, -40, 40), textOffsetY: num(value.textOffsetY, 0, -40, 40),
    textColour: value.textColour === 'dark' ? 'dark' : 'light',
    textScrim: value.textScrim !== false,
    rows,
    watermarkEnabled: value.watermarkEnabled === true,
    watermarkPresetId: typeof value.watermarkPresetId === 'string' ? value.watermarkPresetId : base.watermarkPresetId,
    watermarkPosition: anchor(value.watermarkPosition, base.watermarkPosition),
    watermarkX: num(value.watermarkX, base.watermarkX, 4, 96), watermarkY: num(value.watermarkY, base.watermarkY, 4, 96),
    watermarkOpacity: num(value.watermarkOpacity, base.watermarkOpacity, 10, 100),
    watermarkScale: num(value.watermarkScale, base.watermarkScale, 40, 160),
    watermarkContrast: value.watermarkContrast === 'dark-on-light' ? 'dark-on-light' : value.watermarkContrast === 'light-on-dark' ? 'light-on-dark' : 'auto',
    snapEnabled: value.snapEnabled !== false,
  };
}

export const patchOverlay = (overlay: OverlaySettings, patch: Partial<OverlaySettings>): OverlaySettings => readOverlay({ ...overlay, ...patch });

export function addRow(overlay: OverlaySettings, id: string): OverlaySettings {
  const row: OverlayTextRow = { id, fields: ['species'], customText: '', fontId: 'playfair', sizePx: 14, weight: 500, uppercase: false, letterSpacing: 0.2 };
  return { ...overlay, textEnabled: true, rows: [...overlay.rows, row] };
}

export const updateRow = (overlay: OverlaySettings, rowId: string, patch: Partial<OverlayTextRow>): OverlaySettings =>
  readOverlay({ ...overlay, rows: overlay.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)) });

export const removeRow = (overlay: OverlaySettings, rowId: string): OverlaySettings => ({ ...overlay, rows: overlay.rows.filter((row) => row.id !== rowId) });

const LAYOUTS = {
  'stacked-left': { textPosition: 'bottom-left', textX: 8, textY: 90, watermarkPosition: 'bottom-left', watermarkX: 8, watermarkY: 78 },
  'opposite-bottom': { textPosition: 'bottom-left', textX: 8, textY: 90, watermarkPosition: 'bottom-right', watermarkX: 92, watermarkY: 90 },
  'centred-pair': { textPosition: 'bottom-center', textX: 50, textY: 88, watermarkPosition: 'bottom-center', watermarkX: 50, watermarkY: 76 },
} as const;

export const alignOverlays = (overlay: OverlaySettings, layout: keyof typeof LAYOUTS): OverlaySettings =>
  readOverlay({ ...overlay, ...LAYOUTS[layout], textOffsetX: 0, textOffsetY: 0 });
