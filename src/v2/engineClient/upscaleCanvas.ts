import { runUpscaleAction } from '../../engine/upscaleAction';

/**
 * How much to enlarge the edited picture for export: the person's chosen factor, but only when the requested output
 * actually needs more pixels than the picture has, and only when the enlarged canvas fits this device's limit.
 * Never silently falls to a different factor: if it cannot be done, the export is capped as before and says so.
 */
export function upscaleFactorFor(chosen: 1 | 2 | 4 | undefined, neededScale: number, width: number, height: number, pixelLimit: number): 1 | 2 | 4 {
  if (!chosen || chosen === 1 || !(neededScale > 1)) return 1;
  return width * height * chosen * chosen <= pixelLimit ? chosen : 1;
}

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
