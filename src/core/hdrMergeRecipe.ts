import type { HdrSuccess, HdrTone } from './hdrMerge';

/**
 * The record kept on an HDR-merged photo: exactly which originals it was made from, each one's measured exposure and
 * placement, the ghost removal and the tone settings, so the merge can be explained, checked and made again. The merged
 * picture is a NEW linked file; nothing here points at an original's bytes for writing, and removing the merged photo
 * leaves every source as it was.
 */
export interface HdrSourceRef {
  frameId: string;
  stableKey: string;
  filename: string;
  /** The original's fingerprint when it was merged, so a later re-render can refuse a changed file. */
  originalSha256?: string;
}

export interface HdrMergeRecipe {
  version: 1;
  method: 'exposure-weighted-linear-merge';
  /** Real pixels only: before the tone step each output pixel is a weighted average of the aligned sources there. */
  generatedPixels: false;
  sources: HdrSourceRef[];
  referenceIndex: number;
  /** Per source, in stops against the reference, measured from the pixels. */
  exposureEv: number[];
  /** Per source: where it sat against the reference, in full-size pixels, and how well it matched. */
  alignment: Array<{ dx: number; dy: number; score: number }>;
  /** Per source: share of the picture it was left out of as a ghost (something moved). */
  ghostShare: number[];
  clippedShare: number;
  settings: { alignEdge: number; ghostRemoval: boolean; ghostThreshold: number };
  tone: HdrTone;
  /** What the sources were: verified full-size originals (8-bit decodes), 16-bit full-size develops of RAW sensor data, or both. */
  sourcePicture: 'original' | 'raw-develop-16' | 'mixed';
  sourceBits: 8 | 16 | 32;
  output: { width: number; height: number; format: 'png16' };
  createdAt: number;
}

const r = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

export function hdrMergeRecipe(
  result: HdrSuccess, sources: readonly HdrSourceRef[], sourcePicture: HdrMergeRecipe['sourcePicture'], createdAt: number,
): HdrMergeRecipe {
  return {
    version: 1, method: 'exposure-weighted-linear-merge', generatedPixels: false,
    sources: sources.map((s) => ({ frameId: s.frameId, stableKey: s.stableKey, filename: s.filename, ...(s.originalSha256 ? { originalSha256: s.originalSha256 } : {}) })),
    referenceIndex: result.referenceIndex,
    exposureEv: result.exposureEv.map((v) => r(v, 3)),
    alignment: result.alignment.map((a) => ({ dx: r(a.dx, 2), dy: r(a.dy, 2), score: r(a.score, 3) })),
    ghostShare: result.ghostShare.map((v) => r(v, 4)),
    clippedShare: r(result.clippedShare, 4),
    settings: { ...result.settings },
    tone: { ...result.tone },
    sourcePicture, sourceBits: result.sourceBits,
    output: { width: result.width, height: result.height, format: 'png16' },
    createdAt,
  };
}

const finite = (v: unknown, lo = -Infinity, hi = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v: unknown, max = 1024): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** A stored recipe, checked field by field (it comes back from backups and catalogues); null when it is not one. */
export function readHdrMergeRecipe(value: unknown): HdrMergeRecipe | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || v.method !== 'exposure-weighted-linear-merge' || v.generatedPixels !== false) return null;
  if (!Array.isArray(v.sources) || v.sources.length < 2 || v.sources.length > 7) return null;
  const n = v.sources.length;
  for (const s of v.sources) {
    if (!s || typeof s !== 'object') return null;
    const src = s as Record<string, unknown>;
    if (!str(src.frameId) || !str(src.stableKey, 4096) || !str(src.filename) || (src.originalSha256 !== undefined && !str(src.originalSha256, 128))) return null;
  }
  if (!Number.isInteger(v.referenceIndex) || !finite(v.referenceIndex, 0, n - 1)) return null;
  if (!Array.isArray(v.exposureEv) || v.exposureEv.length !== n || !v.exposureEv.every((e) => finite(e, -20, 20))) return null;
  if (!Array.isArray(v.alignment) || v.alignment.length !== n) return null;
  for (const a of v.alignment) {
    if (!a || typeof a !== 'object') return null;
    const al = a as Record<string, unknown>;
    if (!finite(al.dx) || !finite(al.dy) || !finite(al.score, 0, 1)) return null;
  }
  if (!Array.isArray(v.ghostShare) || v.ghostShare.length !== n || !v.ghostShare.every((g) => finite(g, 0, 1))) return null;
  if (!finite(v.clippedShare, 0, 1)) return null;
  const st = v.settings as Record<string, unknown> | undefined;
  if (!st || !finite(st.alignEdge, 64, 2048) || typeof st.ghostRemoval !== 'boolean' || !finite(st.ghostThreshold, 0.1, 3)) return null;
  const tone = v.tone as Record<string, unknown> | undefined;
  if (!tone || !finite(tone.white, 1, 64) || !finite(tone.highlights, -2, 2) || !finite(tone.shadows, -2, 2)) return null;
  if (v.sourcePicture !== 'original' && v.sourcePicture !== 'raw-develop-16' && v.sourcePicture !== 'mixed') return null;
  if (v.sourceBits !== 8 && v.sourceBits !== 16 && v.sourceBits !== 32) return null;
  const out = v.output as Record<string, unknown> | undefined;
  if (!out || !Number.isInteger(out.width) || !Number.isInteger(out.height) || !finite(out.width, 1) || !finite(out.height, 1) || out.format !== 'png16') return null;
  if (!finite(v.createdAt, 0)) return null;
  return value as HdrMergeRecipe;
}
