import exifr from 'exifr';
import type { ExifMetadata } from './types';

export function formatShutterSpeed(exposureTimeSec?: number): string {
  if (
    typeof exposureTimeSec !== 'number' ||
    !Number.isFinite(exposureTimeSec) ||
    exposureTimeSec <= 0
  ) {
    return '';
  }

  if (exposureTimeSec >= 0.4) {
    const rounded =
      exposureTimeSec >= 10
        ? Math.round(exposureTimeSec).toString()
        : Number(exposureTimeSec.toFixed(1)).toString();
    return `${rounded}s`;
  }

  const denominator = Math.round(1 / exposureTimeSec);
  if (denominator <= 1) return `${Number(exposureTimeSec.toFixed(2))}s`;
  return `1/${denominator}s`;
}

export function formatAperture(fNumber?: number): string {
  if (typeof fNumber !== 'number' || !Number.isFinite(fNumber) || fNumber <= 0) {
    return '';
  }
  const formatted = Number.isInteger(fNumber)
    ? fNumber.toString()
    : Number(fNumber.toFixed(1)).toString();
  return `f/${formatted}`;
}

export function formatFocalLength(focalLengthMm?: number): string {
  if (
    typeof focalLengthMm !== 'number' ||
    !Number.isFinite(focalLengthMm) ||
    focalLengthMm <= 0
  ) {
    return '';
  }
  return `${Math.round(focalLengthMm)}mm`;
}

export function formatCameraLabel(make?: string, model?: string): string | undefined {
  const cleanMake = make?.trim() ?? '';
  const cleanModel = model?.trim() ?? '';
  if (!cleanMake && !cleanModel) return undefined;
  if (!cleanMake) return cleanModel;
  if (!cleanModel) return cleanMake;
  const primaryMakeWord = cleanMake.split(/\s+/)[0].toUpperCase();
  if (
    cleanModel.toUpperCase().includes(cleanMake.toUpperCase()) ||
    (primaryMakeWord.length >= 3 && cleanModel.toUpperCase().startsWith(primaryMakeWord))
  ) {
    return cleanModel;
  }
  return `${cleanMake} ${cleanModel}`;
}

/**
 * Scans a raw NEF/TIFF buffer for the largest embedded JPEG preview stream (SOI 0xFFD8 .. EOI 0xFFD9).
 * Explicitly marked as embedded preview only — never treated as full RAW decoding.
 */
export function extractEmbeddedJpegFromRawBuffer(
  buffer: ArrayBuffer
): { bytes: Uint8Array; isEmbeddedPreviewOnly: true } | null {
  const view = new Uint8Array(buffer);
  let bestStart = -1;
  let bestEnd = -1;
  let bestLength = 0;

  let i = 0;
  while (i < view.length - 4) {
    // Look for JPEG SOI + JFIF/EXIF/DQT/SOF marker (0xFF 0xD8 0xFF)
    if (view[i] === 0xff && view[i + 1] === 0xd8 && view[i + 2] === 0xff) {
      const start = i;
      // Search forward for EOI (0xFF 0xD9) up to a reasonable preview bound
      let j = i + 3;
      while (j < view.length - 1) {
        if (view[j] === 0xff && view[j + 1] === 0xd9) {
          const end = j + 2;
          const length = end - start;
          // Ignore tiny 160x120 EXIF thumbnails (< 12KB) if a larger preview exists
          if (length > bestLength && length > 4096) {
            bestStart = start;
            bestEnd = end;
            bestLength = length;
          }
          i = end;
          break;
        }
        j += 1;
      }
      if (j >= view.length - 1) {
        i += 3;
      }
    } else {
      i += 1;
    }
  }

  if (bestStart !== -1 && bestEnd > bestStart) {
    return {
      bytes: view.slice(bestStart, bestEnd),
      isEmbeddedPreviewOnly: true,
    };
  }
  return null;
}

export async function parseImageExif(
  file: Blob,
  filename: string
): Promise<ExifMetadata> {
  const lower = filename.toLowerCase();
  const isNef = lower.endsWith('.nef');

  try {
    const parsed = await exifr.parse(file, {
      pick: [
        'Make',
        'Model',
        'LensModel',
        'LensInfo',
        'FocalLength',
        'FNumber',
        'ExposureTime',
        'ISO',
        'DateTimeOriginal',
        'CreateDate',
        'ExifImageWidth',
        'ExifImageHeight',
        'ImageWidth',
        'ImageHeight',
      ],
    });

    if (!parsed) {
      return {
        formatLabel: isNef ? 'NEF Embedded Preview (Simulated Browser Fallback)' : 'JPEG',
        isEmbeddedPreviewOnly: isNef,
      };
    }

    const capturedDate = parsed.DateTimeOriginal ?? parsed.CreateDate;
    const capturedAtMs =
      capturedDate instanceof Date && !Number.isNaN(capturedDate.getTime())
        ? capturedDate.getTime()
        : undefined;

    const shutter = formatShutterSpeed(
      typeof parsed.ExposureTime === 'number' ? parsed.ExposureTime : undefined
    );

    const width =
      typeof parsed.ExifImageWidth === 'number'
        ? parsed.ExifImageWidth
        : typeof parsed.ImageWidth === 'number'
        ? parsed.ImageWidth
        : undefined;
    const height =
      typeof parsed.ExifImageHeight === 'number'
        ? parsed.ExifImageHeight
        : typeof parsed.ImageHeight === 'number'
        ? parsed.ImageHeight
        : undefined;

    return {
      camera: formatCameraLabel(parsed.Make, parsed.Model),
      lens: typeof parsed.LensModel === 'string' && parsed.LensModel.trim() ? parsed.LensModel.trim() : undefined,
      focalLengthMm:
        typeof parsed.FocalLength === 'number' && parsed.FocalLength > 0
          ? parsed.FocalLength
          : undefined,
      apertureF:
        typeof parsed.FNumber === 'number' && parsed.FNumber > 0
          ? parsed.FNumber
          : undefined,
      shutterSpeed: shutter || undefined,
      iso: typeof parsed.ISO === 'number' && parsed.ISO > 0 ? parsed.ISO : undefined,
      capturedAtMs,
      width,
      height,
      formatLabel: isNef ? 'NEF Embedded Preview' : lower.endsWith('.png') ? 'PNG' : 'JPEG',
      isEmbeddedPreviewOnly: isNef,
    };
  } catch {
    return {
      formatLabel: isNef ? 'NEF Embedded Preview' : undefined,
      isEmbeddedPreviewOnly: isNef,
    };
  }
}
