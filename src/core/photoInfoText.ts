import type { PhotoFrame } from './types';
import { formatAperture, formatFocalLength } from './exifParser';
import { formatCapturedAt } from './formatDate';

/** Human-readable capture date and time, in the language chosen in Settings (British English by default). */
export function formatCaptureDateTime(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const captured = new Date(ms);
  if (Number.isNaN(captured.getTime())) return '';
  return formatCapturedAt(ms);
}

/** The words in the copied details. The component passes them in the person's language, so core stays free of i18n. */
export interface PhotoInfoLabels {
  file: string;
  camera: string;
  lens: string;
  focalLength: string;
  aperture: string;
  shutter: string;
  iso: string;
  captured: string;
  dimensions: string;
  rating: string;
  decision: string;
  keep: string;
  reject: string;
}

/** British English, the default. */
export const PHOTO_INFO_LABELS: PhotoInfoLabels = {
  file: 'File', camera: 'Camera', lens: 'Lens', focalLength: 'Focal length', aperture: 'Aperture', shutter: 'Shutter',
  iso: 'ISO', captured: 'Captured', dimensions: 'Dimensions', rating: 'Rating', decision: 'Decision', keep: 'Pick', reject: 'Reject',
};

/** Plain-text camera details only: no GPS, serial numbers, file paths or photos. */
export function photoInfoText(frame: PhotoFrame, labels: PhotoInfoLabels = PHOTO_INFO_LABELS): string {
  const exif = frame.exif;
  const rows: [string, string | number | undefined][] = [
    [labels.file, frame.filename],
    [labels.camera, exif.camera],
    [labels.lens, exif.lens],
    [labels.focalLength, formatFocalLength(exif.focalLengthMm)],
    [labels.aperture, formatAperture(exif.apertureF)],
    [labels.shutter, exif.shutterSpeed],
    [labels.iso, exif.iso],
    [labels.captured, formatCaptureDateTime(exif.capturedAtMs)],
    [labels.dimensions, exif.width && exif.height ? `${exif.width} × ${exif.height}` : undefined],
    [labels.rating, frame.rating !== undefined ? `${frame.rating}/5` : undefined],
    [labels.decision, frame.decision === 'unreviewed' ? undefined : frame.decision === 'keep' ? labels.keep : labels.reject],
  ];
  return rows.filter(([, value]) => value !== undefined && value !== '').map(([label, value]) => `${label}: ${value}`).join('\n');
}
