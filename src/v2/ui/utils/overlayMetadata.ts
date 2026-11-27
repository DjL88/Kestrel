import type { OverlayFieldId, OverlayTextRow, Photo } from '../contract';
import { cameraName, lensName } from './nameRules';

export type OverlayField = OverlayFieldId;
type OverlayPhoto = Pick<Photo, 'exif' | 'filename' | 'speciesLabel' | 'pixelSize'> & Partial<Pick<Photo, 'title' | 'rating' | 'category'>>;

/** Where a field comes from, so the picker can group them: the camera, the file, subject detection, or the person's words. */
export type OverlayFieldGroup = 'camera' | 'file' | 'subject' | 'text';

/** The rows one overlay may hold. Enough for any caption, and a bound so a damaged file cannot ask for thousands. */
export const MAX_OVERLAY_ROWS = 12;

/** Known file/subject fields only. Never include private paths, IDs or arbitrary stored objects. */
export const OVERLAY_FIELDS = [
  ['camera', 'Camera'], ['lens', 'Lens'], ['aperture', 'Aperture'], ['shutter', 'Shutter'],
  ['iso', 'ISO'], ['focalLength', 'Focal length'], ['capturedAt', 'Capture date and time'],
  ['fileFormat', 'File format'], ['fileSizeMb', 'File size'], ['dimensions', 'Dimensions'],
  ['colourProfile', 'Colour profile'], ['filename', 'Filename'], ['title', 'Title'], ['rating', 'Star rating'],
  ['species', 'Subject'], ['category', 'Subject type'], ['custom', 'Custom text'],
] as const satisfies ReadonlyArray<readonly [OverlayField, string]>;

const GROUPS: Record<OverlayField, OverlayFieldGroup> = {
  camera: 'camera', lens: 'camera', aperture: 'camera', shutter: 'camera', iso: 'camera', focalLength: 'camera',
  capturedAt: 'file', title: 'file', filename: 'file', fileFormat: 'file', fileSizeMb: 'file', dimensions: 'file', colourProfile: 'file', rating: 'file',
  species: 'subject', category: 'subject', custom: 'text',
};
export const overlayFieldGroup = (field: OverlayField): OverlayFieldGroup => GROUPS[field];

export function isOverlayField(value: unknown): value is OverlayField {
  return OVERLAY_FIELDS.some(([id]) => id === value);
}

const recorded = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return /^(?:not recorded|unknown|—|-)$/i.test(text) ? '' : text;
};
const positive = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function overlayFieldText(field: OverlayField, photo: OverlayPhoto, customText = '', rawNames = false): string {
  switch (field) {
    // Overlays are drawn into exported pixels, so they use the Auto-correct names like the rest of the app, unless the
    // overlay asks for the camera's own words (Dave, 27 Nov). File metadata is never touched.
    case 'camera': { const raw = recorded(photo.exif.camera); return raw && !rawNames ? recorded(cameraName(raw)) || raw : raw; }
    case 'lens': { const raw = recorded(photo.exif.lens); return raw && !rawNames ? recorded(lensName(raw)) || raw : raw; }
    case 'iso': return positive(photo.exif.iso) ? `ISO ${photo.exif.iso}` : '';
    case 'fileSizeMb': return positive(photo.exif.fileSizeMb) ? `${photo.exif.fileSizeMb} MB` : '';
    case 'dimensions': return recorded(photo.exif.dimensions) || (positive(photo.pixelSize?.width) && positive(photo.pixelSize?.height) ? `${photo.pixelSize.width} × ${photo.pixelSize.height}` : '');
    case 'filename': return recorded(photo.filename);
    case 'species': return recorded(photo.speciesLabel);
    case 'category': return recorded(photo.category);
    case 'title': return recorded(photo.title);
    case 'rating': return positive(photo.rating) ? '★'.repeat(Math.min(5, Math.round(photo.rating))) : '';
    case 'custom': return customText.trim();
    default: return recorded(photo.exif[field]);
  }
}

export function overlayFieldChoices(photo: OverlayPhoto, selected: readonly OverlayField[]) {
  return OVERLAY_FIELDS.filter(([id]) => !selected.includes(id) && (id === 'custom' || !!overlayFieldText(id, photo)));
}

export function composeOverlayText(row: OverlayTextRow, photo: OverlayPhoto, rawNames = false): string {
  const text = [...new Set(row.fields)].map(field => overlayFieldText(field, photo, row.customText, rawNames)).filter(Boolean).join('  ·  ');
  return row.uppercase ? text.toUpperCase() : text;
}

/** The list with the item at `index` moved one place earlier (-1) or later (+1). Unchanged at either end. */
export function moveInList<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
