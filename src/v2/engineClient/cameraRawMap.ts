// Lightroom and Camera Raw develop settings (XMP crs:) both ways, for the basic sliders the two apps share. InFlight's
// own full recipe stays the source of truth; this is an approximation in both directions, said so wherever it is used.
import { isEmptyEdit } from '../../core/photoEdits';
import { photoSidecar } from '../../core/photoSidecar';
import type { PhotoFrame } from '../../core/types';
import type { EditRecipe } from '../ui/contract';
import { editToRecipe } from './recipeMap';
import { hasCarriedDevelop, parseDevelopSettings } from '../../core/lightroomCatalogue';
import { developToRecipe } from './lightroomOps';

const sign = (value: number, digits = 0) => {
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
};

/**
 * The photo's basic edit as Camera Raw (crs:) settings, Process Version 2012 and later. InFlight's sliders and
 * Lightroom's share their ranges, so the numbers carry over one to one; the look is close, not identical, because the
 * two render differently. Crops, curves, masks and colour mixer stay in recipes.json.
 */
export function cameraRawSettings(frame: Pick<PhotoFrame, 'edit'>): Record<string, string> | null {
  if (!frame.edit || isEmptyEdit(frame.edit)) return null;
  const recipe = editToRecipe(frame.edit);
  const settings: Record<string, string> = { ProcessVersion: '11.0', HasSettings: 'True' };
  const put = (key: string, value: number | undefined, digits = 0) => {
    if (value !== undefined && Number.isFinite(value) && Math.abs(value) >= (digits ? 0.005 : 0.5)) settings[key] = sign(value, digits);
  };
  put('Exposure2012', recipe.exposure, 2);
  put('Contrast2012', recipe.contrast);
  put('Highlights2012', recipe.highlights);
  put('Shadows2012', recipe.shadows);
  put('Whites2012', recipe.whites);
  put('Blacks2012', recipe.blacks);
  put('Clarity2012', recipe.clarity);
  put('Vibrance', recipe.vibrance);
  if (recipe.saturation <= -100) settings.ConvertToGrayscale = 'True';
  else put('Saturation', recipe.saturation);
  put('Dehaze', recipe.dehaze);
  put('Texture', recipe.detailRecovery);
  put('LuminanceSmoothing', recipe.denoiseLuminance);
  put('PostCropVignetteAmount', recipe.vignette);
  put('GrainAmount', recipe.grain);
  return settings;
}

/** A sidecar that also carries the basic edit as Camera Raw settings, for photos InFlight has edited. */
export function sidecarWithEdit(frame: PhotoFrame): { filename: string; bytes: Uint8Array } {
  const base = photoSidecar(frame);
  const settings = cameraRawSettings(frame);
  if (!settings) return base;
  const text = new TextDecoder().decode(base.bytes);
  const anchor = 'xmlns:dc="http://purl.org/dc/elements/1.1/"';
  const attributes = Object.entries(settings).map(([key, value]) => ` crs:${key}="${value}"`).join('');
  const packet = text.replace(anchor, `${anchor} xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"${attributes}`);
  return { filename: base.filename, bytes: new TextEncoder().encode(packet) };
}


/**
 * The basic sliders from a Lightroom or Camera Raw sidecar, as an InFlight recipe change, read by the same rules as a
 * Lightroom catalogue (lightroomCatalogue.ts): Process Version 2012 and later only, ranges clamped, nothing guessed.
 * Returns null when there is nothing to carry over.
 */
export function recipeFromCameraRaw(settings: Readonly<Record<string, string>> | undefined): { patch: Partial<EditRecipe> } | null {
  if (!settings) return null;
  // The catalogue stores the same keys and values as a Lua table; only plain numbers and true/false are passed on.
  const fields = Object.entries(settings).filter(([key, value]) => /^[A-Za-z0-9]+$/.test(key) && /^([+-]?\d+(\.\d+)?|true|false)$/i.test(value))
    .map(([key, value]) => `${key} = ${/^(true|false)$/i.test(value) ? value.toLowerCase() : value.replace(/^\+/, '')},`);
  const develop = parseDevelopSettings(`s = { ${fields.join('\n')} }`);
  if (!hasCarriedDevelop(develop)) return null;
  const patch = developToRecipe(develop);
  return Object.keys(patch).length ? { patch } : null;
}
