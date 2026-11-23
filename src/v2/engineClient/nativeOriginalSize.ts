/**
 * Original-size output must be grounded in the *decoded full-resolution image*,
 * not the UI's 3000 × 2000 sample preset nor EXIF (which can describe an
 * embedded RAW preview rather than the usable developed pixels).
 *
 * This pure check does not certify any RAW decoder. The caller must obtain the
 * evidence from a verified full-image decoding route. Do not pass a self-
 * asserted claim based only on filename, EXIF, or an image element.
 */
export interface NativeImageEvidence {
  provenance: 'verified-full-image' | 'embedded-preview' | 'unknown';
  /** Full-image dimensions reported by a trusted decoder, not the file EXIF. */
  fullWidth?: number;
  fullHeight?: number;
  /** Dimensions of the actual decoded pixel buffer to be sent to the renderer. */
  decodedWidth: number;
  decodedHeight: number;
  decoderId?: string;
}

export type NativeOriginalSize =
  | { ok: true; width: number; height: number; label: 'Original'; source: 'verified-full-image'; decoderId: string }
  | { ok: false; reason: string; category: 'unverified' | 'invalid' | 'mismatch' };

const valid = (n: unknown): n is number => typeof n === 'number' &&
  Number.isSafeInteger(n) && n > 0 && n <= 100000;

/** Fail closed: all dimensions must be valid and agree; no silently substituted upscales. */
export function verifiedNativeOriginalSize(evidence: NativeImageEvidence): NativeOriginalSize {
  if (!valid(evidence.decodedWidth) || !valid(evidence.decodedHeight)) {
    return { ok: false, category: 'invalid', reason: 'The decoded photograph has no valid pixel dimensions.' };
  }
  if (evidence.provenance !== 'verified-full-image' || !evidence.decoderId?.trim()) {
    return { ok: false, category: 'unverified',
      reason: evidence.provenance === 'embedded-preview'
        ? 'This is an embedded preview, not verified full-resolution image data.'
        : 'The full-resolution source has not been verified by a decoder.' };
  }
  if (!valid(evidence.fullWidth) || !valid(evidence.fullHeight)) {
    return { ok: false, category: 'invalid', reason: 'The decoder did not report valid full-image dimensions.' };
  }
  if (evidence.decodedWidth !== evidence.fullWidth || evidence.decodedHeight !== evidence.fullHeight) {
    return { ok: false, category: 'mismatch',
      reason: 'The decoded image size differs from the verified full-image dimensions. Original-size export is unavailable.' };
  }
  return { ok: true, width: evidence.decodedWidth, height: evidence.decodedHeight,
    label: 'Original', source: 'verified-full-image', decoderId: evidence.decoderId.trim() };
}
