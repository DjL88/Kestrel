import type { CullingState } from '../../core/types';
import type { OverlayAnchor, OverlaySettings, OverlayTextRow } from '../ui/contract';
import { ANCHORS } from '../ui/utils/overlayLayout';
import { readOverlay } from './overlayOps';
import { changePhotoOverlay } from './overlayHistory';

/** A brand kit (K080): the logo, colours and text style a person puts on every export, saved on this device.
 * It holds style only. The photo keeps its own words and image layers, and nothing is ever written to an original. */
export interface BrandKit {
  id: string;
  name: string;
  /** The logo: a saved watermark (text or the person's own artwork) and where it sits. */
  watermarkPresetId: string;
  watermarkPosition: OverlayAnchor;
  watermarkOpacity: number;
  watermarkScale: number;
  /** Colours: the watermark's light or dark choice, and the text colour and backing. */
  watermarkContrast: OverlaySettings['watermarkContrast'];
  textColour: OverlaySettings['textColour'];
  textScrim: boolean;
  /** Text style, given to every text row. */
  textAlign: OverlaySettings['textAlign'];
  fontId: string;
  weight: OverlayTextRow['weight'];
  uppercase: boolean;
  letterSpacing: number;
  savedAt: number;
}

export const BRAND_KITS_KEY = 'inflight-v2-brand-kits'; // starts with "inflight" so Erase this device removes it
export const MAX_KITS = 12;
export const MAX_KIT_NAME = 40;
const ID = /^kit-[a-z0-9]{3,24}$/;
const WEIGHTS = [400, 500, 600, 700] as const;

const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, MAX_KIT_NAME);
const num = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** The style parts of an overlay, as a kit would keep them. */
function styleOf(overlay: OverlaySettings): Omit<BrandKit, 'id' | 'name' | 'savedAt'> {
  const row = overlay.rows[0];
  return {
    watermarkPresetId: overlay.watermarkPresetId,
    watermarkPosition: overlay.watermarkPosition,
    watermarkOpacity: overlay.watermarkOpacity,
    watermarkScale: overlay.watermarkScale,
    watermarkContrast: overlay.watermarkContrast,
    textColour: overlay.textColour,
    textScrim: overlay.textScrim,
    textAlign: overlay.textAlign,
    fontId: row?.fontId ?? 'jakarta',
    weight: row?.weight ?? 600,
    uppercase: row?.uppercase ?? false,
    letterSpacing: row?.letterSpacing ?? 0,
  };
}

/** One stored kit, made valid; undefined when it cannot be trusted. */
function readKit(raw: unknown): BrandKit | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== 'string' || !ID.test(item.id)) return undefined;
  const name = typeof item.name === 'string' ? cleanName(item.name) : '';
  if (!name || typeof item.watermarkPresetId !== 'string' || !item.watermarkPresetId) return undefined;
  const base = styleOf(readOverlay(undefined));
  return {
    id: item.id,
    name,
    watermarkPresetId: item.watermarkPresetId.slice(0, 80),
    watermarkPosition: (ANCHORS as readonly unknown[]).includes(item.watermarkPosition) ? item.watermarkPosition as OverlayAnchor : base.watermarkPosition,
    watermarkOpacity: num(item.watermarkOpacity, base.watermarkOpacity, 10, 100),
    watermarkScale: num(item.watermarkScale, base.watermarkScale, 40, 160),
    watermarkContrast: item.watermarkContrast === 'light-on-dark' || item.watermarkContrast === 'dark-on-light' ? item.watermarkContrast : 'auto',
    textColour: item.textColour === 'dark' ? 'dark' : 'light',
    textScrim: item.textScrim !== false,
    textAlign: item.textAlign === 'left' || item.textAlign === 'center' || item.textAlign === 'right' ? item.textAlign : base.textAlign,
    fontId: typeof item.fontId === 'string' && item.fontId ? item.fontId.slice(0, 80) : base.fontId,
    weight: (WEIGHTS as readonly unknown[]).includes(item.weight) ? item.weight as OverlayTextRow['weight'] : base.weight,
    uppercase: item.uppercase === true,
    letterSpacing: num(item.letterSpacing, base.letterSpacing, -2, 10),
    savedAt: typeof item.savedAt === 'number' && Number.isFinite(item.savedAt) ? item.savedAt : 0,
  };
}

/** Read what was saved, defensively: a bad or repeated entry is dropped. */
export function readBrandKits(raw: string | null | undefined): BrandKit[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const list: BrandKit[] = [];
  for (const entry of parsed) {
    const kit = readKit(entry);
    if (!kit || seen.has(kit.id)) continue;
    seen.add(kit.id);
    list.push(kit);
    if (list.length >= MAX_KITS) break;
  }
  return list;
}

export type KitProblem = 'empty' | 'full' | 'missing';

/** Save a photo's logo, colours and text style as a new kit. */
export function addBrandKit(list: readonly BrandKit[], name: string, overlay: OverlaySettings, id: string, now: number): BrandKit[] | KitProblem {
  const clean = cleanName(name);
  if (!clean) return 'empty';
  if (list.length >= MAX_KITS) return 'full';
  if (!ID.test(id) || list.some((kit) => kit.id === id)) return 'missing';
  return [...list, { id, name: clean, ...styleOf(readOverlay(overlay)), savedAt: now }];
}

/** Edit a kit: a new name, and optionally the style of another photo in place of the old one. */
export function editBrandKit(list: readonly BrandKit[], id: string, change: { name?: string; overlay?: OverlaySettings }, now: number): BrandKit[] | KitProblem {
  const kit = list.find((entry) => entry.id === id);
  if (!kit) return 'missing';
  const name = change.name === undefined ? kit.name : cleanName(change.name);
  if (!name) return 'empty';
  const style = change.overlay ? styleOf(readOverlay(change.overlay)) : {};
  return list.map((entry) => (entry.id === id ? { ...entry, ...style, name, savedAt: change.overlay ? now : entry.savedAt } : entry));
}

export const deleteBrandKit = (list: readonly BrandKit[], id: string): BrandKit[] => list.filter((kit) => kit.id !== id);

/** A photo's overlay with the kit put on: the logo switched on in the kit's place, and the kit's colours and text style.
 * The photo's own words, text position and image layers stay as they were. */
export function overlayWithKit(overlay: OverlaySettings, kit: BrandKit): OverlaySettings {
  const current = readOverlay(overlay);
  return readOverlay({
    ...current,
    watermarkEnabled: true,
    watermarkPresetId: kit.watermarkPresetId,
    watermarkPosition: kit.watermarkPosition,
    watermarkPlacement: 'anchor',
    watermarkOpacity: kit.watermarkOpacity,
    watermarkScale: kit.watermarkScale,
    watermarkContrast: kit.watermarkContrast,
    textColour: kit.textColour,
    textScrim: kit.textScrim,
    textAlign: kit.textAlign,
    rows: current.rows.map((row) => ({ ...row, fontId: kit.fontId, weight: kit.weight, uppercase: kit.uppercase, letterSpacing: kit.letterSpacing })),
  });
}

/** Put a kit on each of these live photos, each with its own Undo step in its History. Photos that already match are left alone. */
export function applyBrandKitToProject(state: CullingState, kit: BrandKit, photoIds: readonly string[], at: number): { state: CullingState; changed: number } {
  const ids = new Set(photoIds);
  let changed = 0;
  const frames = state.frames.map((frame) => {
    if (!ids.has(frame.id) || frame.removedAt !== undefined) return frame;
    const updated = changePhotoOverlay(frame, (current) => overlayWithKit(current, kit), at);
    if (updated !== frame) changed += 1;
    return updated;
  });
  return changed ? { state: { ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames }, changed } : { state, changed: 0 };
}
