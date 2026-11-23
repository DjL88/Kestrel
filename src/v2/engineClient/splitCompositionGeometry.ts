/** Pixel geometry for a whole split composition, without resampling originals. */
export type SplitFrameCount = 1 | 2 | 3;
export interface SplitCompositionGeometry {
  frameCount: SplitFrameCount;
  frameWidth: number;
  frameHeight: number;
  totalWidth: number;
  totalHeight: number;
  frameOffsets: number[];
}
/** Returns undefined for invalid or oversized compositions instead of silently clamping. */
export function splitCompositionGeometry(
  frameWidth: number, frameHeight: number, frameCount: SplitFrameCount,
): SplitCompositionGeometry | undefined {
  if (![1, 2, 3].includes(frameCount) ||
      !Number.isSafeInteger(frameWidth) || !Number.isSafeInteger(frameHeight) ||
      frameWidth < 1 || frameHeight < 1 ||
      frameWidth > 20000 || frameHeight > 20000 ||
      frameWidth * frameCount > 20000) return undefined;
  return {
    frameCount, frameWidth, frameHeight,
    totalWidth: frameWidth * frameCount, totalHeight: frameHeight,
    frameOffsets: Array.from({ length: frameCount }, (_, index) => index * frameWidth),
  };
}
/** Reversible view-only mapping between frame-local and composition-wide X. */
export function compositionX(localX: number, frameIndex: number, geometry: SplitCompositionGeometry): number | undefined {
  if (!Number.isFinite(localX) || !Number.isInteger(frameIndex) ||
      frameIndex < 0 || frameIndex >= geometry.frameCount ||
      localX < 0 || localX > geometry.frameWidth) return undefined;
  return geometry.frameOffsets[frameIndex] + localX;
}
export function frameLocalX(combinedX: number, frameIndex: number, geometry: SplitCompositionGeometry): number | undefined {
  if (!Number.isFinite(combinedX) || !Number.isInteger(frameIndex) ||
      frameIndex < 0 || frameIndex >= geometry.frameCount) return undefined;
  const x = combinedX - geometry.frameOffsets[frameIndex];
  return x >= 0 && x <= geometry.frameWidth ? x : undefined;
}
