import type { PhotoEdit } from './photoEdits';
import type { PhotoFrame } from './types';

/**
 * Strict MVP boundary for a genuine edited 16-bit RAW master.
 * The native prototype currently supports global colour/tone only; it must
 * never silently discard crop, masks, denoise, sharpening or other edits.
 */
export interface NativeRawMasterRecipe {
  exposure: number;
  warmth: number;
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
  const framing = frame.framing;
  if (framing && (
    framing.turns !== 0 || framing.straighten !== 0 || framing.ratio != null ||
    (framing.size !== undefined && framing.size !== 1)
  )) {
    throw new Error('16-bit RAW master POC does not yet support crop, straighten or manual rotation. Your normal export preserves them.');
  }
  if (edit.masks?.length) {
    throw new Error('16-bit RAW master POC does not yet support masks. Your normal export preserves them.');
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
  return recipe;
}
