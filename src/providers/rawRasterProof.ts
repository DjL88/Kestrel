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
