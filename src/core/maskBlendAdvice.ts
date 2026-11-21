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

export function reviewMaskBlend(mask: Mask, mode: GuidanceMode, evidence?: MaskBoundaryEvidence | null): MaskBlendAdvice | null {
  if (mode === 'solo' || mask.kind !== 'subject' || mask.invert) return null;
  const strength = maskLocalStrength(mask);
  if (strength < 0.55 || (mask.feather >= 0.75 && !evidence?.possibleHardEdge)) return null;
  return {
    kind: 'soften-transition',
    strength,
    reason: evidence?.possibleHardEdge
      ? 'The local adjustment changes sharply along part of the mask boundary in this preview. A gentler transition may look more natural.'
      : 'This is a fairly strong local adjustment. A gentler transition may make the subject feel more naturally part of the photograph.',
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
  // Blend should never make an already-soft manual mask sharper. Respect feather > 0.85.
  const feather = Math.max(mask.feather, Math.min(0.85, mask.feather + (strength >= 0.9 ? 0.2 : 0.12)));
  if (feather === mask.feather && strength < 0.9) return mask;
  const edit: LocalEdit = { ...mask.edit };
  if (strength >= 0.9) {
    for (const key of TRANSITION_KEYS) {
      const value = edit[key];
      if (value !== undefined) edit[key] = Math.round(value * 0.9 * 100) / 100;
    }
  }
  return { ...mask, feather, edit };
}

/**
 * Low-cost, reproducible evidence of a potentially abrupt adjustment boundary.
 * Compare one image with GLOBAL edits only against the same render WITH masks.
 * This works on small 8-bit previews; it does not certify final high-bit export
 * quality or identify missing anatomy. The answer is always advisory.
 */
export interface MaskBoundaryEvidence {
  sampledEdges: number;
  abruptShare: number;
  possibleHardEdge: boolean;
}

export function inspectMaskBoundary(
  globalOnly: Uint8ClampedArray,
  masked: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
): MaskBoundaryEvidence | null {
  const pixels = width * height;
  if (width < 8 || height < 8 || pixels > 1024 * 1024 ||
      alpha.length !== pixels || globalOnly.length !== pixels * 4 || masked.length !== pixels * 4) return null;
  const light = (data: Uint8ClampedArray, pixel: number) => {
    const j = pixel * 4;
    return data[j] * 0.2126 + data[j + 1] * 0.7152 + data[j + 2] * 0.0722;
  };
  let sampledEdges = 0;
  let abrupt = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const pixel = y * width + x;
      for (const neighbor of [pixel + 1, pixel + width]) {
        if (Math.abs(alpha[pixel] - alpha[neighbor]) < 0.12) continue;
        if (Math.max(alpha[pixel], alpha[neighbor]) < 0.1) continue;
        // Measure how sharply the LOCAL correction changes at this boundary,
        // not the original subject/background contrast.
        const localHere = light(masked, pixel) - light(globalOnly, pixel);
        const localThere = light(masked, neighbor) - light(globalOnly, neighbor);
        const transition = Math.abs(localHere - localThere);
        if (transition > 13) abrupt++;
        sampledEdges++;
      }
    }
  }
  const abruptShare = sampledEdges ? abrupt / sampledEdges : 0;
  return { sampledEdges, abruptShare, possibleHardEdge: sampledEdges >= 12 && abruptShare >= 0.3 };
}
