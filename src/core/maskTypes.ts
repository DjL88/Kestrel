/** Controls a mask can adjust locally, tone and colour first, then detail. */
export const LOCAL_KEYS = ['exposure', 'warmth', 'colour', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'texture', 'clarity', 'sharpen'] as const;
/** The local controls that need neighbouring pixels, so a mask using them cannot be processed in separate bands. */
export const LOCAL_DETAIL_KEYS = ['texture', 'clarity', 'sharpen'] as const;
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
/** A low-resolution probability map from subject detection. One byte per cell, base64 encoded, row by row. */
export interface SubjectGrid { w: number; h: number; data: string }

export type MaskShape =
  | { kind: 'linear'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'radial'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'brush'; strokes: BrushStroke[] }
  /**
   * Found by the on-device model for the framing named by framingKey. Strokes refine it: paint adds, erase removes.
   * Invert gives the background.
   */
  | { kind: 'subject'; grid: SubjectGrid; framingKey: string; confidence: 'high' | 'medium' | 'low'; strokes: BrushStroke[] };

/** Restrict a mask by another one: only where it overlaps (intersect), or everywhere except it (subtract). */
export interface MaskLimit { id: string; mode: 'intersect' | 'subtract' }

export type Mask = MaskShape & {
  id: string;
  limit?: MaskLimit;
  invert: boolean;
  /** 0 is a crisp edge, 1 is the softest transition. */
  feather: number;
  edit: LocalEdit;
};

export const MAX_MASKS = 12;

export function usesDetail(masks: Mask[] | undefined): boolean {
  return !!masks?.some((mask) => LOCAL_DETAIL_KEYS.some((key) => !!mask.edit[key]));
}

export function hasActiveMasks(masks: Mask[] | undefined): boolean {
  return !!masks?.some((mask) => LOCAL_KEYS.some((key) => !!mask.edit[key]));
}

export function createMask(kind: Exclude<Mask['kind'], 'subject'>, id: string): Mask {
  const common = { id, invert: false, feather: 0.5, edit: {} as LocalEdit };
  if (kind === 'linear') return { ...common, kind, x1: 0.5, y1: 0.12, x2: 0.5, y2: 0.55 };
  if (kind === 'radial') return { ...common, kind, cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.18 };
  return { ...common, kind: 'brush', strokes: [], feather: 0.6 };
}

/** Identifies the crop and rotation a subject was detected for, so a later change can be flagged. */
export function framingKey(framing: { ratio: number | null; turns: number; straighten: number; x: number; y: number; size?: number } | undefined): string {
  const f = framing ?? { ratio: null, turns: 0, straighten: 0, x: 0.5, y: 0.5 };
  return [f.ratio === null ? 'o' : f.ratio.toFixed(4), f.turns, f.straighten.toFixed(2), f.x.toFixed(4), f.y.toFixed(4), (f.size ?? 1).toFixed(3)].join('|');
}

export function createSubjectMask(id: string, grid: SubjectGrid, key: string, confidence: 'high' | 'medium' | 'low'): Extract<Mask, { kind: 'subject' }> {
  return { id, kind: 'subject', grid, framingKey: key, confidence, strokes: [], invert: false, feather: 0.5, edit: {} };
}

const finite = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;

export function validMasks(value: unknown): value is Mask[] {
  if (!Array.isArray(value) || value.length > MAX_MASKS) return false;
  return value.every((raw) => {
    if (typeof raw !== 'object' || raw === null) return false;
    const mask = raw as Record<string, unknown>;
    if (typeof mask.id !== 'string' || !mask.id || typeof mask.invert !== 'boolean' || !finite(mask.feather, 0, 1)) return false;
    if (mask.limit !== undefined) {
      const limit = mask.limit as Record<string, unknown> | null;
      if (typeof limit !== 'object' || limit === null || typeof limit.id !== 'string' || !limit.id || limit.id === mask.id ||
        (limit.mode !== 'intersect' && limit.mode !== 'subtract')) return false;
    }
    const edit = mask.edit;
    if (typeof edit !== 'object' || edit === null) return false;
    if (!Object.entries(edit).every(([key, number]) => (LOCAL_KEYS as readonly string[]).includes(key) && finite(number, -2, 2))) return false;
    if (mask.kind === 'linear') return ['x1', 'y1', 'x2', 'y2'].every((key) => finite(mask[key], -2, 3));
    if (mask.kind === 'radial') return finite(mask.cx, -2, 3) && finite(mask.cy, -2, 3) && finite(mask.rx, 0.001, 5) && finite(mask.ry, 0.001, 5);
    const strokesValid = (strokes: unknown) => Array.isArray(strokes) && strokes.length <= 300 && strokes.every((stroke) => {
      if (typeof stroke !== 'object' || stroke === null) return false;
      const { radius, erase, points } = stroke as Record<string, unknown>;
      return finite(radius, 0.001, 0.5) && typeof erase === 'boolean' && Array.isArray(points) && points.length % 2 === 0 &&
        points.length <= 6000 && points.every((point) => finite(point, -1, 2));
    });
    if (mask.kind === 'brush') return strokesValid(mask.strokes);
    if (mask.kind === 'subject') {
      const grid = mask.grid as Record<string, unknown> | null;
      if (typeof grid !== 'object' || grid === null) return false;
      const { w, h, data } = grid;
      if (!Number.isInteger(w) || !Number.isInteger(h) || !finite(w, 8, 512) || !finite(h, 8, 512)) return false;
      const cells = w * h;
      const expectedPadding = (3 - cells % 3) % 3;
      if (typeof data !== 'string' || data.length !== 4 * Math.ceil(cells / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || (data.match(/=+$/)?.[0].length ?? 0) !== expectedPadding) return false;
      return typeof mask.framingKey === 'string' && mask.framingKey.length <= 80 &&
        ['high', 'medium', 'low'].includes(mask.confidence as string) && strokesValid(mask.strokes);
    }
    return false;
  });
}
