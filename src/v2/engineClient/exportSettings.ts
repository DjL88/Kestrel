import type { ExportDestination, ExportRequest, Photo } from '../ui/contract';

/**
 * Export settings shared by the wizard, quick export ("Export again") and saved presets (G09).
 *
 * All three build their ExportRequest with requestFromSettings, so the same settings always give the same request, the
 * same plan (planExport) and the same files. A preset or the last-used settings never carry photos, edits, crops or
 * folder permissions: only what the wizard asks for.
 */
export type MaxSizeChoice = 'full' | '4096' | '2560' | '1920' | 'custom';

export interface ExportSettings {
  fileFormat: 'jpeg' | 'png';
  /** 1 to 100, as the wizard's slider shows it. */
  jpegQuality: number;
  maxSize: MaxSizeChoice;
  customMaxSize: number;
  destination: ExportDestination;
  /** Formats to export. null means every format switched on for the photo, as the wizard starts. */
  sizeIds: string[] | null;
  includeBefore: boolean;
  includeAfter: boolean;
  includeOriginal: boolean;
}

export interface SavedExportPreset { id: string; name: string; settings: ExportSettings }

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  fileFormat: 'jpeg', jpegQuality: 94, maxSize: 'full', customMaxSize: 1920, destination: 'local-zip',
  sizeIds: null, includeBefore: false, includeAfter: true, includeOriginal: false,
};

export const EXPORT_PRESETS_KEY_V2 = 'inflight.v2.exportPresets.v1';
export const LAST_EXPORT_KEY_V2 = 'inflight.v2.lastExport.v1';
export const MAX_PRESETS = 20;
export const MAX_PRESET_NAME = 40;

const MAX_SIZES: readonly MaxSizeChoice[] = ['full', '4096', '2560', '1920', 'custom'];
const DESTINATIONS: readonly ExportDestination[] = ['local-zip', 'local-individual', 'local-folder'];
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Reads settings without trusting them: anything malformed is refused (null), never half-applied. */
export function parseExportSettings(input: unknown): ExportSettings | null {
  if (!isObject(input)) return null;
  const { fileFormat, jpegQuality, maxSize, customMaxSize, destination, sizeIds, includeBefore, includeAfter, includeOriginal } = input;
  if (fileFormat !== 'jpeg' && fileFormat !== 'png') return null;
  if (typeof jpegQuality !== 'number' || !Number.isInteger(jpegQuality) || jpegQuality < 1 || jpegQuality > 100) return null;
  if (!MAX_SIZES.includes(maxSize as MaxSizeChoice)) return null;
  if (typeof customMaxSize !== 'number' || !Number.isInteger(customMaxSize) || customMaxSize < 1 || customMaxSize > 20000) return null;
  if (!DESTINATIONS.includes(destination as ExportDestination)) return null;
  if (sizeIds !== null && !(Array.isArray(sizeIds) && sizeIds.length <= 100 && sizeIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64))) return null;
  if (typeof includeBefore !== 'boolean' || typeof includeAfter !== 'boolean' || typeof includeOriginal !== 'boolean') return null;
  if (!includeBefore && !includeAfter && !includeOriginal) return null;
  return {
    fileFormat, jpegQuality, maxSize: maxSize as MaxSizeChoice, customMaxSize, destination: destination as ExportDestination,
    sizeIds: sizeIds === null ? null : [...new Set(sizeIds as string[])], includeBefore, includeAfter, includeOriginal,
  };
}

export function maxLongestEdge(settings: Pick<ExportSettings, 'maxSize' | 'customMaxSize'>): number | undefined {
  return settings.maxSize === 'full' ? undefined : settings.maxSize === 'custom' ? settings.customMaxSize : Number(settings.maxSize);
}

/** The photo the export starts from: its switched-on formats and split counts, as the wizard shows them. */
export interface ExportTarget {
  photoId: string;
  enabledSizeIds: readonly string[];
  selectedPhotoIds: readonly string[];
  /** Edit groups chosen in the wizard for a single photo; quick export and presets use the active one. */
  groupIds: readonly string[];
  /** True in the desktop app, where "Save to a folder" replaces "Download individual files". */
  nativeFolder: boolean;
}

/** The target for a photo as the canvas shows it: its switched-on photo formats and its active edit group. */
export function exportTargetFor(photo: Pick<Photo, 'id' | 'sizes' | 'activeGroupId'>, selectedPhotoIds: readonly string[], nativeFolder: boolean, groupIds?: readonly string[]): ExportTarget {
  return {
    photoId: photo.id,
    enabledSizeIds: photo.sizes.filter((size) => size.kind === 'photo' && size.enabled).map((size) => size.id),
    selectedPhotoIds,
    groupIds: groupIds ?? [photo.activeGroupId],
    nativeFolder,
  };
}

/** The formats these settings export for this photo: the chosen ones that are switched on, in the photo's order. */
export function chosenSizeIds(settings: Pick<ExportSettings, 'sizeIds'>, enabledSizeIds: readonly string[]): string[] {
  return settings.sizeIds === null ? [...enabledSizeIds] : enabledSizeIds.filter((id) => settings.sizeIds!.includes(id));
}

/** The one way an ExportRequest is made from settings. */
export function requestFromSettings(settings: ExportSettings, target: ExportTarget, rawMaster = false, rawMasterFormat: 'tiff' | 'png' = 'tiff'): ExportRequest {
  const photoIds = target.selectedPhotoIds.length ? [...target.selectedPhotoIds] : [target.photoId];
  // A folder chosen on the desktop becomes separate downloads on the web, and the other way round: same files.
  const destination: ExportDestination = settings.destination === 'local-zip' ? 'local-zip'
    : target.nativeFolder ? 'local-folder' : 'local-individual';
  return {
    rawMaster,
    ...(rawMaster ? { rawMasterFormat } : {}),
    destination: rawMaster ? 'local-individual' : destination,
    fileFormat: settings.fileFormat,
    jpegQuality: settings.jpegQuality / 100,
    groupIds: photoIds.length === 1 ? [...target.groupIds] : [],
    sizeIds: chosenSizeIds(settings, target.enabledSizeIds),
    includeBefore: settings.includeBefore,
    includeOriginal: settings.includeOriginal,
    includeAfter: settings.includeAfter,
    includeOverlay: true,
    includeWatermark: true,
    includeVideo: false,
    maxLongestEdgePx: maxLongestEdge(settings),
    photoIds,
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function readLastExport(storage: Store): ExportSettings | null {
  try { return parseExportSettings(JSON.parse(storage.getItem(LAST_EXPORT_KEY_V2) ?? 'null')); } catch { return null; }
}

export function writeLastExport(storage: Store, settings: ExportSettings): boolean {
  try { storage.setItem(LAST_EXPORT_KEY_V2, JSON.stringify(settings)); return true; } catch { return false; }
}

export function readPresets(storage: Store): SavedExportPreset[] {
  let raw: unknown;
  try { raw = JSON.parse(storage.getItem(EXPORT_PRESETS_KEY_V2) ?? '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const presets: SavedExportPreset[] = [];
  for (const item of raw.slice(0, MAX_PRESETS)) {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    const name = item.name.trim().slice(0, MAX_PRESET_NAME);
    const settings = parseExportSettings(item.settings);
    if (!name || !settings || presets.some((p) => p.id === item.id)) continue;
    presets.push({ id: item.id, name, settings });
  }
  return presets;
}

export function writePresets(storage: Store, presets: readonly SavedExportPreset[]): boolean {
  try { storage.setItem(EXPORT_PRESETS_KEY_V2, JSON.stringify(presets)); return true; } catch { return false; }
}

export type PresetProblem = 'empty' | 'full';

/** Save settings under a name. The same name (ignoring case) replaces that preset, so there is never a pair to choose between. */
export function savePreset(presets: readonly SavedExportPreset[], name: string, settings: ExportSettings, makeId: () => string):
  { presets: SavedExportPreset[]; saved: SavedExportPreset } | { problem: PresetProblem } {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, MAX_PRESET_NAME);
  if (!clean) return { problem: 'empty' };
  const copy = structuredClone(settings);
  const existing = presets.find((p) => p.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
  if (existing) {
    const saved = { ...existing, name: clean, settings: copy };
    return { presets: presets.map((p) => (p.id === existing.id ? saved : p)), saved };
  }
  if (presets.length >= MAX_PRESETS) return { problem: 'full' };
  const saved = { id: makeId(), name: clean, settings: copy };
  return { presets: [...presets, saved], saved };
}

export function deletePreset(presets: readonly SavedExportPreset[], id: string): SavedExportPreset[] {
  return presets.filter((p) => p.id !== id);
}
