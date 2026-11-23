/** Admission gate for a future 16-bit develop/export bridge.
 * This does not decode RAW or certify Nikon colour fidelity. Untrusted decoder
 * metadata is checked before a caller may describe pixels as full RAW 16-bit.
 */
export interface Raw16Candidate {
  source: 'sensor-decoder' | 'embedded-preview' | 'system-jpeg' | 'canvas-rgba8';
  pixelFormat: 'rgb-u16le' | 'rgba-u8' | 'jpeg';
  width: number;
  height: number;
  bytes: Uint8Array;
  originalSha256: string;
  colourProfile: { kind: 'embedded-icc'; bytes: Uint8Array } | { kind: 'unknown' };
  /** Decoder must attest that it decoded the complete sensor raster. */
  fullSensorDecode: boolean;
}

export interface AdmittedRaw16 {
  readonly kind: 'full-sensor-rgb16';
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly originalSha256: string;
  readonly icc: Uint8Array;
}

export function admitRaw16(candidate: Raw16Candidate): AdmittedRaw16 {
  if (candidate.source !== 'sensor-decoder' || !candidate.fullSensorDecode ||
      candidate.pixelFormat !== 'rgb-u16le') {
    throw new Error('16-bit RAW export unavailable: no verified full-sensor RGB16 decode.');
  }
  const { width, height } = candidate;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width * height > 200_000_000) {
    throw new Error('16-bit RAW export unavailable: invalid sensor dimensions.');
  }
  if (candidate.bytes.byteLength !== width * height * 6) {
    throw new Error('16-bit RAW export unavailable: incomplete or mismatched RGB16 raster.');
  }
  if (!/^[a-f0-9]{64}$/i.test(candidate.originalSha256)) {
    throw new Error('16-bit RAW export unavailable: missing original SHA-256 identity.');
  }
  if (candidate.colourProfile.kind !== 'embedded-icc' ||
      candidate.colourProfile.bytes.byteLength < 128) {
    throw new Error('16-bit RAW export unavailable: no validated embedded ICC payload.');
  }
  const icc = candidate.colourProfile.bytes;
  // ICC profile size header is big-endian; signature is 'acsp' at byte 36.
  const length = new DataView(icc.buffer, icc.byteOffset, icc.byteLength).getUint32(0, false);
  if (length !== icc.byteLength || String.fromCharCode(...icc.subarray(36, 40)) !== 'acsp') {
    throw new Error('16-bit RAW export unavailable: malformed ICC profile.');
  }
  return { kind: 'full-sensor-rgb16', width, height, pixels: candidate.bytes,
    originalSha256: candidate.originalSha256.toLowerCase(), icc };
}
