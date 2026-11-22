import type { CropTransform } from '../ui/contract';

export const MAX_CROP_ZOOM = 8;
export const DEFAULT_CROP: CropTransform = { zoom: 1, panX: 0, panY: 0, insetTop: 0, insetRight: 0, insetBottom: 0, insetLeft: 0, flipH: false, flipV: false, rotateDeg: 0 };

const num = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
const ROTATIONS = [0, 90, 180, 270];

/** A crop made valid: zoom between fit and the maximum, a position that stays sane, whole-turn rotation. Anything else falls back. */
export function sanitiseCrop(raw: unknown): CropTransform {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CROP };
  const value = raw as Record<string, unknown>;
  return {
    zoom: num(value.zoom, 1, 1, MAX_CROP_ZOOM),
    panX: num(value.panX, 0, -400, 400), panY: num(value.panY, 0, -400, 400),
    insetTop: num(value.insetTop, 0, 0, 30), insetRight: num(value.insetRight, 0, 0, 30),
    insetBottom: num(value.insetBottom, 0, 0, 30), insetLeft: num(value.insetLeft, 0, 0, 30),
    flipH: value.flipH === true, flipV: value.flipV === true,
    rotateDeg: ROTATIONS.includes(value.rotateDeg as number) ? (value.rotateDeg as number) : 0,
  };
}

/** The crops stored on a photo, by format id. Read defensively: a stored value can come from an older build or a damaged file. */
export function readCrops(raw: unknown): Record<string, CropTransform> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([id]) => id.length > 0 && id.length <= 80).map(([id, crop]) => [id, sanitiseCrop(crop)]));
}

export const patchCrop = (crop: CropTransform | undefined, patch: Partial<CropTransform>): CropTransform => sanitiseCrop({ ...(crop ?? DEFAULT_CROP), ...patch });

export const flipCrop = (crop: CropTransform | undefined, axis: 'horizontal' | 'vertical'): CropTransform =>
  patchCrop(crop, axis === 'horizontal' ? { flipH: !(crop ?? DEFAULT_CROP).flipH } : { flipV: !(crop ?? DEFAULT_CROP).flipV });

export const rotateCrop = (crop: CropTransform | undefined): CropTransform => patchCrop(crop, { rotateDeg: (((crop ?? DEFAULT_CROP).rotateDeg + 90) % 360) });
