import { Sha256Stream } from '../core/sha256';
import { parseRgb16, type Rgb16Image } from '../core/master16';
import { developRawRgb16, rawSensorMode } from './rawDevelop';
import { rawPrecisionEvidence } from './rawPrecisionGate';

/** Sensor pixels, NOT a scene-linear or ICC-verified archival master. */
export interface SensorWorkingRaster {
  image: Rgb16Image;
  provenance: {
    source: 'sensor-decoded'; sampleBits: 16; encoding: 'display-srgb';
    sceneLinear: false; iccVerified: false; sourceHashVerified: boolean;
    commercialCodecRightsVerified: false; previewExportParityVerified: false;
  };
  allocatedBytes: number;
  /** SHA-256 of original source bytes, not the developed image or embedded preview. */
  sourceSha256?: string;
  sourceBytes?: number;
}
const PROVENANCE = Object.freeze({
  source: 'sensor-decoded' as const, sampleBits: 16 as const,
  encoding: 'display-srgb' as const, sceneLinear: false as const,
  iccVerified: false as const, sourceHashVerified: false as const,
  commercialCodecRightsVerified: false as const, previewExportParityVerified: false as const,
});
/** Validates dimensions before constructing a view; never converts through JPEG. */
export function acceptSensorRgb16(buffer: ArrayBuffer, maxPixels = 80_000_000): SensorWorkingRaster {
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0 || maxPixels > 80_000_000)
    throw new Error('Invalid RAW working-image memory limit.');
  if (buffer.byteLength < 8) throw new Error('The RAW decoder returned no usable pixels.');
  const header = new DataView(buffer);
  const width = header.getUint32(0, true), height = header.getUint32(4, true);
  const pixels = width * height;
  if (!width || !height || !Number.isSafeInteger(pixels) || pixels > maxPixels ||
      buffer.byteLength !== 8 + pixels * 6)
    throw new Error('The sensor working image exceeds the safe size or has invalid dimensions.');
  return { image: parseRgb16(buffer, true), provenance: { ...PROVENANCE }, allocatedBytes: buffer.byteLength };
}
/**
 * SHA-256 of immutable source bytes, in bounded chunks (no second full RAW allocation).
 * This is a source identity, NOT a camera-profile or codec-licence certificate.
 */
export async function hashRawSource(original: Blob, chunkBytes = 1024 * 1024): Promise<string> {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 4096 || chunkBytes > 4 * 1024 * 1024 ||
      !Number.isSafeInteger(original.size) || original.size <= 0)
    throw new Error('Cannot verify empty or invalid RAW source.');
  const sha = new Sha256Stream();
  for (let offset = 0; offset < original.size; offset += chunkBytes) {
    const part = new Uint8Array(await original.slice(offset, Math.min(original.size, offset + chunkBytes)).arrayBuffer());
    if (part.byteLength !== Math.min(chunkBytes, original.size - offset))
      throw new Error('The RAW source changed while it was being read.');
    sha.update(part);
  }
  return sha.digest();
}

/** Opt-in W1 integration seam. No JPEG fallback, no HE/HE* patent bypass. */
export async function openSensorWorkingRaster(
  original: Blob, filename: string, maxPixels = 80_000_000, expectedSourceSha256?: string,
): Promise<SensorWorkingRaster> {
  if (!/\.(nef|nrw|cr2|cr3|arw|raf|rw2|orf|pef|dng|srw|3fr)$/i.test(filename))
    throw new Error('Unsupported RAW extension. The original is unchanged.');
  if (expectedSourceSha256 !== undefined && !/^[0-9a-f]{64}$/.test(expectedSourceSha256))
    throw new Error('The expected original SHA-256 is invalid.');
  // The decoder recognises camera bytes independently of the suffix. Keep the
  // HE check even when an original has been renamed with a different extension.
  rawPrecisionEvidence(await rawSensorMode(original, 'source.nef'));
  // Bind this decode to the exact original selected by the catalogue, if known.
  const sourceBytes = original.size;
  const before = await hashRawSource(original);
  if (expectedSourceSha256 && before !== expectedSourceSha256)
    throw new Error('The selected original no longer matches its recorded SHA-256. No edit source was opened.');
  const decoded = await developRawRgb16(original);
  // Files backed by removable/network storage can change while decoding.
  if (original.size !== sourceBytes || await hashRawSource(original) !== before)
    throw new Error('The original changed during RAW decoding. No edit source was opened.');
  const raster = acceptSensorRgb16(decoded, maxPixels);
  raster.sourceSha256 = before;
  raster.sourceBytes = sourceBytes;
  raster.provenance.sourceHashVerified = Boolean(expectedSourceSha256);
  return raster;
}
