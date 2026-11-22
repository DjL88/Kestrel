import { LOCAL_KEYS, MAX_MASKS, type LocalKey, type Mask } from '../../core/maskTypes';
import type { MaskLayer } from '../ui/contract';

/** The sliders a mask offers in V2. Each is a real local control; the range is the core's own (-2 to 2, sharpen from 0). */
export const MASK_SLIDERS = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.05 },
  { key: 'contrast', label: 'Contrast', min: -2, max: 2, step: 0.05 },
  { key: 'warmth', label: 'Warmth', min: -2, max: 2, step: 0.05 },
  { key: 'colour', label: 'Colour', min: -2, max: 2, step: 0.05 },
  { key: 'clarity', label: 'Clarity', min: -2, max: 2, step: 0.05 },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 2, step: 0.05 },
] as const satisfies readonly { key: LocalKey; label: string; min: number; max: number; step: number }[];

const layerType = (mask: Mask): MaskLayer['type'] => (mask.kind === 'subject' ? (mask.invert ? 'background' : 'subject') : mask.kind === 'brush' ? 'brush' : 'area');
const layerName = (mask: Mask): string => (mask.kind === 'subject' ? (mask.invert ? 'Background' : 'Subject') : mask.kind === 'brush' ? 'Brush mask' : mask.kind === 'linear' ? 'Gradient' : 'Round area');

/** The masks stored on a photo, as the layers the interface lists. Nothing is invented: names and values come from the masks. */
export function masksToLayers(masks: readonly Mask[] | undefined): MaskLayer[] {
  return (masks ?? []).map((mask) => ({
    id: mask.id, name: layerName(mask), type: layerType(mask), visible: !mask.hidden,
    feather: Math.round(mask.feather * 100), edit: { ...mask.edit } as Record<string, number>,
  }));
}

export const canAddMask = (masks: readonly Mask[] | undefined) => (masks?.length ?? 0) < MAX_MASKS;
const change = (masks: readonly Mask[] | undefined, id: string, update: (mask: Mask) => Mask): Mask[] => (masks ?? []).map((mask) => (mask.id === id ? update(mask) : mask));

export const toggleMask = (masks: readonly Mask[] | undefined, id: string): Mask[] => change(masks, id, (mask) => (mask.hidden ? { ...mask, hidden: undefined } : { ...mask, hidden: true }));

/** Remove a mask, and any other mask that was limited by it (a limit pointing nowhere is dropped, not left dangling). */
export const removeMask = (masks: readonly Mask[] | undefined, id: string): Mask[] =>
  (masks ?? []).filter((mask) => mask.id !== id).map((mask) => (mask.limit?.id === id ? { ...mask, limit: undefined } : mask));

/** Set one slider on a mask. The value is held inside the control's range, and a slider at zero is removed so it reads as unset. */
export function setMaskEdit(masks: readonly Mask[] | undefined, id: string, key: string, value: number): Mask[] {
  const slider = MASK_SLIDERS.find((candidate) => candidate.key === key);
  if (!slider || !(LOCAL_KEYS as readonly string[]).includes(key) || !Number.isFinite(value)) return [...(masks ?? [])];
  const clamped = Math.round(Math.min(slider.max, Math.max(slider.min, value)) * 100) / 100;
  return change(masks, id, (mask) => {
    const edit = { ...mask.edit };
    if (clamped === 0) delete edit[slider.key]; else edit[slider.key] = clamped;
    return { ...mask, edit };
  });
}

/** Edge softness from the panel's 0 to 100 scale to the mask's 0 to 1. */
export const setMaskFeather = (masks: readonly Mask[] | undefined, id: string, percent: number): Mask[] =>
  change(masks, id, (mask) => ({ ...mask, feather: Number.isFinite(percent) ? Math.min(1, Math.max(0, percent / 100)) : mask.feather }));
