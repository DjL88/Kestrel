import type { OverlayTextRow, Photo } from '../contract';

export type OverlayField = OverlayTextRow['fields'][number];
type OverlayPhoto = Pick<Photo, 'exif' | 'filename' | 'speciesLabel' | 'pixelSize'>;

/** Known file/subject fields only. Never include private paths, IDs or arbitrary stored objects. */
export const OVERLAY_FIELDS = [
  ['camera', 'Camera'], ['lens', 'Lens'], ['aperture', 'Aperture'], ['shutter', 'Shutter'],
  ['iso', 'ISO'], ['focalLength', 'Focal length'], ['capturedAt', 'Capture date and time'],
  ['fileFormat', 'File format'], ['fileSizeMb', 'File size'], ['dimensions', 'Dimensions'],
  ['colourProfile', 'Colour profile'], ['filename', 'Filename'], ['species', 'Subject'], ['custom', 'Custom text'],
] as const satisfies ReadonlyArray<readonly [OverlayField, string]>;

export function isOverlayField(value: unknown): value is OverlayField {
  return OVERLAY_FIELDS.some(([id]) => id === value);
}

const recorded = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return /^(?:not recorded|unknown|—|-)$/i.test(text) ? '' : text;
};
const positive = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function overlayFieldText(field: OverlayField, photo: OverlayPhoto, customText = ''): string {
  switch (field) {
    case 'iso': return positive(photo.exif.iso) ? `ISO ${photo.exif.iso}` : '';
    case 'fileSizeMb': return positive(photo.exif.fileSizeMb) ? `${photo.exif.fileSizeMb} MB` : '';
    case 'dimensions': return recorded(photo.exif.dimensions) || (positive(photo.pixelSize?.width) && positive(photo.pixelSize?.height) ? `${photo.pixelSize.width} × ${photo.pixelSize.height}` : '');
    case 'filename': return recorded(photo.filename);
    case 'species': return recorded(photo.speciesLabel);
    case 'custom': return customText.trim();
    default: return recorded(photo.exif[field]);
  }
}

export function overlayFieldChoices(photo: OverlayPhoto, selected: readonly OverlayField[]) {
  return OVERLAY_FIELDS.filter(([id]) => !selected.includes(id) && (id === 'custom' || !!overlayFieldText(id, photo)));
}

export function composeOverlayText(row: OverlayTextRow, photo: OverlayPhoto): string {
  const text = [...new Set(row.fields)].map(field => overlayFieldText(field, photo, row.customText)).filter(Boolean).join('  ·  ');
  return row.uppercase ? text.toUpperCase() : text;
}
