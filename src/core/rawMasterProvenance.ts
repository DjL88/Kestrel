/**
 * Evidence gate for advertising a sensor-derived high-precision edit master.
 * A 16-bit container is not proof of 16-bit source information.
 * This module makes no codec/rights claims; callers must supply verified evidence.
 */
export type RawMasterState = 'preview-only' | 'verified-master' | 'blocked';
export interface RawMasterEvidence {
  originalSha256: string;
  decoderId: string;
  decoderVersion: string;
  codec: string;
  compression: 'lossless' | 'nikon-he' | 'nikon-he-star' | 'other';
  rightsVerified: boolean;
  sensorDerived: boolean;
  intermediate: 'sensor-rgb16' | 'sensor-float' | 'jpeg8' | 'preview' | 'unknown';
  sourceBitsPerChannel: number;
  outputBitsPerChannel: number;
  width: number;
  height: number;
  iccProfileId: string;
  colourTransformVerified: boolean;
  referenceTestVerified: boolean;
}
export interface RawMasterDecision {
  state: RawMasterState;
  canExportHighPrecision: boolean;
  reasons: readonly string[];
}
const SHA256 = /^[a-f0-9]{64}$/i;
const safeId = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;

/** Fail closed on missing evidence, including unsupported/uncleared Nikon compression. */
export function assessRawMaster(e: RawMasterEvidence | null | undefined): RawMasterDecision {
  if (!e) return { state: 'preview-only', canExportHighPrecision: false, reasons: ['Only a review preview is available.'] };
  const reasons: string[] = [];
  if (!SHA256.test(e.originalSha256)) reasons.push('Original content identity is not verified.');
  if (!safeId(e.decoderId) || !safeId(e.decoderVersion) || !safeId(e.codec)) reasons.push('Decoder provenance is incomplete.');
  if (!e.rightsVerified) reasons.push('Decoder rights or capability have not been verified.');
  if (!e.sensorDerived || !['sensor-rgb16', 'sensor-float'].includes(e.intermediate)) reasons.push('The editing source is not verified sensor-derived high-precision pixels.');
  if (!Number.isInteger(e.sourceBitsPerChannel) || e.sourceBitsPerChannel <= 8 ||
      !Number.isInteger(e.outputBitsPerChannel) || e.outputBitsPerChannel <= 8 ||
      e.outputBitsPerChannel > 32) reasons.push('Source and output precision are not verified above eight bits.');
  if (!Number.isSafeInteger(e.width) || e.width <= 0 || !Number.isSafeInteger(e.height) || e.height <= 0 ||
      e.width * e.height > 1_000_000_000) reasons.push('Full image dimensions are invalid.');
  if (!safeId(e.iccProfileId) || !e.colourTransformVerified) reasons.push('Colour profile and transform are not verified.');
  if (!e.referenceTestVerified) reasons.push('Reference image fidelity has not been verified.');
  if (!['lossless', 'nikon-he', 'nikon-he-star', 'other'].includes(e.compression)) reasons.push('Compression mode is unknown.');
  return reasons.length
    ? { state: 'blocked', canExportHighPrecision: false, reasons }
    : { state: 'verified-master', canExportHighPrecision: true, reasons: [] };
}
