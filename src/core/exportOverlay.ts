import type { ExifMetadata } from './types';
import type { WatermarkOptions } from './watermark';

export interface OverlayOptions {
  on: boolean;
  title?: string;
  location?: string;
  align?: 'left' | 'centre' | 'right';
  scale?: number;
  shade?: number;
  camera: boolean;
  lens: boolean;
  settings: boolean;
  date: boolean;
  place: 'bottom' | 'top';
  /** Light text on a dark fade, or dark text on a light fade. */
  tone: 'light' | 'dark';
  /** A text or picture mark, drawn whether or not the text overlay is on. */
  watermark?: WatermarkOptions;
}

export const NO_OVERLAY: OverlayOptions = { on: false, camera: true, lens: true, settings: true, date: false, place: 'bottom', tone: 'light' };

const trimNumber = (value: number) => String(Number(value.toFixed(1)));

/** The shooting settings as one tidy line, such as "400mm · ƒ/5.6 · 1/2000s · ISO 800". Missing values are left out. */
export function settingsLine(exif: ExifMetadata): string {
  const parts: string[] = [];
  if (exif.focalLengthMm) parts.push(`${Math.round(exif.focalLengthMm)}mm`);
  if (exif.apertureF) parts.push(`ƒ/${trimNumber(exif.apertureF)}`);
  if (exif.shutterSpeed) parts.push(/s$/.test(exif.shutterSpeed) ? exif.shutterSpeed : `${exif.shutterSpeed}s`);
  if (exif.iso) parts.push(`ISO ${exif.iso}`);
  return parts.join(' · ');
}

/** The lines to print on a photo. Only what the photo actually records, and only what was switched on. */
export function overlayLines(exif: ExifMetadata, options: OverlayOptions): string[] {
  if (!options.on) return [];
  const lines = [options.title?.trim(), options.location?.trim()].filter((line): line is string => Boolean(line));
  if (options.camera && exif.camera) lines.push(exif.camera);
  if (options.lens && exif.lens) lines.push(exif.lens);
  if (options.settings) { const line = settingsLine(exif); if (line) lines.push(line); }
  const when = exif.capturedAtMs;
  if (options.date && when && Number.isFinite(when)) lines.push(new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
  return lines;
}
