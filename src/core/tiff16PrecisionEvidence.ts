/** Bounded evidence of effective precision in a validated TIFF16 output.
 * Entropy is not proof of camera sensor depth or colour fidelity.
 */
export interface PrecisionEvidence {
  sampledPixels: number;
  nonEightBitAligned: number;
  distinctLowBytes: number;
  status: 'observed-sub8-bit-steps' | 'inconclusive';
}
/** Pixel offset must come from a separately verified uncompressed single-strip TIFF.
 * This reads only 6 bytes per sampled pixel, not a full 45MP image copy.
 */
export async function sampleTiff16Precision(blob: Blob, pixelOffset: number, width: number, height: number, samples = 1024): Promise<PrecisionEvidence> {
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > 80_000_000 ||
      !Number.isSafeInteger(pixelOffset) || pixelOffset < 0 ||
      pixelOffset + pixels * 6 > blob.size ||
      !Number.isSafeInteger(samples) || samples < 1 || samples > 4096) {
    throw new Error('Invalid validated TIFF sampling geometry');
  }
  const count = Math.min(samples, pixels);
  const lows = new Set<number>();
  let nonAligned = 0;
  for (let i = 0; i < count; i++) {
    const pixel = count === 1 ? 0 : Math.floor(i * (pixels - 1) / (count - 1));
    const at = pixelOffset + pixel * 6;
    const b = new Uint8Array(await blob.slice(at, at + 6).arrayBuffer());
    for (let c = 0; c < 3; c++) {
      const lo = b[c * 2], hi = b[c * 2 + 1];
      if (lo !== hi) nonAligned++; // 8-bit-expanded samples have low byte = high byte
      lows.add(lo);
    }
  }
  return {
    sampledPixels: count, nonEightBitAligned: nonAligned, distinctLowBytes: lows.size,
    status: nonAligned > 0 ? 'observed-sub8-bit-steps' : 'inconclusive',
  };
}
