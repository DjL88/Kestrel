import { isIdentityToneCurve, type PhotoEdit } from './photoEdits';
import type { PhotoFraming } from './photoFraming';
import type { PhotoFrame } from './types';

/**
 * Strict MVP boundary for a genuine edited 16-bit RAW master.
 * The native prototype supports global colour/tone, full-resolution crop and
 * 90° turns; it must never silently drop straightening, masks or detail edits.
 */
export interface NativeRawMasterRecipe {
  exposure: number;
  warmth: number;
  tint?: number;
  colour: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vibrance: number;
}

const GLOBAL_CONTROLS = [
  'exposure', 'warmth', 'colour', 'brightness', 'contrast',
  'highlights', 'shadows', 'whites', 'blacks', 'vibrance',
] as const;

const UNSUPPORTED_CONTROLS = ['texture', 'clarity', 'sharpen', 'denoise'] as const;

export function nativeRawMasterRecipe(frame: Pick<PhotoFrame, 'edit' | 'framing'>): NativeRawMasterRecipe {
  const edit: PhotoEdit = frame.edit ?? { exposure: 0, warmth: 0, colour: 0 };
  if (edit.masks?.length) {
    throw new Error('16-bit RAW master POC does not yet support masks. Your normal export preserves them.');
  }
  if (!isIdentityToneCurve(edit.toneCurve)) {
    throw new Error('16-bit RAW master POC does not yet support toneCurve. Your normal export preserves that adjustment.');
  }
  const unsupported = UNSUPPORTED_CONTROLS.find((key) => (edit[key] ?? 0) !== 0);
  if (unsupported) {
    throw new Error('16-bit RAW master POC does not yet support ' + unsupported + '. Your normal export preserves that adjustment.');
  }
  const recipe = {} as NativeRawMasterRecipe;
  for (const key of GLOBAL_CONTROLS) {
    const value = edit[key] ?? 0;
    const limit = key === 'exposure' ? 12.5 : 2;
    if (!Number.isFinite(value) || Math.abs(value) > limit) {
      throw new Error('Invalid ' + key + ' adjustment; no master was exported.');
    }
    recipe[key] = value;
  }
  if ((edit.tint ?? 0) !== 0) {
    const tint = edit.tint!;
    if (!Number.isFinite(tint) || Math.abs(tint) > 2) {
      throw new Error('Invalid tint adjustment; no master was exported.');
    }
    recipe.tint = tint;
  }
  return recipe;
}


/**
 * Geometry is expressed in the *EXIF-oriented image's* coordinates. The native
 * renderer applies EXIF orientation first, then these turns and this crop.
 * Deliberate straightening requires interpolated rotation and remains blocked.
 */
export interface NativeRawMasterFraming {
  ratio: number | null;
  turns: number;
  straighten: number;
  x: number;
  y: number;
  size: number;
}

export function nativeRawMasterFraming(framing: PhotoFraming | undefined): NativeRawMasterFraming {
  const current = framing ?? { ratio: null, turns: 0, straighten: 0, x: 0.5, y: 0.5, size: 1 };
  if (current.straighten !== 0) {
    throw new Error('16-bit RAW master POC cannot yet export straighten adjustments. Your normal export preserves them.');
  }
  if (!Number.isInteger(current.turns) || current.turns < 0 || current.turns > 3) {
    throw new Error('Invalid RAW master quarter-turn rotation.');
  }
  if (current.ratio != null && (!Number.isFinite(current.ratio) || current.ratio < 0.01 || current.ratio > 100)) {
    throw new Error('Invalid RAW master crop aspect ratio.');
  }
  const size = current.size ?? 1;
  if (![current.x, current.y, size].every(Number.isFinite) ||
    current.x < 0 || current.x > 1 || current.y < 0 || current.y > 1 ||
    size < 0.08 || size > 1) {
    throw new Error('Invalid RAW master crop position or size.');
  }
  return { ratio: current.ratio, turns: current.turns, straighten: 0, x: current.x, y: current.y, size };
}
