/** Evidence supplied by the decoder, never inferred from a file extension or canvas dimensions. */
export type RawSourceKind = 'full-raw-decode' | 'embedded-preview' | 'browser-raster' | 'external-raster' | 'unknown';
export type RawPrecision = 'uint16' | 'float32' | 'rgba8' | 'unknown';
export type RawCompression = 'lossless' | 'he-star' | 'he' | 'unknown';

export interface RawDecodeEvidence {
  sourceKind: RawSourceKind;
  precision: RawPrecision;
  decoder: string | null;
  decoderVersion: string | null;
  originalSha256: string | null;
  width: number;
  height: number;
  /** Verified by the decoder, not guessed from NEF extension or camera model. */
  decodedFromOriginal: boolean;
  /** The actual developed pixel buffer is connected to the export encoder. */
  exportUsesDevelopedPixels: boolean;
  /** Colour management metadata for the export encoder, not a browser display profile guess. */
  outputIccProfile: string | null;
  compression: RawCompression;
}

export type Raw16ExportDecision =
  | { allowed: true; precision: 'uint16' | 'float32'; originalSha256: string; decoder: string; iccProfile: string }
  | { allowed: false; reason: string };

/** Reject unverifiable 16-bit claims, even when a JPEG preview has full sensor dimensions. */
export function requireProvenRaw16Export(evidence: RawDecodeEvidence | null | undefined): Raw16ExportDecision {
  const reject = (reason: string): Raw16ExportDecision => ({ allowed: false, reason });
  if (!evidence) return reject('No RAW decode provenance is available.');
  if (evidence.sourceKind !== 'full-raw-decode' || !evidence.decodedFromOriginal) {
    return reject('The export source is not a verified full RAW decode.');
  }
  if (evidence.precision !== 'uint16' && evidence.precision !== 'float32') {
    return reject('The export pixels are not verified 16-bit-capable developed data.');
  }
  if (!evidence.exportUsesDevelopedPixels) {
    return reject('The export encoder is not connected to the developed RAW pixels.');
  }
  if (!evidence.decoder?.trim() || !evidence.decoderVersion?.trim()) {
    return reject('The RAW decoder and its version are not recorded.');
  }
  if (!/^[a-f0-9]{64}$/i.test(evidence.originalSha256 ?? '')) {
    return reject('The original RAW SHA-256 is missing or invalid.');
  }
  if (!Number.isSafeInteger(evidence.width) || evidence.width <= 0 ||
      !Number.isSafeInteger(evidence.height) || evidence.height <= 0) {
    return reject('The decoded image dimensions are invalid.');
  }
  if (!evidence.outputIccProfile?.trim()) {
    return reject('The export colour profile is not recorded.');
  }
  return {
    allowed: true, precision: evidence.precision,
    originalSha256: evidence.originalSha256!,
    decoder: evidence.decoder, iccProfile: evidence.outputIccProfile,
  };
}
