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

/** Plain-text camera details only: no GPS, serial numbers, file paths or photos. */
export function photoInfoText(frame: PhotoFrame): string {
  const exif = frame.exif;
  const rows: [string, string | number | undefined][] = [
    ['File', frame.filename],
    ['Camera', exif.camera],
    ['Lens', exif.lens],
    ['Focal length', formatFocalLength(exif.focalLengthMm)],
    ['Aperture', formatAperture(exif.apertureF)],
    ['Shutter', exif.shutterSpeed],
    ['ISO', exif.iso],
    ['Captured', formatCaptureDateTime(exif.capturedAtMs)],
    ['Dimensions', exif.width && exif.height ? `${exif.width} × ${exif.height}` : undefined],
    ['Rating', frame.rating !== undefined ? `${frame.rating}/5` : undefined],
    ['Decision', frame.decision === 'unreviewed' ? undefined : frame.decision === 'keep' ? 'Keep' : 'Reject'],
  ];
  return rows.filter(([, value]) => value !== undefined && value !== '').map(([label, value]) => `${label}: ${value}`).join('\n');
}
