import exifr from 'exifr';
import type { ExifMetadata } from './types';
import { heifFormatLabel, isHeifFile, isRawPreviewFile, rawPreviewLabel } from './rawFormats';
import { readHeifExif } from './heifExif';

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
  // Corrupt subnormal EXIF exposures can overflow 1 / seconds to Infinity.
  // Never display an impossible 1/Infinitys shutter speed.
  if (!Number.isSafeInteger(denominator) || denominator <= 1) return '';
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

/** ISO sensitivity is a positive integer; reject corrupt fractional or unsafe values. */
export function validExifIso(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function validExifDimension(value: unknown): number | undefined {
  // Camera EXIF dimensions are untrusted. Reject impossible axis lengths
  // before they enter catalogue layout or downstream pixel-size calculations.
  // 65,535 is the maximum dimension of a standard JPEG frame, comfortably
  // above Nikon Z8/Z5II sensor dimensions and normal stitched panoramas.
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 65_535 ? value : undefined;
}

/** Prefer original capture time, falling back only when that tag is unusable. */
export function validExifCaptureTimestamp(original: unknown, created: unknown): number | undefined {
  return [original, created]
    .find((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()))
    ?.getTime();
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
    // Look for JPEG SOI followed by a valid JPEG marker (0xFF 0xD8 0xFF, then a non-stuffed marker code)
    if (view[i] === 0xff && view[i + 1] === 0xd8 && view[i + 2] === 0xff &&
      view[i + 3] !== 0x00 && view[i + 3] !== 0xff &&
      view[i + 3] !== 0xd8 && view[i + 3] !== 0xd9) {
      const start = i;
      // Search forward for EOI (0xFF 0xD9) up to a reasonable preview bound
      let j = i + 2;
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
        // A second JPEG SOI before this EOI means the first candidate was
        // truncated. Restart at the new SOI instead of swallowing a valid
        // embedded preview inside the corrupt candidate.
        if (view[j] === 0xff && view[j + 1] === 0xd8 &&
          j + 3 < view.length && view[j + 2] === 0xff &&
          ![0x00, 0xff, 0xd8, 0xd9].includes(view[j + 3])) {
          i = j;
          break;
        }
        // Metadata segments can legitimately contain a complete thumbnail JPEG.
        // Skip their declared payload instead of interpreting its SOI/EOI.
        const marker = view[j + 1];
        if (view[j] === 0xff && marker !== 0x00 && marker !== 0xff &&
          marker !== 0x01 && !(marker >= 0xd0 && marker <= 0xd9) && j + 3 < view.length) {
          const length = (view[j + 2] << 8) | view[j + 3];
          if (length >= 2 && j + 2 + length <= view.length) {
            j += 2 + length;
            continue;
          }
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
  // Malformed XMP must not hide a valid TIFF rating. A valid XMP value,
  // including the explicit -1 reject flag, still takes precedence.
  for (const value of [xmp, tiff]) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?[0-5]$/.test(value.trim()) ? Number(value) : NaN;
    if (number === -1) return { rejectedByMetadata: true };
    if (Number.isInteger(number) && number >= 0 && number <= 5) return { rating: number };
  }
  return {};
}

export async function parseImageExif(
  file: Blob,
  filename: string
): Promise<ExifMetadata> {
  const lower = filename.toLowerCase();
  const isNikonRaw = isRawPreviewFile(filename);
  const isHeif = isHeifFile(filename);
  const formatLabel = isNikonRaw ? rawPreviewLabel(filename) : isHeif ? heifFormatLabel(filename) : undefined;

  try {
    const metadata = isHeif ? await readHeifExif(file) : file;
    if (!metadata) return { formatLabel, isEmbeddedPreviewOnly: false };
    const segments = await exifr.parse(metadata, { xmp: true, mergeOutput: false, gps: false, interop: false });
    const parsed = { ...segments?.ifd0, ...segments?.exif };
    const rating = readEmbeddedRating(segments?.xmp?.Rating, parsed.Rating);

    // A malformed DateTimeOriginal must not mask a valid CreateDate fallback.
    const capturedAtMs = validExifCaptureTimestamp(parsed.DateTimeOriginal, parsed.CreateDate);

    const exposure = parsed.ExposureTime;
    const exposureSeconds = ArrayBuffer.isView(exposure) && !(exposure instanceof DataView)
      ? (exposure as Uint16Array)[0] / (exposure as Uint16Array)[1]
      : exposure;
    const shutter = formatShutterSpeed(validExifPositiveNumber(exposureSeconds));

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
      iso: validExifIso(parsed.ISO),
      capturedAtMs,
      width,
      height,
      formatLabel: formatLabel ?? (lower.endsWith('.png') ? 'PNG' : lower.endsWith('.webp') ? 'WebP' : 'JPEG'),
      isEmbeddedPreviewOnly: isNikonRaw,
    };
  } catch {
    return {
      formatLabel,
      isEmbeddedPreviewOnly: isNikonRaw,
    };
  }
}
