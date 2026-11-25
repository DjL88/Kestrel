import type { PhotoEdit } from '../../core/photoEdits';
import { isNeutralWhiteBalance, validWhiteBalance } from '../../core/asShotWhite';
import { isNeutralCurve, isNeutralMixer, validCurve, validMixer, type ColourMixer, type CurvePoint } from '../../core/curveMixer';
import { isNeutralChannelCurves, isNeutralGrade, validChannelCurves, validGrade, CURVE_CHANNELS, type ChannelCurves, type ColourGrade } from '../../core/colourGrade';
import { isNeutralCalibration, PRIMARIES, validCalibration, type Calibration } from '../../core/calibration';
import { validDehaze } from '../../core/dehaze';
import { validDefringe, validLateralCa, type Defringe, type LateralCa } from '../../core/fringe';
import { hasLensCorrection, validLens, type LensCorrection } from '../../core/lensCorrection';
import { validGrain, validVignette, type Vignette } from '../../core/finishing';
import type { ColourGradeRecipe, EditRecipe } from '../ui/contract';

export const DEFAULT_VIGNETTE_SIZE = 50;
export const DEFAULT_GRAIN_SIZE = 25;
const hex = (colour: [number, number, number]) => `#${colour.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (value: string | undefined): [number, number, number] | undefined => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value ?? '');
  return match ? [1, 2, 3].map((i) => round(parseInt(match[i], 16) / 255, 4)) as [number, number, number] : undefined;
};

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
    ...(validDehaze(edit.dehaze) && edit.dehaze !== 0 ? { dehaze: round(edit.dehaze * 100, 2) } : {}),
    ...(validLens(edit.lens) && hasLensCorrection(edit.lens) ? { lensDistortion: round((edit.lens.distortion ?? 0) * 100, 2), lensVignetting: round((edit.lens.vignetting ?? 0) * 100, 2) } : {}),
    ...(validLateralCa(edit.lateralCa) ? { caRed: round(edit.lateralCa.red * 100, 2), caBlue: round(edit.lateralCa.blue * 100, 2) } : {}),
    ...(validDefringe(edit.defringe) ? { defringePurple: round(edit.defringe.purple * 100, 2), defringeGreen: round(edit.defringe.green * 100, 2) } : {}),
    ...(validVignette(edit.vignette) ? {
      vignette: round(edit.vignette.amount * 100, 2), vignetteSize: round(edit.vignette.size * 100, 2),
      ...(edit.vignette.blur ? { vignetteBlur: round(edit.vignette.blur * 100, 2) } : {}),
      ...(edit.vignette.colour ? { vignetteColour: hex(edit.vignette.colour) } : {}),
    } : {}),
    ...(validGrain(edit.grain) ? { grain: round(edit.grain.amount * 100, 2), grainSize: round(edit.grain.size * 100, 2) } : {}),
    ...(validCalibration(edit.calibration) && !isNeutralCalibration(edit.calibration) ? { calibration: Object.fromEntries(
      PRIMARIES.map((key) => [key, { hue: round(edit.calibration![key][0] * 100, 2), saturation: round(edit.calibration![key][1] * 100, 2) }]),
    ) as NonNullable<EditRecipe['calibration']> } : {}),
    ...(validGrade(edit.grade) && !isEmptyGrade(edit.grade) ? { colourGrade: gradeToRecipe(edit.grade) } : {}),
    ...(validChannelCurves(edit.channelCurves) && !isNeutralChannelCurves(edit.channelCurves) ? { channelCurves: Object.fromEntries(
      Object.entries(edit.channelCurves).map(([channel, points]) => [channel, points!.map(([x, y]) => [x, y] as [number, number])]),
    ) } : {}),
  };
}

/**
 * Every value at zero. A hue chosen before its strength is kept (so picking the colour first is not lost), although
 * renderers treat a grade with no strength as neutral (isNeutralGrade).
 */
const isEmptyGrade = (grade: ColourGrade) => isNeutralGrade(grade) && grade.balance === 0
  && grade.shadows[0] === 0 && grade.midtones[0] === 0 && grade.highlights[0] === 0;

const gradeToRecipe = (grade: ColourGrade): ColourGradeRecipe => {
  const range = ([hue, amount]: [number, number]) => ({ hue: round(hue, 1), amount: round(amount * 100, 2) });
  return { shadows: range(grade.shadows), midtones: range(grade.midtones), highlights: range(grade.highlights), balance: round(grade.balance * 100, 2) };
};

function recipeToGrade(source: ColourGradeRecipe | undefined): ColourGrade | undefined {
  if (!source) return undefined;
  const range = (r: { hue: number; amount: number } | undefined): [number, number] => [
    round(Number.isFinite(r?.hue) ? ((r!.hue % 360) + 360) % 360 : 0, 2),
    round(clamp(Number.isFinite(r?.amount) ? r!.amount : 0, 0, 100) / 100, 4),
  ];
  return { shadows: range(source.shadows), midtones: range(source.midtones), highlights: range(source.highlights),
    balance: round(clamp(Number.isFinite(source.balance) ? source.balance : 0, -100, 100) / 100, 4) };
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
  if (patch.dehaze !== undefined && Number.isFinite(patch.dehaze)) {
    const value = round(clamp(patch.dehaze, -100, 100) / 100, 4);
    if (value === 0) delete next.dehaze;
    else next.dehaze = value;
  }
  if ('lensDistortion' in patch || 'lensVignetting' in patch) {
    const unit = (value: number | undefined, fallback: number, low: number) => Number.isFinite(value) ? round(clamp(value!, low, 100) / 100, 4) : fallback;
    const distortion = unit(patch.lensDistortion, next.lens?.distortion ?? 0, -100);
    const vignetting = unit(patch.lensVignetting, next.lens?.vignetting ?? 0, 0);
    const lens: LensCorrection = { ...(distortion ? { distortion } : {}), ...(vignetting ? { vignetting } : {}) };
    if (validLens(lens) && hasLensCorrection(lens)) next.lens = lens;
    else delete next.lens;
  }
  if ('caRed' in patch || 'caBlue' in patch) {
    const unit = (value: number | undefined, fallback: number) => Number.isFinite(value) ? round(clamp(value!, -100, 100) / 100, 4) : fallback;
    const ca: LateralCa = { red: unit(patch.caRed, next.lateralCa?.red ?? 0), blue: unit(patch.caBlue, next.lateralCa?.blue ?? 0) };
    if (validLateralCa(ca) && (ca.red !== 0 || ca.blue !== 0)) next.lateralCa = ca;
    else delete next.lateralCa;
  }
  if ('defringePurple' in patch || 'defringeGreen' in patch) {
    const unit = (value: number | undefined, fallback: number) => Number.isFinite(value) ? round(clamp(value!, 0, 100) / 100, 4) : fallback;
    const fringe: Defringe = { purple: unit(patch.defringePurple, next.defringe?.purple ?? 0), green: unit(patch.defringeGreen, next.defringe?.green ?? 0) };
    if (validDefringe(fringe) && (fringe.purple > 0 || fringe.green > 0)) next.defringe = fringe;
    else delete next.defringe;
  }
  if (['vignette', 'vignetteSize', 'vignetteBlur', 'vignetteColour'].some((key) => key in patch)) {
    const current: Vignette = { amount: 0, size: DEFAULT_VIGNETTE_SIZE / 100, ...next.vignette };
    const unit = (value: number | undefined, fallback: number, low = 0) => Number.isFinite(value) ? round(clamp(value!, low * 100, 100) / 100, 4) : fallback;
    const vignette: Vignette = {
      amount: unit(patch.vignette, current.amount, -1),
      size: unit(patch.vignetteSize, current.size),
    };
    const blur = 'vignetteBlur' in patch ? unit(patch.vignetteBlur, 0) : current.blur ?? 0;
    if (blur > 0) vignette.blur = blur;
    const colour = 'vignetteColour' in patch ? fromHex(patch.vignetteColour) : current.colour;
    if (colour) vignette.colour = colour;
    // Off (no strength and no blur) is stored as no vignette at all.
    if (validVignette(vignette) && (vignette.amount !== 0 || blur > 0)) next.vignette = vignette;
    else delete next.vignette;
  }
  if ('grain' in patch || 'grainSize' in patch) {
    const amount = Number.isFinite(patch.grain) ? round(clamp(patch.grain!, 0, 100) / 100, 4) : next.grain?.amount ?? 0;
    const size = Number.isFinite(patch.grainSize) ? round(clamp(patch.grainSize!, 0, 100) / 100, 4) : next.grain?.size ?? DEFAULT_GRAIN_SIZE / 100;
    if (amount > 0) next.grain = { amount, size };
    else delete next.grain;
  }
  if ('calibration' in patch) {
    const source = patch.calibration;
    const shift = (key: typeof PRIMARIES[number]): [number, number] => {
      const value = source?.[key];
      const unit = (v: number | undefined) => round(clamp(Number.isFinite(v) ? v! : 0, -100, 100) / 100, 4);
      return [unit(value?.hue), unit(value?.saturation)];
    };
    const calibration: Calibration | undefined = source ? { red: shift('red'), green: shift('green'), blue: shift('blue') } : undefined;
    if (calibration && validCalibration(calibration) && !isNeutralCalibration(calibration)) next.calibration = calibration;
    else delete next.calibration;
  }
  if ('colourGrade' in patch) {
    const grade = recipeToGrade(patch.colourGrade);
    if (grade && validGrade(grade) && !isEmptyGrade(grade)) next.grade = grade;
    else delete next.grade;
  }
  if ('channelCurves' in patch) {
    // Only valid, bent curves are kept; a straight or malformed channel is dropped, never guessed.
    const curves: ChannelCurves = {};
    for (const channel of CURVE_CHANNELS) {
      const points = patch.channelCurves?.[channel]?.map(([x, y]) => [round(x, 4), round(y, 4)] as CurvePoint);
      if (points && validCurve(points) && !isNeutralCurve(points)) curves[channel] = points;
    }
    if (Object.keys(curves).length) next.channelCurves = curves;
    else delete next.channelCurves;
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
