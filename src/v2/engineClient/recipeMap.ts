import type { PhotoEdit } from '../../core/photoEdits';
import { isNeutralWhiteBalance, validWhiteBalance } from '../../core/asShotWhite';
import { isNeutralCurve, isNeutralMixer, validCurve, validMixer, type ColourMixer, type CurvePoint } from '../../core/curveMixer';
import type { EditRecipe } from '../ui/contract';

/**
 * Maps the UI's recipe (sliders -100 to 100, exposure in EV) to and from the engine's PhotoEdit (tone and detail -2 to 2,
 * exposure in 0.4 EV steps, colour -2 = black and white). The engine is the source of truth: the UI recipe shown for a
 * photo is always derived from its PhotoEdit, so what the sliders say is what the pixels do.
 *
 * Existing fine-detail enhancement uses PhotoEdit.texture, shared by preview and normal export.
 * It improves the contrast of detail already present; it does not reconstruct missing feathers.
 * Not in PhotoEdit yet: AI RAW denoise and optical lens-profile correction.
 * Those controls remain unsupported (UNMAPPED_KEYS) until real implementations exist.
 */
export const NEUTRAL_RECIPE: EditRecipe = {
  lookId: 'natural-raw', exposure: 0, highlights: 0, shadows: 0, contrast: 0, whites: 0, blacks: 0, temperature: 0, tint: 0,
  vibrance: 0, saturation: 0, clarity: 0, sharpen: 0, denoiseRawAi: false, denoiseLuminance: 0, denoiseColour: 0,
  upscaleFactor: 1, detailRecovery: 0, lensCorrection: false,
};

export const UNMAPPED_KEYS = ['denoiseRawAi', 'lensCorrection'] as const satisfies readonly (keyof EditRecipe)[];

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
    tint: toSlider(edit.tint),
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
    denoiseLuminance: toSlider(edit.denoiseLuminance),
    detailRecovery: round(clamp((edit.texture ?? 0) * SLIDER_PER_STEP, 0, 100), 2),
    upscaleFactor: edit.upscale ?? 1,
    ...(!isNeutralWhiteBalance(edit.whiteBalance) ? { whiteBalance: { ...edit.whiteBalance! } } : {}),
    ...(validCurve(edit.curve) && !isNeutralCurve(edit.curve) ? { toneCurve: edit.curve.map(([x, y]) => [x, y] as [number, number]) } : {}),
    ...(validMixer(edit.mixer) && !isNeutralMixer(edit.mixer) ? { colourMixer: {
      hue: edit.mixer.hue.map(toSlider), saturation: edit.mixer.saturation.map(toSlider), luminance: edit.mixer.luminance.map(toSlider),
    } } : {}),
  };
}

export function applyRecipePatch(edit: PhotoEdit | undefined, patch: Partial<EditRecipe>): { edit: PhotoEdit; unmapped: (typeof UNMAPPED_KEYS)[number][] } {
  const next: PhotoEdit = { exposure: 0, warmth: 0, colour: 0, ...edit };
  if (patch.exposure !== undefined) next.exposure = round(clamp(patch.exposure, -5, 5) / EV_PER_STEP, 4);
  if (patch.temperature !== undefined) next.warmth = toStep(patch.temperature);
  if (patch.tint !== undefined && Number.isFinite(patch.tint)) {
    const tint = toStep(patch.tint);
    if (tint === 0) delete next.tint;
    else next.tint = tint;
  }
  if (patch.saturation !== undefined) next.colour = patch.saturation <= -100 ? -2 : toStep(patch.saturation);
  if (patch.contrast !== undefined) next.contrast = toStep(patch.contrast);
  if (patch.highlights !== undefined) next.highlights = toStep(patch.highlights);
  if (patch.shadows !== undefined) next.shadows = toStep(patch.shadows);
  if (patch.whites !== undefined) next.whites = toStep(patch.whites);
  if (patch.blacks !== undefined) next.blacks = toStep(patch.blacks);
  if (patch.vibrance !== undefined) next.vibrance = toStep(patch.vibrance);
  if (patch.clarity !== undefined) next.clarity = toStep(patch.clarity);
  if (patch.sharpen !== undefined) next.sharpen = round(clamp(patch.sharpen, 0, 100) / SLIDER_PER_STEP, 4);
  if (patch.denoiseLuminance !== undefined && Number.isFinite(patch.denoiseLuminance)) {
    const value = round(clamp(patch.denoiseLuminance, 0, 100) / SLIDER_PER_STEP, 4);
    if (value === 0) delete next.denoiseLuminance;
    else next.denoiseLuminance = value;
  }
  if (patch.denoiseColour !== undefined) next.denoise = round(clamp(patch.denoiseColour, 0, 100) / SLIDER_PER_STEP, 4);
  if (patch.detailRecovery !== undefined && Number.isFinite(patch.detailRecovery)) {
    const texture = round(clamp(patch.detailRecovery, 0, 100) / SLIDER_PER_STEP, 4);
    if (texture === 0) delete next.texture;
    else next.texture = texture;
  }
  if (patch.upscaleFactor !== undefined) { if (patch.upscaleFactor === 2 || patch.upscaleFactor === 4) next.upscale = patch.upscaleFactor; else delete next.upscale; }
  if ('toneCurve' in patch) {
    // A curve that is missing, straight or malformed is stored as no curve at all, never as a guess.
    const curve = patch.toneCurve?.map(([x, y]) => [round(x, 4), round(y, 4)] as CurvePoint);
    if (curve && validCurve(curve) && !isNeutralCurve(curve)) next.curve = curve;
    else delete next.curve;
  }
  if ('whiteBalance' in patch) {
    const wb = patch.whiteBalance ? { asShotK: Math.round(patch.whiteBalance.asShotK), kelvin: Math.round(patch.whiteBalance.kelvin) } : undefined;
    if (wb && validWhiteBalance(wb) && !isNeutralWhiteBalance(wb)) next.whiteBalance = wb;
    else delete next.whiteBalance;
  }
  if ('colourMixer' in patch) {
    const source = patch.colourMixer;
    const band = (list: number[] | undefined) => Array.from({ length: 8 }, (_, i) => toStep(Number.isFinite(list?.[i]) ? list![i] : 0));
    const mixer: ColourMixer | undefined = source ? { hue: band(source.hue), saturation: band(source.saturation), luminance: band(source.luminance) } : undefined;
    if (mixer && validMixer(mixer) && !isNeutralMixer(mixer)) next.mixer = mixer;
    else delete next.mixer;
  }
  const neutral = (value: unknown, base: unknown) => value === undefined || value === base;
  const unmapped = UNMAPPED_KEYS.filter((key) => !neutral(patch[key], NEUTRAL_RECIPE[key]));
  return { edit: next, unmapped };
}

/**
 * A Look hover is a temporary, non-persistent edit of the actual renderer.
 * Apply from the photo's current recipe, not from an already edited raster:
 * FrameImage draws the candidate from the same source as Apply/export.
 * Returning the same reference when nothing is hovered avoids redraws.
 */
export function previewLookEdit(edit: PhotoEdit | undefined, lookDelta?: Partial<EditRecipe>): PhotoEdit | undefined {
  return lookDelta ? applyRecipePatch(edit, lookDelta).edit : edit;
}
