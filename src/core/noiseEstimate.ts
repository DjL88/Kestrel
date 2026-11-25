/**
 * How noisy a picture is, as the standard deviation of its luminance noise on a 0-255 scale.
 *
 * Immerkaer's fast estimator (1996): the image is filtered with a 3x3 Laplacian-difference kernel that cancels
 * smooth gradients, and sigma = sqrt(pi/2) / (6 * N) * sum |response|. Real photographs also have texture (feathers,
 * fur, foliage), which the kernel mistakes for noise, so the estimate is taken per 16x16 block and the 20th percentile
 * of blocks is reported: the flattest parts of the frame (sky, background, out-of-focus areas) set the answer.
 * Measures, never edits.
 */
const BLOCK = 16;
const KERNEL_SCALE = Math.sqrt(Math.PI / 2) / 6;

export function estimateNoiseSigma(rgba: Uint8ClampedArray, width: number, height: number): number | null {
  if (width < BLOCK + 2 || height < BLOCK + 2 || rgba.length < width * height * 4) return null;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) luma[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  const blocks: number[] = [];
  for (let by = 1; by + BLOCK < height - 1; by += BLOCK) {
    for (let bx = 1; bx + BLOCK < width - 1; bx += BLOCK) {
      let sum = 0;
      let clipped = 0;
      for (let y = by; y < by + BLOCK; y += 1) {
        for (let x = bx; x < bx + BLOCK; x += 1) {
          const i = y * width + x;
          const c = luma[i];
          // Clipped highlights and crushed shadows hide noise; such blocks would read as falsely clean.
          if (c < 4 || c > 251) clipped += 1;
          const r = luma[i - width - 1] - 2 * luma[i - width] + luma[i - width + 1]
            - 2 * luma[i - 1] + 4 * c - 2 * luma[i + 1]
            + luma[i + width - 1] - 2 * luma[i + width] + luma[i + width + 1];
          sum += Math.abs(r);
        }
      }
      if (clipped > (BLOCK * BLOCK) / 4) continue;
      blocks.push((KERNEL_SCALE * sum) / (BLOCK * BLOCK));
    }
  }
  if (blocks.length < 4) return null;
  blocks.sort((a, b) => a - b);
  return blocks[Math.floor(blocks.length * 0.2)];
}

/** Below this the noise is not visible at normal viewing; denoise changes nothing and says so. */
export const VISIBLE_NOISE_SIGMA = 1.2;

/**
 * Luminance denoise strength (PhotoEdit.denoiseLuminance, 0-2) for a measured sigma. Conservative: grows slowly with
 * the noise and caps at 1.6, and the verified render may still reduce it if subject detail suffers.
 */
export function luminanceStrengthFor(sigma: number | null): number {
  if (sigma === null || !Number.isFinite(sigma) || sigma < VISIBLE_NOISE_SIGMA) return 0;
  return Math.min(1.6, Math.round((sigma - VISIBLE_NOISE_SIGMA + 0.6) * 0.3 * 100) / 100);
}
