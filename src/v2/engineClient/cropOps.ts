import type { CropTransform } from '../ui/contract';

export const MAX_CROP_ZOOM = 8;
export const DEFAULT_CROP: CropTransform = { zoom: 1, panX: 0, panY: 0, insetTop: 0, insetRight: 0, insetBottom: 0, insetLeft: 0, flipH: false, flipV: false, rotateDeg: 0, borderWidth: 0, borderColour: '#ffffff', borderPlacement: 'all' };
export const MAX_BORDER_PERCENT = 10;
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

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
    borderWidth: num(value.borderWidth, 0, 0, MAX_BORDER_PERCENT),
    borderColour: typeof value.borderColour === 'string' && HEX_COLOUR.test(value.borderColour) ? value.borderColour.toLowerCase() : '#ffffff',
    borderPlacement: value.borderPlacement === 'horizontal' || value.borderPlacement === 'vertical' || value.borderPlacement === 'auto' ? value.borderPlacement : 'all',
  };
}

/** The crops stored on a photo, by format id. Read defensively: a stored value can come from an older build or a damaged file. */
export function readCrops(raw: unknown): Record<string, CropTransform> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([id]) => /^[a-zA-Z0-9_-]{1,80}$/.test(id) && !Object.hasOwn(Object.prototype, id)).map(([id, crop]) => [id, sanitiseCrop(crop)]));
}

export const patchCrop = (crop: CropTransform | undefined, patch: Partial<CropTransform>): CropTransform => sanitiseCrop({ ...(crop ?? DEFAULT_CROP), ...patch });

export const flipCrop = (crop: CropTransform | undefined, axis: 'horizontal' | 'vertical'): CropTransform =>
  patchCrop(crop, axis === 'horizontal' ? { flipH: !(crop ?? DEFAULT_CROP).flipH } : { flipV: !(crop ?? DEFAULT_CROP).flipV });

export const rotateCrop = (crop: CropTransform | undefined): CropTransform => patchCrop(crop, { rotateDeg: (((crop ?? DEFAULT_CROP).rotateDeg + 90) % 360) });

/** True when a format's crop is still the untouched whole picture, the only state a crop suggestion is offered over. */
export const isUntouchedCrop = (crop: CropTransform | undefined): boolean => {
  const c = crop ?? DEFAULT_CROP;
  return c.zoom === 1 && c.panX === 0 && c.panY === 0 && c.insetTop === 0 && c.insetRight === 0 && c.insetBottom === 0 && c.insetLeft === 0
    && !c.flipH && !c.flipV && c.rotateDeg === 0;
};

/**
 * The crop patch (zoom and pan) that shows `rect`, a rectangle of the picture in fractions with the frame's own shape.
 * At zoom 1 the frame shows the largest centred window of that shape; zoom shrinks the window and the pan, a share of the
 * frame, moves the picture under it. Insets are cleared. Apply it through the one crop path so it is one undoable step.
 */
export function cropPatchForRect(rect: { x0: number; y0: number; x1: number; y1: number }, pictureAspect: number, frameAspect: number): Partial<CropTransform> | null {
  const rectW = rect.x1 - rect.x0, rectH = rect.y1 - rect.y0;
  if (!(pictureAspect > 0) || !(frameAspect > 0) || !(rectW > 0) || !(rectH > 0)) return null;
  const windowW = Math.min(1, frameAspect / pictureAspect);
  const zoom = windowW / rectW;
  if (!Number.isFinite(zoom) || zoom < 1) return null;
  const panX = ((0.5 - (rect.x0 + rect.x1) / 2) * 100) / rectW;
  const panY = ((0.5 - (rect.y0 + rect.y1) / 2) * 100) / rectH;
  return { zoom, panX, panY, insetTop: 0, insetRight: 0, insetBottom: 0, insetLeft: 0 };
}
