import exifr from 'exifr';
import type { ExifMetadata } from './types';

/** Nikon TIFF-based RAW formats supported by the embedded-JPEG preview adapter. */
export function isNikonEmbeddedPreviewFile(filename: string): boolean {
  return /\.(nef|nrw)$/i.test(filename);
}

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

/** Invalid or non-finite camera metadata must never reach the UI or catalogue. */
export function validExifPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function validExifDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
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

export function formatCameraLabel(make?: unknown, model?: unknown): string | undefined {
  // Corrupt EXIF may contain non-string Make/Model values. Preserve other
  // metadata rather than letting .trim() throw and discard the whole parse.
  // TIFF ASCII tags may contain NUL terminators or malformed control bytes.
  // Keep camera identity stable for display and Nikon burst grouping.
  const clean = (value: unknown) =>
    typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const cleanMake = clean(make);
  const cleanModel = clean(model);
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

export function readEmbeddedRating(xmp: unknown, tiff: unknown): Pick<ExifMetadata, 'rating' | 'rejectedByMetadata'> {
  const value = xmp ?? tiff;
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?[0-5]$/.test(value.trim()) ? Number(value) : NaN;
  if (number === -1) return { rejectedByMetadata: true };
  if (Number.isInteger(number) && number >= 0 && number <= 5) return { rating: number };
  return {};
}

export async function parseImageExif(
  file: Blob,
  filename: string
): Promise<ExifMetadata> {
  const lower = filename.toLowerCase();
  const isNikonRaw = isNikonEmbeddedPreviewFile(filename);

  try {
    const segments = await exifr.parse(file, { xmp: true, mergeOutput: false, gps: false, interop: false });
    const parsed = { ...segments?.ifd0, ...segments?.exif };
    const rating = readEmbeddedRating(segments?.xmp?.Rating, parsed.Rating);

    // A malformed DateTimeOriginal must not mask a valid CreateDate fallback.
    const capturedAtMs = [parsed.DateTimeOriginal, parsed.CreateDate]
      .find((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()))
      ?.getTime();

    const shutter = formatShutterSpeed(
      typeof parsed.ExposureTime === 'number' ? parsed.ExposureTime : undefined
    );

    const width =
      validExifDimension(parsed.ExifImageWidth) ?? validExifDimension(parsed.ImageWidth);
    const height =
      validExifDimension(parsed.ExifImageHeight) ?? validExifDimension(parsed.ImageHeight);

    return {
      ...rating,
      camera: formatCameraLabel(parsed.Make, parsed.Model),
      lens: typeof parsed.LensModel === 'string' && parsed.LensModel.trim() ? parsed.LensModel.trim() : undefined,
      focalLengthMm:
        validExifPositiveNumber(parsed.FocalLength),
      apertureF:
        validExifPositiveNumber(parsed.FNumber),
      shutterSpeed: shutter || undefined,
      iso: validExifPositiveNumber(parsed.ISO),
      capturedAtMs,
      width,
      height,
      formatLabel: isNikonRaw ? `${lower.endsWith('.nrw') ? 'NRW' : 'NEF'} Embedded Preview` : lower.endsWith('.png') ? 'PNG' : lower.endsWith('.webp') ? 'WebP' : 'JPEG',
      isEmbeddedPreviewOnly: isNikonRaw,
    };
  } catch {
    return {
      formatLabel: isNikonRaw ? `${lower.endsWith('.nrw') ? 'NRW' : 'NEF'} Embedded Preview` : undefined,
      isEmbeddedPreviewOnly: isNikonRaw,
    };
  }
}
