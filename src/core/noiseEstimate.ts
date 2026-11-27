/**
 * How noisy a picture is, as the standard deviation of its luminance noise on a 0-255 scale.
 *
 * Immerkaer's fast estimator (1996): the image is filtered with a 3x3 Laplacian-difference kernel that cancels
 * smooth gradients, and sigma = sqrt(pi/2) / (6 * N) * sum |response|. Real photographs also have texture (feathers,
 * fur, foliage), which the kernel mistakes for noise, so the estimate is taken per 16x16 block and the 20th percentile
 * of blocks is used: the flattest parts set the answer.
 *
 * Noise is not the same in every tone: a RAW is far noisier in its shadows and midtones than in a bright sky. So the
 * blocks are grouped by brightness (shadows, midtones, highlights), each band's flattest blocks give that band's noise,
 * and the noisiest band that covers enough of the picture is reported (Dave, 27 Nov: DJL3766 was visibly noisy, but a
 * clean bright area set the single overall answer and denoise said there was no noise). Measures, never edits.
 */
const BLOCK = 16;
const KERNEL_SCALE = Math.sqrt(Math.PI / 2) / 6;

export function estimateNoiseSigma(rgba: Uint8ClampedArray, width: number, height: number): number | null {
  return measureBackgroundNoise(rgba, width, height).sigma;
}

/** What a noise reading was based on, so the person can be told plainly what was (and was not) measured. */
export interface NoiseMeasurement {
  /** Luminance noise, standard deviation on a 0-255 scale; null when there was too little to measure. */
  sigma: number | null;
  /** 16x16 blocks that were measured. */
  blocks: number;
  /** Blocks left out because they touched the subject. */
  subjectBlocks: number;
  /** True when the subject was left out of the reading. False when no subject was given, or it filled too much of the
   * frame to leave enough background, and the whole frame was read instead. */
  subjectLeftOut: boolean;
}

/** Fewest background blocks worth a reading; fewer than this and the subject's blocks are read too. */
export const MIN_BACKGROUND_BLOCKS = 24;

/**
 * Noise measured from the flattest parts of the whole frame, leaving out the subject when it is given. The subject is
 * where texture (feathers, fur) fools the estimator, and where noise has often been reduced already in camera or by
 * the sharpening that follows; the background is where noise shows. `exclude` has one byte per pixel (non-zero = subject)
 * for the same width and height as `rgba`; a block touching any such pixel is left out. When that leaves under
 * MIN_BACKGROUND_BLOCKS blocks, the whole frame is read as before and `subjectLeftOut` says so. Measures, never edits.
 */
export function measureBackgroundNoise(rgba: Uint8ClampedArray, width: number, height: number, exclude?: Uint8Array): NoiseMeasurement {
  const none: NoiseMeasurement = { sigma: null, blocks: 0, subjectBlocks: 0, subjectLeftOut: false };
  if (width < BLOCK + 2 || height < BLOCK + 2 || rgba.length < width * height * 4) return none;
  const usable = exclude && exclude.length >= width * height ? exclude : undefined;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) luma[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  const blocks: { sigma: number; band: number; subject: boolean }[] = [];
  for (let by = 1; by + BLOCK < height - 1; by += BLOCK) {
    for (let bx = 1; bx + BLOCK < width - 1; bx += BLOCK) {
      let sum = 0;
      let clipped = 0;
      let subject = false;
      for (let y = by; y < by + BLOCK; y += 1) {
        for (let x = bx; x < bx + BLOCK; x += 1) {
          const i = y * width + x;
          if (usable && usable[i]) subject = true;
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
      let mean = 0;
      for (let y = by; y < by + BLOCK; y += 1) for (let x = bx; x < bx + BLOCK; x += 1) mean += luma[y * width + x];
      blocks.push({ sigma: (KERNEL_SCALE * sum) / (BLOCK * BLOCK), band: bandOf(mean / (BLOCK * BLOCK)), subject });
    }
  }
  const subjectBlocks = blocks.filter((block) => block.subject).length;
  const background = blocks.filter((block) => !block.subject);
  const leaveOut = subjectBlocks > 0 && background.length >= MIN_BACKGROUND_BLOCKS;
  const used = leaveOut ? background : blocks;
  if (used.length < 4) return { ...none, blocks: used.length, subjectBlocks };
  return { sigma: sigmaOfBlocks(used), blocks: used.length, subjectBlocks, subjectLeftOut: leaveOut };
}

/** The noisiest tonal band that covers enough of the picture, from each band's flattest blocks. */
function sigmaOfBlocks(blocks: { sigma: number; band: number }[]): number {
  const flattest = (list: number[]) => { list.sort((a, b) => a - b); return list[Math.floor(list.length * 0.2)]; };
  // A band counts when it covers enough of the picture to be seen, so a few odd blocks never decide.
  const enough = Math.max(MIN_BAND_BLOCKS, Math.ceil(blocks.length * MIN_BAND_SHARE));
  let worst: number | null = null;
  for (let band = 0; band < BANDS.length; band += 1) {
    const inBand = blocks.filter((block) => block.band === band).map((block) => block.sigma);
    if (inBand.length < enough) continue;
    const sigma = flattest(inBand);
    worst = worst === null ? sigma : Math.max(worst, sigma);
  }
  // No band large enough (a picture of many small tonal areas): the whole picture's flattest blocks, as before.
  return worst ?? flattest(blocks.map((block) => block.sigma));
}

/** Upper bounds of the tonal bands on 0-255 luminance: shadows, midtones, highlights. */
const BANDS = [85, 170, 256] as const;
const MIN_BAND_BLOCKS = 8;
const MIN_BAND_SHARE = 0.1;
const bandOf = (mean: number) => BANDS.findIndex((top) => mean < top);

/** Below this the noise is not visible at normal viewing; denoise changes nothing and says so. */
export const VISIBLE_NOISE_SIGMA = 0.9;

/** From this ISO up, a reading under the threshold is treated as noise the estimate missed (it samples flat blocks and reads low on fine grain). */
export const HIGH_ISO_FLOOR = 1600;
/** The gentlest strength applied at a high ISO when the measurement alone would apply none. */
export const HIGH_ISO_MIN_STRENGTH = 0.25;

/**
 * Luminance denoise strength (PhotoEdit.denoiseLuminance, 0-2) for a measured sigma. Conservative: grows slowly with
 * the noise and caps at 1.6, and the verified render may still reduce it if subject detail suffers.
 */
export function luminanceStrengthFor(sigma: number | null, iso?: number): number {
  if (sigma === null || !Number.isFinite(sigma)) return 0;
  if (sigma < VISIBLE_NOISE_SIGMA) return typeof iso === 'number' && iso >= HIGH_ISO_FLOOR ? HIGH_ISO_MIN_STRENGTH : 0;
  return Math.min(1.6, Math.round((sigma - VISIBLE_NOISE_SIGMA + 0.6) * 0.3 * 100) / 100);
}

/** "Denoise anyway": the gentle luminance strength used when the person asks for denoise on a photo whose noise read as not visible. */
export const ANYWAY_LUMINANCE_STRENGTH = 0.3;
/** ...and the gentle overall strength it asks the verified recipe for (the same 0 to 2 range as `PhotoEdit.denoise`). */
export const ANYWAY_DENOISE_STRENGTH = 0.4;

/** Luminance strength for "Denoise anyway": the measured need when there is one, never below the gentle default. */
export function anywayLuminanceStrength(sigma: number | null, iso?: number): number {
  return Math.max(ANYWAY_LUMINANCE_STRENGTH, luminanceStrengthFor(sigma, iso));
}
