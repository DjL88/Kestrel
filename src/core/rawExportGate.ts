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
  /** Encoder-confirmed output container; canvas PNG/JPEG is not a 16-bit TIFF. */
  outputFormat: 'tiff' | 'png' | 'jpeg' | 'unknown';
  /** Actual samples written per channel, not the precision of an earlier intermediate. */
  encodedBitsPerChannel: 8 | 16 | 'unknown';
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
  if (!evidence.decoder?.trim() || !evidence.decoderVersion?.trim() ||
      evidence.decoder.trim().toLowerCase() === 'unknown' ||
      evidence.decoderVersion.trim().toLowerCase() === 'unknown') {
    return reject('The RAW decoder and its version are not recorded.');
  }
  if (!/^[a-f0-9]{64}$/i.test(evidence.originalSha256 ?? '')) {
    return reject('The original RAW SHA-256 is missing or invalid.');
  }
  if (!Number.isSafeInteger(evidence.width) || evidence.width <= 0 ||
      !Number.isSafeInteger(evidence.height) || evidence.height <= 0) {
    return reject('The decoded image dimensions are invalid.');
  }
  if (evidence.outputFormat !== 'tiff' || evidence.encodedBitsPerChannel !== 16) {
    return reject('A verified 16-bit TIFF encoder is required; an 8-bit canvas or JPEG output cannot qualify.');
  }
  if (!evidence.outputIccProfile?.trim() || evidence.outputIccProfile.trim().toLowerCase() === 'unknown') {
    return reject('The export colour profile is not recorded.');
  }
  return {
    allowed: true, precision: evidence.precision,
    originalSha256: evidence.originalSha256!,
    decoder: evidence.decoder, iccProfile: evidence.outputIccProfile,
  };
}

/**
 * Bind a verified RAW export decision to the original selected for this job.
 * Decoder evidence alone may belong to an earlier photo or a stale cache entry.
 * The expected hash must come from the independently verified original identity,
 * never from the evidence being checked.
 */
export function requireRaw16ExportForOriginal(
  evidence: RawDecodeEvidence | null | undefined,
  expectedOriginalSha256: string | null | undefined,
): Raw16ExportDecision {
  const decision = requireProvenRaw16Export(evidence);
  if (!decision.allowed) return decision;
  if (!/^[a-f0-9]{64}$/i.test(expectedOriginalSha256 ?? '')) {
    return { allowed: false, reason: 'The selected original has no verified SHA-256 identity.' };
  }
  if (decision.originalSha256.toLowerCase() !== expectedOriginalSha256!.toLowerCase()) {
    return { allowed: false, reason: 'The developed RAW pixels belong to a different original.' };
  }
  return decision;
}
