import { encodeTiff16 } from '../core/master16';
import { proveTiff16 } from '../core/tiff16Proof';
import type { SensorWorkingRaster } from './rawWorkingRaster';

/**
 * A deliberately narrow, no-edit proof/export slice for W1 integration.
 * The TIFF and the screen sample originate from ONE sensor-decoded RGB16 raster.
 * The screen sample is only a display quantisation, never the editing master.
 * This does not prove camera ICC accuracy, HE/HE* rights or colour calibration.
 */
export function sensorRasterProof(raster: SensorWorkingRaster): {
  tiff: Blob; width: number; height: number;
  displayPixel: (x: number, y: number) => readonly [number, number, number];
} {
  const { image, provenance } = raster;
  const pixels = image.width * image.height;
  if (provenance.source !== 'sensor-decoded' || provenance.encoding !== 'display-srgb' ||
      provenance.sampleBits !== 16 || !Number.isSafeInteger(pixels) ||
      pixels < 1 || pixels > 80_000_000 || image.data.length !== pixels * 3) {
    throw new Error('Cannot prove a TIFF from an untrusted or malformed sensor raster.');
  }
  const tiff = encodeTiff16(image);
  const displayPixel = (x: number, y: number): readonly [number, number, number] => {
    if (!Number.isInteger(x) || !Number.isInteger(y) ||
        x < 0 || y < 0 || x >= image.width || y >= image.height)
      throw new Error('Display sample is outside the sensor raster.');
    const i = (y * image.width + x) * 3;
    // sRGB is ALREADY encoded. Never apply the sRGB transfer function twice.
    return [Math.round(image.data[i] / 257), Math.round(image.data[i + 1] / 257),
      Math.round(image.data[i + 2] / 257)] as const;
  };
  // Structural TIFF+ICC validation is asynchronous because Blob.arrayBuffer is.
  // Call verifySensorTiff before offering this file as a high-bit output.
  return { tiff, width: image.width, height: image.height, displayPixel };
}

/** Fail closed on missing/invalid output ICC and changed pixel geometry. */
export async function verifySensorTiff(tiff: Blob, expectedWidth: number, expectedHeight: number): Promise<{ iccBytes: number }> {
  if (tiff.type !== 'image/tiff') throw new Error('The output is not a TIFF.');
  const proof = proveTiff16(await tiff.arrayBuffer());
  if (proof.width !== expectedWidth || proof.height !== expectedHeight)
    throw new Error('TIFF dimensions do not match the sensor raster.');
  return { iccBytes: proof.iccBytes };
}

/**
 * Render a bounded, unscaled RGBA preview tile from the SAME RGB16 samples
 * used by sensorRasterProof's TIFF. No canvas colour transform, JPEG roundtrip
 * or second sRGB encoding is applied here. The caller must colour-manage the
 * display and must not promote this 8-bit tile to the editing master.
 *
 * A tile, not a full-frame copy, keeps preview memory bounded on phones.
 * This is a zero-adjustment pixel proof, NOT an ICC-calibrated screen proof.
 */
export function sensorDisplayTile(
  raster: SensorWorkingRaster,
  left: number, top: number, width: number, height: number,
  maxTileBytes = 16 * 1024 * 1024,
): Uint8ClampedArray {
  const { image, provenance } = raster;
  const pixels = image.width * image.height;
  const tilePixels = width * height;
  if (provenance.source !== 'sensor-decoded' || provenance.encoding !== 'display-srgb' ||
      provenance.sampleBits !== 16 || !Number.isSafeInteger(pixels) || pixels <= 0 ||
      image.data.length !== pixels * 3 ||
      ![left, top, width, height, maxTileBytes].every(Number.isSafeInteger) ||
      left < 0 || top < 0 || width <= 0 || height <= 0 ||
      left + width > image.width || top + height > image.height ||
      maxTileBytes <= 0 || maxTileBytes > 16 * 1024 * 1024 ||
      !Number.isSafeInteger(tilePixels) || tilePixels * 4 > maxTileBytes) {
    throw new Error('Invalid or oversized sensor preview tile. The original is unchanged.');
  }
  const rgba = new Uint8ClampedArray(tilePixels * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = ((top + y) * image.width + left + x) * 3;
      const dst = (y * width + x) * 4;
      rgba[dst] = Math.round(image.data[src] / 257);
      rgba[dst + 1] = Math.round(image.data[src + 1] / 257);
      rgba[dst + 2] = Math.round(image.data[src + 2] / 257);
      rgba[dst + 3] = 255;
    }
  }
  return rgba;
}
