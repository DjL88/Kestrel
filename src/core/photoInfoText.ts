import type { PhotoFrame } from './types';
import { formatAperture, formatFocalLength } from './exifParser';

/** Human-readable capture date and time, in the photographer's local display locale. */
export function formatCaptureDateTime(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const captured = new Date(ms);
  if (Number.isNaN(captured.getTime())) return '';
  return captured.toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
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
