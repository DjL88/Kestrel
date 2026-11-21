import { parseRgb16, type Rgb16Image } from '../core/master16';
import { developRawRgb16, rawSensorMode } from './rawDevelop';

/** Sensor pixels, NOT a scene-linear or ICC-verified archival master. */
export interface SensorWorkingRaster {
  image: Rgb16Image;
  provenance: {
    source: 'sensor-decoded'; sampleBits: 16; encoding: 'display-srgb';
    sceneLinear: false; iccVerified: false; sourceHashVerified: false;
    commercialCodecRightsVerified: false; previewExportParityVerified: false;
  };
  allocatedBytes: number;
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
/** Opt-in W1 integration seam. No JPEG fallback, no HE/HE* patent bypass. */
export async function openSensorWorkingRaster(
  original: Blob, filename: string, maxPixels = 80_000_000,
): Promise<SensorWorkingRaster> {
  if (!/\.(nef|nrw|cr2|cr3|arw|raf|rw2|orf|pef|dng|srw|3fr)$/i.test(filename))
    throw new Error('Unsupported RAW extension. The original is unchanged.');
  const mode = await rawSensorMode(original, filename);
  if (mode === 'nikon-he' || mode === 'nikon-he-star')
    throw new Error('Nikon HE/HE* high-bit editing is unavailable pending commercial codec rights clearance. The original is unchanged.');
  return acceptSensorRgb16(await developRawRgb16(original), maxPixels);
}
