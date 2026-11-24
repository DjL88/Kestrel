import { runUpscaleAction } from '../../engine/upscaleAction';

export { upscaleFactorFor } from '../ui/utils/studioMath';

/** Enlarge a canvas in place with the engine's verified, deterministic resampler (no model, nothing leaves the device). */
export async function upscaleCanvasInPlace(canvas: HTMLCanvasElement, factor: 2 | 4, signal?: AbortSignal): Promise<{ verified: boolean }> {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable for upscaling.');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = await runUpscaleAction({ original: { data: image.data, width: image.width, height: image.height }, scale: factor, signal });
  canvas.width = result.pixels.width; canvas.height = result.pixels.height;
  const target = canvas.getContext('2d');
  if (!target) throw new Error('Canvas unavailable for upscaling.');
  target.putImageData(new ImageData(new Uint8ClampedArray(result.pixels.data), result.pixels.width, result.pixels.height), 0, 0);
  return { verified: result.verification.ok };
}
