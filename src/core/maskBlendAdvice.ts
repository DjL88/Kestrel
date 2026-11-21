import type { LocalEdit, Mask } from './maskTypes';
import type { GuidanceMode } from './guidanceMode';

/**
 * Gentle transition advice for a local adjustment. This is a *risk estimate*
 * based on recipe strength and edge softness, NOT a claim that an image has a
 * visible halo or that an anatomical feature was successfully segmented.
 */
export interface MaskBlendAdvice {
  kind: 'soften-transition';
  reason: string;
  strength: number;
  action: string;
}

const TRANSITION_KEYS = [
  'exposure', 'brightness', 'contrast', 'highlights', 'shadows',
  'whites', 'blacks', 'clarity', 'texture', 'sharpen',
] as const satisfies readonly (keyof LocalEdit)[];

export function maskLocalStrength(mask: Mask): number {
  const values = TRANSITION_KEYS.map((key) => Math.abs(mask.edit[key] ?? 0));
  return values.length ? Math.max(...values) : 0;
}

export function reviewMaskBlend(mask: Mask, mode: GuidanceMode): MaskBlendAdvice | null {
  if (mode === 'solo' || mask.kind !== 'subject' || mask.invert) return null;
  const strength = maskLocalStrength(mask);
  if (strength < 0.55 || mask.feather >= 0.75) return null;
  return {
    kind: 'soften-transition',
    strength,
    reason: 'This is a fairly strong local adjustment. A gentler transition may make the subject feel more naturally part of the photograph.',
    action: 'Blend edges',
  };
}

/**
 * A deliberate, undoable recipe adjustment; never changes detection pixels,
 * original source, brush strokes, or the selected mask identity.
 * Tone/detail is reduced slightly only when unusually strong.
 */
export function blendMaskEdges(mask: Mask): Mask {
  if (mask.kind !== 'subject' && mask.kind !== 'brush') return mask;
  const strength = maskLocalStrength(mask);
  const feather = Math.min(0.85, Math.max(mask.feather, mask.feather + (strength >= 0.9 ? 0.2 : 0.12)));
  const edit: LocalEdit = { ...mask.edit };
  if (strength >= 0.9) {
    for (const key of TRANSITION_KEYS) {
      const value = edit[key];
      if (value !== undefined) edit[key] = Math.round(value * 0.9 * 100) / 100;
    }
  }
  return { ...mask, feather, edit };
}
