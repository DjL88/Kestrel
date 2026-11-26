import type { PanoSuccess } from './panorama';

/**
 * The record kept on a stitched panorama: exactly which originals it was made from, where each was placed on the
 * cylinder, the exposure gain applied to each, the honest crop, and the settings, so the panorama can be explained,
 * checked and made again. The panorama is a NEW linked file; nothing here writes to an original, and removing the
 * panorama leaves every source as it was.
 */
export interface PanoramaSourceRef {
  frameId: string;
  stableKey: string;
  filename: string;
  /** The original's fingerprint when it was stitched, so a later re-render can refuse a changed file. */
  originalSha256?: string;
}

export interface PanoramaRecipe {
  version: 1;
  method: 'cylindrical-feathered';
  /** Real pixels only: each output pixel is a weighted average of the frames that cover it; no fill anywhere. */
  generatedPixels: false;
  sources: PanoramaSourceRef[];
  referenceIndex: number;
  focalPx: number;
  focalSource: 'camera' | 'estimated';
  placements: Array<{ du: number; dv: number; rotationDegrees: number; inliers: number; matches: number }>;
  gains: Array<[number, number, number]>;
  /** The honest crop inside the full stitched outline (pixels). */
  crop: { x: number; y: number; width: number; height: number; fullWidth: number; fullHeight: number };
  seamMismatch: number;
  settings: { feather: number; workEdge: number; matchExposure: boolean };
  sourcePicture: 'original' | 'raw-develop';
  sourceBits: 8 | 16;
  output: { width: number; height: number; format: 'png16' };
  createdAt: number;
}

export function panoramaRecipe(
  result: PanoSuccess, sources: readonly PanoramaSourceRef[], sourcePicture: PanoramaRecipe['sourcePicture'], createdAt: number,
): PanoramaRecipe {
  return {
    version: 1, method: 'cylindrical-feathered', generatedPixels: false,
    sources: sources.map((s) => ({ frameId: s.frameId, stableKey: s.stableKey, filename: s.filename, ...(s.originalSha256 ? { originalSha256: s.originalSha256 } : {}) })),
    referenceIndex: result.referenceIndex,
    focalPx: result.focalPx, focalSource: result.focalSource,
    placements: result.placements.map((p) => ({ ...p })),
    gains: result.gains.map((g) => [g[0], g[1], g[2]]),
    crop: { ...result.crop },
    seamMismatch: result.seamMismatch,
    settings: { ...result.settings },
    sourcePicture, sourceBits: result.sourceBits,
    output: { width: result.width, height: result.height, format: 'png16' },
    createdAt,
  };
}

const finite = (v: unknown, lo = -Infinity, hi = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo = 0): v is number => Number.isInteger(v) && (v as number) >= lo;
const str = (v: unknown, max = 1024): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored recipe, checked field by field (it comes back from backups and catalogues); null when it is not one. */
export function readPanoramaRecipe(value: unknown): PanoramaRecipe | null {
  if (!rec(value)) return null;
  const v = value;
  if (v.version !== 1 || v.method !== 'cylindrical-feathered' || v.generatedPixels !== false) return null;
  if (!Array.isArray(v.sources) || v.sources.length < 2 || v.sources.length > 12) return null;
  const n = v.sources.length;
  for (const s of v.sources) {
    if (!rec(s) || !str(s.frameId) || !str(s.stableKey, 4096) || !str(s.filename) || (s.originalSha256 !== undefined && !str(s.originalSha256, 128))) return null;
  }
  if (!int(v.referenceIndex) || (v.referenceIndex as number) > n - 1) return null;
  if (!finite(v.focalPx, 1, 1e6) || (v.focalSource !== 'camera' && v.focalSource !== 'estimated')) return null;
  if (!Array.isArray(v.placements) || v.placements.length !== n) return null;
  for (const p of v.placements) {
    if (!rec(p) || !finite(p.du) || !finite(p.dv) || !finite(p.rotationDegrees, -45, 45) || !int(p.inliers) || !int(p.matches)) return null;
  }
  if (!Array.isArray(v.gains) || v.gains.length !== n || !v.gains.every((g) => Array.isArray(g) && g.length === 3 && g.every((x) => finite(x, 0.25, 4)))) return null;
  const c = v.crop;
  if (!rec(c) || !int(c.x) || !int(c.y) || !int(c.width, 1) || !int(c.height, 1) || !int(c.fullWidth, 1) || !int(c.fullHeight, 1)
    || (c.x as number) + (c.width as number) > (c.fullWidth as number) || (c.y as number) + (c.height as number) > (c.fullHeight as number)) return null;
  if (!finite(v.seamMismatch, 0, 1)) return null;
  const st = v.settings;
  if (!rec(st) || !finite(st.feather, 0, 0.5) || !finite(st.workEdge, 64, 4096) || typeof st.matchExposure !== 'boolean') return null;
  if (v.sourcePicture !== 'original' && v.sourcePicture !== 'raw-develop') return null;
  if (v.sourceBits !== 8 && v.sourceBits !== 16) return null;
  const out = v.output;
  if (!rec(out) || !int(out.width, 1) || !int(out.height, 1) || out.format !== 'png16') return null;
  if (out.width !== c.width || out.height !== c.height) return null;
  if (!finite(v.createdAt, 0)) return null;
  return value as unknown as PanoramaRecipe;
}
