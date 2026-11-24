import type { OverlayAnchor, OverlaySettings, OverlayStack, OverlayTextRow } from '../ui/contract';
import { createDefaultOverlay } from '../ui/stub';
import { MAX_OVERLAY_ROWS, OVERLAY_FIELD_IDS, moveInList } from '../ui/utils/overlayFields';
import { ANCHORS, DEFAULT_EDGE_MARGIN, alignForAnchor, anchorCentre } from '../ui/utils/overlayLayout';

const FIELDS = OVERLAY_FIELD_IDS;
const WEIGHTS = [400, 500, 600, 700] as const;

const num = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);

function readRow(raw: unknown, fallback: OverlayTextRow): OverlayTextRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id) return null;
  const fields = Array.isArray(row.fields)
    ? [...new Set(row.fields.filter((field): field is OverlayTextRow['fields'][number] => (FIELDS as readonly unknown[]).includes(field)))]
    : fallback.fields;
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
  const rows = Array.isArray(value.rows) ? value.rows.map((row) => readRow(row, base.rows[0])).filter((row): row is OverlayTextRow => row !== null).slice(0, MAX_OVERLAY_ROWS) : base.rows;
  const textPosition = anchor(value.textPosition, base.textPosition);
  const watermarkPosition = anchor(value.watermarkPosition, base.watermarkPosition);
  const textX = num(value.textX, base.textX, 4, 96), textY = num(value.textY, base.textY, 4, 96);
  const watermarkX = num(value.watermarkX, base.watermarkX, 4, 96), watermarkY = num(value.watermarkY, base.watermarkY, 4, 96);
  return {
    ...base,
    textEnabled: value.textEnabled === true,
    textLayoutMode: value.textLayoutMode === 'cover-full' ? 'cover-full' : 'as-is',
    textPosition,
    textPlacement: placement(value.textPlacement, textX, textY),
    textAlign: value.textAlign === 'center' || value.textAlign === 'right' || value.textAlign === 'left' ? value.textAlign : alignForAnchor(textPosition),
    textX, textY,
    textOffsetX: num(value.textOffsetX, 0, -40, 40), textOffsetY: num(value.textOffsetY, 0, -40, 40),
    textColour: value.textColour === 'dark' ? 'dark' : 'light',
    textScrim: value.textScrim !== false,
    rows,
    watermarkEnabled: value.watermarkEnabled === true,
    watermarkPresetId: typeof value.watermarkPresetId === 'string' ? value.watermarkPresetId : base.watermarkPresetId,
    watermarkPosition,
    watermarkPlacement: placement(value.watermarkPlacement, watermarkX, watermarkY),
    watermarkX, watermarkY,
    watermarkOpacity: num(value.watermarkOpacity, base.watermarkOpacity, 10, 100),
    watermarkScale: num(value.watermarkScale, base.watermarkScale, 40, 160),
    watermarkContrast: value.watermarkContrast === 'dark-on-light' ? 'dark-on-light' : value.watermarkContrast === 'light-on-dark' ? 'light-on-dark' : 'auto',
    snapEnabled: value.snapEnabled !== false,
    edgeMargin: num(value.edgeMargin, DEFAULT_EDGE_MARGIN, 0, 12),
  };
}

/** Overlays saved before anchoring existed only kept a centre. One still on a place the position grid or a layout button put
 * it is read as anchored (so it now sits exactly at the margin); one the person dragged elsewhere stays where it was. */
const OLD_GRID_X = [8, 50, 92];
const OLD_GRID_Y = [10, 50, 90, 88, 78, 76];
function placement(value: unknown, x: number, y: number): 'anchor' | 'free' {
  if (value === 'anchor' || value === 'free') return value;
  return OLD_GRID_X.includes(x) && OLD_GRID_Y.includes(y) ? 'anchor' : 'free';
}

export const patchOverlay = (overlay: OverlaySettings, patch: Partial<OverlaySettings>): OverlaySettings => readOverlay({ ...overlay, ...patch });

/** A new, empty row under the others, styled like the last one so a caption stays consistent. The person then chooses its fields. */
export function addRow(overlay: OverlaySettings, id: string): OverlaySettings {
  if (overlay.rows.length >= MAX_OVERLAY_ROWS) return overlay;
  const last = overlay.rows[overlay.rows.length - 1];
  const row: OverlayTextRow = { id, fields: [], customText: '', fontId: last?.fontId ?? 'jakarta', sizePx: last?.sizePx ?? 14, weight: last?.weight ?? 500, uppercase: false, letterSpacing: last?.letterSpacing ?? 0.2 };
  return { ...overlay, textEnabled: true, rows: [...overlay.rows, row] };
}

export function moveRow(overlay: OverlaySettings, rowId: string, direction: -1 | 1): OverlaySettings {
  return { ...overlay, rows: moveInList(overlay.rows, overlay.rows.findIndex((row) => row.id === rowId), direction) };
}

export const updateRow = (overlay: OverlaySettings, rowId: string, patch: Partial<OverlayTextRow>): OverlaySettings =>
  readOverlay({ ...overlay, rows: overlay.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)) });

export const removeRow = (overlay: OverlaySettings, rowId: string): OverlaySettings => ({ ...overlay, rows: overlay.rows.filter((row) => row.id !== rowId) });

/** Text and watermark together at the bottom, one above the other, lined up on the left, the centre or the right. */
export function alignOverlays(overlay: OverlaySettings, stack: OverlayStack): OverlaySettings {
  const position: OverlayAnchor = `bottom-${stack}`;
  const centre = anchorCentre(position);
  return readOverlay({
    ...overlay,
    textPosition: position, textPlacement: 'anchor', textAlign: stack, textX: centre.x, textY: centre.y,
    watermarkPosition: position, watermarkPlacement: 'anchor', watermarkX: centre.x, watermarkY: centre.y,
    textOffsetX: 0, textOffsetY: 0,
  });
}

/** Put one box at a place on the position grid: anchored there, its words lined up to match. */
export function anchorOverlay(overlay: OverlaySettings, which: 'text' | 'watermark', position: OverlayAnchor): OverlaySettings {
  const centre = anchorCentre(position);
  return readOverlay(which === 'text'
    ? { ...overlay, textPosition: position, textPlacement: 'anchor', textAlign: alignForAnchor(position), textX: centre.x, textY: centre.y }
    : { ...overlay, watermarkPosition: position, watermarkPlacement: 'anchor', watermarkX: centre.x, watermarkY: centre.y });
}
