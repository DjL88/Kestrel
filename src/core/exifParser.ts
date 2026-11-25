import exifr from 'exifr';
import type { ExifMetadata } from './types';
import { heifFormatLabel, isHeifFile, isRawPreviewFile, rawPreviewLabel } from './rawFormats';
import { readHeifExif } from './heifExif';
import { rawSensorSize } from './rawSensorSize';

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

/** The GPS position, when the file has a valid one. exifr gives decimal `latitude` and `longitude` in its GPS block. */
export function readGpsPosition(gps: unknown): { latitude: number; longitude: number } | undefined {
  const block = gps as { latitude?: unknown; longitude?: unknown } | undefined;
  const latitude = block?.latitude, longitude = block?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return undefined;
  return { latitude: Math.round(latitude * 1e6) / 1e6, longitude: Math.round(longitude * 1e6) / 1e6 };
}

/**
 * The true capture instant in UTC, only when the file says it: the GPS date and time (always UTC), or the camera's
 * clock with its recorded time-zone offset. A camera clock without an offset is local time in an unknown zone, so
 * nothing is returned rather than a guess. `original` is exifr's Date, built from the wall-clock fields in this
 * computer's zone, so its local fields are the camera's wall clock.
 */
export function captureInstantUtc(original: unknown, offset: unknown, gps: unknown): number | undefined {
  const block = gps as { GPSDateStamp?: unknown; GPSTimeStamp?: unknown } | undefined;
  const date = typeof block?.GPSDateStamp === 'string' ? /^(\d{4})[:-](\d{2})[:-](\d{2})$/.exec(block.GPSDateStamp.trim()) : null;
  const time = Array.isArray(block?.GPSTimeStamp) ? block.GPSTimeStamp
    : typeof block?.GPSTimeStamp === 'string' ? block.GPSTimeStamp.split(':').map(Number) : null;
  if (date && time?.length === 3 && time.every((part) => typeof part === 'number' && Number.isFinite(part))) {
    const [h, m, sec] = time as number[];
    if (h >= 0 && h < 24 && m >= 0 && m < 60 && sec >= 0 && sec < 61) {
      const ms = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), h, m, 0) + Math.round(sec * 1000);
      if (Number.isFinite(ms)) return ms;
    }
  }
  if (!(original instanceof Date) || !Number.isFinite(original.getTime()) || typeof offset !== 'string') return undefined;
  const zone = /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim());
  if (!zone || Number(zone[2]) > 14 || Number(zone[3]) > 59) return undefined;
  const minutes = (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3]));
  const wall = Date.UTC(original.getFullYear(), original.getMonth(), original.getDate(), original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds());
  return wall - minutes * 60_000;
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

/** EXIF orientations 5 to 8 turn the picture a quarter turn, so the stored width and height swap on screen. exifr
 * reports the orientation as a number or, translated, as text such as "Rotate 90 CW". */
export function isQuarterTurn(orientation: unknown): boolean {
  if (typeof orientation === 'number') return orientation >= 5 && orientation <= 8;
  return typeof orientation === 'string' && /\b(?:90|270)\b/.test(orientation);
}

/**
 * The picture's recorded width and height, as it is shown (after the camera's orientation).
 *
 * In a RAW file the first TIFF directory is often a small thumbnail (a Nikon NEF's is 160 × 120, a different shape
 * from the 3:2 sensor). TIFF marks such a reduced-resolution image with NewSubfileType 1, so a RAW's first-directory
 * size is used only when it is not marked reduced. Otherwise the size is left unknown, and the app measures the
 * shape from the picture it shows rather than guessing it from a thumbnail.
 */
export function recordedDimensions(
  ifd0: Record<string, unknown> | undefined, exif: Record<string, unknown> | undefined, isRaw: boolean,
): { width?: number; height?: number } {
  const exifWidth = validExifDimension(exif?.ExifImageWidth), exifHeight = validExifDimension(exif?.ExifImageHeight);
  const reduced = ifd0?.SubfileType === 1 || ifd0?.NewSubfileType === 1;
  const mainWidth = isRaw && reduced ? undefined : validExifDimension(ifd0?.ImageWidth);
  const mainHeight = isRaw && reduced ? undefined : validExifDimension(ifd0?.ImageHeight);
  const [width, height] = exifWidth && exifHeight ? [exifWidth, exifHeight] : mainWidth && mainHeight ? [mainWidth, mainHeight] : [undefined, undefined];
  if (!width || !height) return {};
  return isQuarterTurn(ifd0?.Orientation) ? { width: height, height: width } : { width, height };
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
    // A RAW's maker segments (XMP, thumbnails) can sit past the bytes read or be malformed. One bad segment must not
    // lose the camera, lens and size, so a failed full read retries with only the main TIFF and EXIF directories.
    const segments = await exifr.parse(metadata, { xmp: true, mergeOutput: false, gps: true, interop: false })
      .catch(() => exifr.parse(metadata, { xmp: false, mergeOutput: false, gps: true, interop: false, ifd1: false, makerNote: false, userComment: false }));
    const parsed = { ...segments?.ifd0, ...segments?.exif };
    const rating = readEmbeddedRating(segments?.xmp?.Rating, parsed.Rating);

    // A malformed DateTimeOriginal must not mask a valid CreateDate fallback.
    const capturedAtMs = validExifCaptureTimestamp(parsed.DateTimeOriginal, parsed.CreateDate);

    const shutter = formatShutterSpeed(validExifPositiveNumber(parsed.ExposureTime));
    const gps = readGpsPosition(segments?.gps);
    const capturedAtUtcMs = captureInstantUtc(parsed.DateTimeOriginal, parsed.OffsetTimeOriginal ?? parsed.OffsetTime, segments?.gps);

    // RAWs: the recorded sensor image size from the file's own IFDs (EXIF often has none, or only the thumbnail's).
    // Without this, a Nikon Z5II NEF landed as a 1x1 "Original" format.
    const sensor = isNikonRaw
      ? await file.slice(0, 2 << 20).arrayBuffer().then((buffer) => rawSensorSize(new Uint8Array(buffer))).catch(() => null)
      : null;
    const recorded = recordedDimensions(segments?.ifd0, segments?.exif, isNikonRaw);
    const width = sensor?.width ?? recorded.width;
    const height = sensor?.height ?? recorded.height;

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
      ...(capturedAtUtcMs !== undefined ? { capturedAtUtcMs } : {}),
      ...(gps ? { gps } : {}),
      ...(validExifPositiveNumber(parsed.ExposureTime) ? { exposureSeconds: validExifPositiveNumber(parsed.ExposureTime) } : {}),
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
