import type { PhotoEdit } from '../../core/photoEdits';
import type { EditRecipe } from '../ui/contract';

/**
 * Maps the UI's recipe (sliders -100 to 100, exposure in EV) to and from the engine's PhotoEdit (tone and detail -2 to 2,
 * exposure in 0.4 EV steps, colour -2 = black and white). The engine is the source of truth: the UI recipe shown for a
 * photo is always derived from its PhotoEdit, so what the sliders say is what the pixels do.
 *
 * Not in PhotoEdit yet, so not applied: tint, luminance noise reduction, AI RAW denoise, upscale, detail recovery and
 * lens correction. Changing one of those changes nothing and the caller is told (UNMAPPED_KEYS).
 */
export const NEUTRAL_RECIPE: EditRecipe = {
  lookId: 'natural-raw', exposure: 0, highlights: 0, shadows: 0, contrast: 0, whites: 0, blacks: 0, temperature: 0, tint: 0,
  vibrance: 0, saturation: 0, clarity: 0, sharpen: 0, denoiseRawAi: false, denoiseLuminance: 0, denoiseColour: 0,
  upscaleFactor: 1, detailRecovery: 0, lensCorrection: false,
};

export const UNMAPPED_KEYS = ['tint', 'denoiseRawAi', 'denoiseLuminance', 'upscaleFactor', 'detailRecovery', 'lensCorrection'] as const satisfies readonly (keyof EditRecipe)[];

const EV_PER_STEP = 0.4;
const SLIDER_PER_STEP = 50; // one engine step is 50 slider points
const round = (value: number, digits: number) => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toStep = (slider: number) => round(clamp(slider, -100, 100) / SLIDER_PER_STEP, 4);
const toSlider = (step: number | undefined) => round((step ?? 0) * SLIDER_PER_STEP, 2);

export function editToRecipe(edit: PhotoEdit | undefined): EditRecipe {
  if (!edit) return { ...NEUTRAL_RECIPE };
  return {
    ...NEUTRAL_RECIPE,
    exposure: round(edit.exposure * EV_PER_STEP, 2),
    temperature: toSlider(edit.warmth),
    saturation: edit.colour === -2 ? -100 : toSlider(edit.colour),
    contrast: toSlider(edit.contrast),
    highlights: toSlider(edit.highlights),
    shadows: toSlider(edit.shadows),
    whites: toSlider(edit.whites),
    blacks: toSlider(edit.blacks),
    vibrance: toSlider(edit.vibrance),
    clarity: toSlider(edit.clarity),
    sharpen: toSlider(edit.sharpen),
    denoiseColour: toSlider(edit.denoise),
  };
}

export function applyRecipePatch(edit: PhotoEdit | undefined, patch: Partial<EditRecipe>): { edit: PhotoEdit; unmapped: (typeof UNMAPPED_KEYS)[number][] } {
  const next: PhotoEdit = { exposure: 0, warmth: 0, colour: 0, ...edit };
  if (patch.exposure !== undefined) next.exposure = round(clamp(patch.exposure, -5, 5) / EV_PER_STEP, 4);
  if (patch.temperature !== undefined) next.warmth = toStep(patch.temperature);
  if (patch.saturation !== undefined) next.colour = patch.saturation <= -100 ? -2 : toStep(patch.saturation);
  if (patch.contrast !== undefined) next.contrast = toStep(patch.contrast);
  if (patch.highlights !== undefined) next.highlights = toStep(patch.highlights);
  if (patch.shadows !== undefined) next.shadows = toStep(patch.shadows);
  if (patch.whites !== undefined) next.whites = toStep(patch.whites);
  if (patch.blacks !== undefined) next.blacks = toStep(patch.blacks);
  if (patch.vibrance !== undefined) next.vibrance = toStep(patch.vibrance);
  if (patch.clarity !== undefined) next.clarity = toStep(patch.clarity);
  if (patch.sharpen !== undefined) next.sharpen = round(clamp(patch.sharpen, 0, 100) / SLIDER_PER_STEP, 4);
  if (patch.denoiseColour !== undefined) next.denoise = round(clamp(patch.denoiseColour, 0, 100) / SLIDER_PER_STEP, 4);
  const neutral = (value: unknown, base: unknown) => value === undefined || value === base;
  const unmapped = UNMAPPED_KEYS.filter((key) => !neutral(patch[key], NEUTRAL_RECIPE[key]));
  return { edit: next, unmapped };
}
