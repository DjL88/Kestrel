import type { FrameAlignment, StackSuccess } from './focusStack';

/**
 * The record kept on a focus-stacked photo: exactly which originals it was made from, how each was placed, and the
 * settings, so the stack can be explained, checked and made again. The stacked picture is a NEW linked file; nothing
 * here points the stack at an original's bytes for writing, and removing the stacked photo leaves every source as it was.
 */
export interface FocusStackSourceRef {
  frameId: string;
  stableKey: string;
  filename: string;
  /** The original's fingerprint when it was stacked, so a later re-render can refuse a changed file. */
  originalSha256?: string;
}

export interface FocusStackRecipe {
  version: 1;
  method: 'sharpness-weighted-blend';
  /** Real pixels only: each output pixel is a weighted average of the aligned sources there. */
  generatedPixels: false;
  sources: FocusStackSourceRef[];
  referenceIndex: number;
  /** Per source: global placement (pixels, scale, degrees) and how much local refinement matched. Rounded for storage. */
  alignment: Array<Pick<FrameAlignment, 'dx' | 'dy' | 'scale' | 'rotationDegrees' | 'score'> & { localMatched: number; localTiles: number; localMaxShift: number }>;
  /** Share of the picture each source supplied most of, 0 to 1. */
  contribution: number[];
  settings: { power: number; feather: number; alignEdge: number; localAlign: boolean };
  /** What the sources were: verified full-size originals, or 8-bit full-size develops of RAW sensor data. */
  sourcePicture: 'original' | 'raw-develop';
  sourceBits: 8 | 16 | 32;
  output: { width: number; height: number; format: 'png16' };
  createdAt: number;
}

const r = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

export function focusStackRecipe(
  result: StackSuccess, sources: readonly FocusStackSourceRef[], sourcePicture: FocusStackRecipe['sourcePicture'], createdAt: number,
): FocusStackRecipe {
  return {
    version: 1, method: 'sharpness-weighted-blend', generatedPixels: false,
    sources: sources.map((s) => ({ frameId: s.frameId, stableKey: s.stableKey, filename: s.filename, ...(s.originalSha256 ? { originalSha256: s.originalSha256 } : {}) })),
    referenceIndex: result.referenceIndex,
    alignment: result.alignment.map((a) => ({
      dx: r(a.dx, 2), dy: r(a.dy, 2), scale: r(a.scale, 5), rotationDegrees: r(a.rotationDegrees, 3), score: r(a.score, 3),
      localMatched: a.localTiles.matched, localTiles: a.localTiles.total, localMaxShift: r(a.localTiles.maxShift, 2),
    })),
    contribution: result.contribution.map((c) => r(c, 4)),
    settings: { ...result.settings },
    sourcePicture, sourceBits: result.sourceBits,
    output: { width: result.width, height: result.height, format: 'png16' },
    createdAt,
  };
}

const finite = (v: unknown, lo = -Infinity, hi = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v: unknown, max = 1024): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** A stored recipe, checked field by field (it comes back from backups and catalogues); null when it is not one. */
export function readFocusStackRecipe(value: unknown): FocusStackRecipe | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.method !== 'sharpness-weighted-blend' || v.generatedPixels !== false) return null;
  if (!Array.isArray(v.sources) || v.sources.length < 2 || v.sources.length > 30) return null;
  const n = v.sources.length;
  for (const s of v.sources) {
    if (!s || typeof s !== 'object') return null;
    const src = s as Record<string, unknown>;
    if (!str(src.frameId) || !str(src.stableKey, 4096) || !str(src.filename) || (src.originalSha256 !== undefined && !str(src.originalSha256, 128))) return null;
  }
  if (!Number.isInteger(v.referenceIndex) || !finite(v.referenceIndex, 0, n - 1)) return null;
  if (!Array.isArray(v.alignment) || v.alignment.length !== n) return null;
  for (const a of v.alignment) {
    if (!a || typeof a !== 'object') return null;
    const al = a as Record<string, unknown>;
    if (!finite(al.dx) || !finite(al.dy) || !finite(al.scale, 0.5, 2) || !finite(al.rotationDegrees, -45, 45) || !finite(al.score, -1, 1)
      || !finite(al.localMatched, 0) || !finite(al.localTiles, 0) || !finite(al.localMaxShift, 0)) return null;
  }
  if (!Array.isArray(v.contribution) || v.contribution.length !== n || !v.contribution.every((c) => finite(c, 0, 1))) return null;
  const st = v.settings as Record<string, unknown> | undefined;
  if (!st || !finite(st.power, 1, 12) || !finite(st.feather, 1, 1000) || !finite(st.alignEdge, 64, 2048) || typeof st.localAlign !== 'boolean') return null;
  if (v.sourcePicture !== 'original' && v.sourcePicture !== 'raw-develop') return null;
  if (v.sourceBits !== 8 && v.sourceBits !== 16 && v.sourceBits !== 32) return null;
  const out = v.output as Record<string, unknown> | undefined;
  if (!out || !Number.isInteger(out.width) || !Number.isInteger(out.height) || !finite(out.width, 1) || !finite(out.height, 1) || out.format !== 'png16') return null;
  if (!finite(v.createdAt, 0)) return null;
  return value as FocusStackRecipe;
}
