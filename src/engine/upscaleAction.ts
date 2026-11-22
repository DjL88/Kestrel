import { resampleLanczos3, type PixelBuffer } from '../core/upscaleResample';
import { upscaleTiled, type TileModel } from '../core/upscaleTiles';
import type { Pixels } from '../core/colourCheck';
import { verifyEdit, type CourseCorrection } from './enhancementVerifier';
import { runEngineTask } from './taskManager';

/**
 * Upscale as a real, verified action (owner direction, 22 Nov 2026: "Denoise, upscale and masking is more
 * an action than an analysis... it should check the results and course correct"). This wires together two
 * already-shipped, independent layers rather than inventing new pixel maths:
 *  - `upscaleResample.ts`'s deterministic Lanczos-3 resampler - always available, needs no model, and is
 *    already documented there as "the fallback whenever the optional learned enlarger is unavailable or
 *    fails";
 *  - `upscaleTiles.ts`'s `upscaleTiled`, which runs any tile-based learned enlarger (the model itself is
 *    injected, same pattern as `denoiseAction.ts`'s injected `render`).
 *
 * "Course correct" means something different here than for denoise/colour, and that difference is
 * deliberate, not an oversight: a resize has no "strength" to turn down. The only real fallback below a
 * learned enlarger IS the deterministic resampler (as upscaleResample.ts's own comment says), so when the
 * model's result fails verification, this drops the model and re-renders with the plain resampler once -
 * there is nothing further below that to retry with.
 *
 * Verification reuses `enhancementVerifier.ts`'s `verifyEdit` unchanged: the upscaled result is
 * downsampled back to the ORIGINAL size (via the same resampler) and compared against the original, so
 * the same real colour-cast/oversaturation/brightness checks that catch a bad denoise or colour grade
 * also catch a learned enlarger that shifted colour or brightness. `verifyEdit`'s detail-loss check is
 * still evaluated but is not the risk this action is guarding against - a good upscale is SUPPOSED to add
 * detail at full size, and downsampling back to compare erases most of that difference anyway. There is
 * no option yet to skip it; it is read, not relied on, for this action.
 */

export interface UpscaleActionInput {
  /** RGBA, the engine layer's usual Pixels shape - same as denoiseAction.ts and looks.ts take. */
  original: Pixels;
  scale: 2 | 4;
  /** The learned tile enlarger (layer 2). Omit to upscale with the deterministic resampler alone (layer
   * 1) - there is then nothing to fall back from, so `usedModel` is always false and at most one render
   * happens. */
  model?: TileModel;
  tile?: number;
  overlap?: number;
  signal?: AbortSignal;
}

export interface UpscaleActionResult {
  /** RGBA, `scale` times the original's width and height. */
  pixels: Pixels;
  /** Whether the FINAL result came from the learned enlarger (true) or the deterministic resampler,
   * either because no model was given or because the model's result failed verification (false). */
  usedModel: boolean;
  verification: CourseCorrection;
  /** 1 if the first render (model, when given) passed; 2 if it had to fall back to the resampler. */
  attempts: number;
}

/** Drops alpha - upscaleTiled and resampleLanczos3 both work in plain RGB, and upscale has no reason to
 * care about transparency the way masking/colour grading does. */
function toRgbBuffer(pixels: Pixels): PixelBuffer<Uint8ClampedArray> {
  const { width, height, data } = pixels;
  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2];
  }
  return { data: rgb, width, height, channels: 3 };
}

/** Adds back a fully-opaque alpha channel, so the result is a normal engine-layer Pixels again. */
function toRgbaPixels(buffer: PixelBuffer<Uint8ClampedArray>): Pixels {
  const { width, height, data } = buffer;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    rgba[j] = data[i]; rgba[j + 1] = data[i + 1]; rgba[j + 2] = data[i + 2]; rgba[j + 3] = 255;
  }
  return { data: rgba, width, height };
}

export async function runUpscaleAction(input: UpscaleActionInput): Promise<UpscaleActionResult> {
  return runEngineTask('upscale', 'device', 'Upscaling', async () => {
    const srcRgb = toRgbBuffer(input.original);
    const targetWidth = input.original.width * input.scale;
    const targetHeight = input.original.height * input.scale;

    const renderWithModel = async () => upscaleTiled(srcRgb, input.scale, input.model!, { tile: input.tile, overlap: input.overlap, signal: input.signal });
    const renderWithResampler = async () => resampleLanczos3(srcRgb, targetWidth, targetHeight, { signal: input.signal });

    const verifyAgainst = (upscaled: PixelBuffer<Uint8ClampedArray>): CourseCorrection => {
      const downsampled = resampleLanczos3(upscaled, input.original.width, input.original.height);
      return verifyEdit(input.original, toRgbaPixels(downsampled));
    };

    let usedModel = Boolean(input.model);
    let attempts = 1;
    let upscaledRgb = usedModel ? await renderWithModel() : await renderWithResampler();
    let verification = verifyAgainst(upscaledRgb);

    if (!verification.ok && usedModel) {
      usedModel = false;
      attempts = 2;
      upscaledRgb = await renderWithResampler();
      verification = verifyAgainst(upscaledRgb);
    }

    return { pixels: toRgbaPixels(upscaledRgb), usedModel, verification, attempts };
  });
}
