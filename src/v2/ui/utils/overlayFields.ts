import type { OverlayFieldId, OverlayTextRow, Photo } from '../contract';

/**
 * Every field a text row can show, in the order the field picker lists them, with where it comes from. Shared by the
 * Overlays panel, the canvas, the export and (through `formatOverlayRowText`) anything else that draws overlay text, such
 * as a collage caption. A field the photo does not have gives nothing: it is never printed as "Not recorded" or "ISO 0".
 */
export type OverlayFieldGroup = 'camera' | 'file' | 'subject' | 'text';

export const OVERLAY_FIELDS: ReadonlyArray<{ id: OverlayFieldId; group: OverlayFieldGroup }> = [
  { id: 'camera', group: 'camera' },
  { id: 'lens', group: 'camera' },
  { id: 'focalLength', group: 'camera' },
  { id: 'aperture', group: 'camera' },
  { id: 'shutter', group: 'camera' },
  { id: 'iso', group: 'camera' },
  { id: 'capturedAt', group: 'file' },
  { id: 'title', group: 'file' },
  { id: 'filename', group: 'file' },
  { id: 'fileFormat', group: 'file' },
  { id: 'dimensions', group: 'file' },
  { id: 'rating', group: 'file' },
  { id: 'species', group: 'subject' },
  { id: 'category', group: 'subject' },
  { id: 'custom', group: 'text' },
];

export const OVERLAY_FIELD_IDS: readonly OverlayFieldId[] = OVERLAY_FIELDS.map((field) => field.id);

/** The rows a photo's overlay may hold. Enough for any caption; a bound so a damaged file cannot ask for thousands. */
export const MAX_OVERLAY_ROWS = 12;

/** Words the catalogue uses for a value the file did not record. Treated as no value. */
const UNKNOWN = new Set(['', 'not recorded', 'unknown', 'n/a', '—', '-']);

const known = (value: string | undefined | null): string | null => {
  const clean = (value ?? '').trim();
  return UNKNOWN.has(clean.toLowerCase()) ? null : clean;
};

/** "24/11/2026, 14:05:09" (how the catalogue writes the capture time) as just the date, "24/11/2026". */
const dateOnly = (value: string) => value.split(',')[0].trim();

/** What one field says on this photo, or null when the photo does not have it. `custom` is the row's own words. */
export function overlayFieldValue(field: OverlayFieldId, photo: Photo, customText = ''): string | null {
  const { exif } = photo;
  switch (field) {
    case 'camera': return known(exif.camera);
    case 'lens': return known(exif.lens);
    case 'aperture': return known(exif.aperture);
    case 'shutter': return known(exif.shutter);
    case 'iso': return Number.isFinite(exif.iso) && exif.iso > 0 ? `ISO ${exif.iso}` : null;
    case 'focalLength': return known(exif.focalLength);
    case 'capturedAt': { const value = known(exif.capturedAt); return value ? dateOnly(value) : null; }
    case 'dimensions': return known(exif.dimensions);
    case 'fileFormat': return known(exif.fileFormat);
    case 'filename': return known(photo.filename);
    case 'title': return known(photo.title);
    case 'rating': return photo.rating > 0 ? '★'.repeat(Math.min(5, Math.round(photo.rating))) : null;
    case 'species': return known(photo.speciesLabel);
    case 'category': return known(photo.category);
    case 'custom': return known(customText);
    default: return null;
  }
}

export const OVERLAY_SEPARATOR = '  ·  ';

/** A row's words on this photo: its fields in order, the missing ones left out. Empty when it has nothing to say. */
export function formatOverlayRowText(row: Pick<OverlayTextRow, 'fields' | 'customText' | 'uppercase'>, photo: Photo): string {
  const tokens = row.fields.map((field) => overlayFieldValue(field, photo, row.customText)).filter((value): value is string => !!value);
  const joined = tokens.join(OVERLAY_SEPARATOR);
  return row.uppercase ? joined.toUpperCase() : joined;
}

/** The fields a row can still add (each once), with this photo's value for each so the person sees what they will get. */
export function fieldChoices(row: Pick<OverlayTextRow, 'fields' | 'customText'>, photo: Photo) {
  return OVERLAY_FIELDS.filter((field) => !row.fields.includes(field.id)).map((field) => ({
    ...field,
    value: field.id === 'custom' ? null : overlayFieldValue(field.id, photo, row.customText),
  }));
}

/** A row's fields with one moved one place earlier (-1) or later (+1). Unchanged at either end. */
export function moveInList<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
