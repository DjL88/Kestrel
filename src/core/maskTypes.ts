/** Controls a mask can adjust locally. Detail controls stay global. */
export const LOCAL_KEYS = ['exposure', 'warmth', 'colour', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance'] as const;
export type LocalKey = (typeof LOCAL_KEYS)[number];
export type LocalEdit = Partial<Record<LocalKey, number>>;

export interface BrushStroke {
  /** Radius in widths of the framed photo. */
  radius: number;
  erase: boolean;
  /** Flat x, y pairs, each 0 to 1 across the framed photo. */
  points: number[];
}

/**
 * Positions are 0 to 1 across the framed photo (after crop and rotation). Lengths are in widths of the photo,
 * so shapes stay round whatever the aspect ratio. Changing the crop afterwards moves the masks with the crop box.
 */
export type MaskShape =
  | { kind: 'linear'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'radial'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'brush'; strokes: BrushStroke[] };

export type Mask = MaskShape & {
  id: string;
  invert: boolean;
  /** 0 is a crisp edge, 1 is the softest transition. */
  feather: number;
  edit: LocalEdit;
};

export const MAX_MASKS = 12;

export function hasActiveMasks(masks: Mask[] | undefined): boolean {
  return !!masks?.some((mask) => LOCAL_KEYS.some((key) => !!mask.edit[key]));
}

export function createMask(kind: Mask['kind'], id: string): Mask {
  const common = { id, invert: false, feather: 0.5, edit: {} as LocalEdit };
  if (kind === 'linear') return { ...common, kind, x1: 0.5, y1: 0.12, x2: 0.5, y2: 0.55 };
  if (kind === 'radial') return { ...common, kind, cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.18 };
  return { ...common, kind: 'brush', strokes: [], feather: 0.6 };
}

const finite = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;

export function validMasks(value: unknown): value is Mask[] {
  if (!Array.isArray(value) || value.length > MAX_MASKS) return false;
  return value.every((raw) => {
    if (typeof raw !== 'object' || raw === null) return false;
    const mask = raw as Record<string, unknown>;
    if (typeof mask.id !== 'string' || !mask.id || typeof mask.invert !== 'boolean' || !finite(mask.feather, 0, 1)) return false;
    const edit = mask.edit;
    if (typeof edit !== 'object' || edit === null) return false;
    if (!Object.entries(edit).every(([key, number]) => (LOCAL_KEYS as readonly string[]).includes(key) && finite(number, -2, 2))) return false;
    if (mask.kind === 'linear') return ['x1', 'y1', 'x2', 'y2'].every((key) => finite(mask[key], -2, 3));
    if (mask.kind === 'radial') return finite(mask.cx, -2, 3) && finite(mask.cy, -2, 3) && finite(mask.rx, 0.001, 5) && finite(mask.ry, 0.001, 5);
    if (mask.kind === 'brush') {
      const strokes = mask.strokes;
      return Array.isArray(strokes) && strokes.length <= 300 && strokes.every((stroke) => {
        if (typeof stroke !== 'object' || stroke === null) return false;
        const { radius, erase, points } = stroke as Record<string, unknown>;
        return finite(radius, 0.001, 0.5) && typeof erase === 'boolean' && Array.isArray(points) && points.length % 2 === 0 &&
          points.length <= 6000 && points.every((point) => finite(point, -1, 2));
      });
    }
    return false;
  });
}
