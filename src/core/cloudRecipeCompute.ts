import { CLOUD_RECIPE_PROTOCOL, type CloudRecipeInputKind, type CloudRecipeSettings } from './cloudRecipe';
import { naturalAuto } from './naturalAuto';
import { resampleLanczos3 } from './upscaleResample';

/**
 * The cloud side of a recipe job (x-std-cloud-recipe), shared with the runner image: decoded pixels in, a small JSON
 * recipe out. It runs the same natural Auto the device runs (`naturalAuto.ts`), so a cloud recipe is the device's own
 * judgement made elsewhere, not a different or better model. Nothing here returns or stores pixels.
 */
export const RECIPE_PRODUCER = { name: 'InFlight natural Auto (cloud runner)', version: '1' } as const;

/** naturalAuto reads at most 1.2 megapixels; larger pictures are reduced first, never cropped. */
const ANALYSIS_PIXELS = 1_100_000;
const EV_PER_STEP = 0.4;
const SLIDER_PER_STEP = 50;
const tidy = (value: number) => Math.round(value * 100) / 100;

export interface RecipeJobInput { jobId: string; inputKind: CloudRecipeInputKind; pixels: Uint8ClampedArray; width: number; height: number }

export function computeCloudRecipe(input: RecipeJobInput): Uint8Array {
  const { width, height } = input;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 16 || height < 16 || input.pixels.length !== width * height * 4) {
    throw new Error('Recipe input is not a usable picture.');
  }
  let pixels = input.pixels, w = width, h = height;
  if (w * h > ANALYSIS_PIXELS) {
    const scale = Math.sqrt(ANALYSIS_PIXELS / (w * h));
    const small = resampleLanczos3({ data: pixels, width: w, height: h, channels: 4 }, Math.max(16, Math.floor(w * scale)), Math.max(16, Math.floor(h * scale)));
    pixels = small.data; w = small.width; h = small.height;
  }
  const auto = naturalAuto({ pixels, width: w, height: h });
  const settings: CloudRecipeSettings = {};
  if (!auto.abstained) {
    const e = auto.edit;
    settings.exposure = tidy(Math.max(-5, Math.min(5, (e.exposure ?? 0) * EV_PER_STEP)));
    settings.temperature = tidy(Math.max(-100, Math.min(100, (e.warmth ?? 0) * SLIDER_PER_STEP)));
    settings.shadows = tidy(Math.max(-100, Math.min(100, e.shadows * SLIDER_PER_STEP)));
    settings.highlights = tidy(Math.max(-100, Math.min(100, e.highlights * SLIDER_PER_STEP)));
    settings.contrast = tidy(Math.max(-100, Math.min(100, e.contrast * SLIDER_PER_STEP)));
    settings.vibrance = tidy(Math.max(-100, Math.min(100, e.vibrance * SLIDER_PER_STEP)));
  }
  const notes = auto.notes.filter((note) => note.length > 0 && note.length <= 200 && !/[\u0000-\u001f]/.test(note)).slice(0, 4);
  return new TextEncoder().encode(JSON.stringify({
    protocol: CLOUD_RECIPE_PROTOCOL, jobId: input.jobId, input: input.inputKind, settings, producer: RECIPE_PRODUCER,
    ...(notes.length ? { notes } : {}),
  }));
}
