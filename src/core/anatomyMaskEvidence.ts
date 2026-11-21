import type { Mask, SubjectGrid } from './maskTypes';

/**
 * Optional, rights-cleared local segmenter evidence. Each map refers to the
 * SAME framed image and source digest as the existing subject mask.
 * This function never guesses missing legs, wings, hands, paws or hair.
 */
export interface AnatomyEvidence {
  sourceSha256: string;
  framingKey: string;
  modelId: string;
  modelVersion: string;
  /** Full-image confidence maps, 0..255, with identical dimensions. */
  observedParts: SubjectGrid;
  foregroundOccluders: SubjectGrid;
  /** Independently calibrated probabilities, NOT raw detector logits. */
  partConfidence: number;
  occluderConfidence: number;
  /** Explicitly identify the model's class scope; species guesses are not accepted. */
  domain: 'wildlife' | 'person' | 'pet' | 'sport' | 'macro' | 'general';
}

export type AnatomyResult =
  | { ok: true; mask: Extract<Mask, { kind: 'subject' }>; reason: 'observed-refinement' }
  | { ok: false; reason: 'unverified-source' | 'uncalibrated-evidence' | 'invalid-grid' | 'no-change' };

const digest = /^[a-f0-9]{64}$/i;
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const validConfidence = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
function bytes(grid: SubjectGrid): Uint8Array | null {
  if (!Number.isInteger(grid.w) || !Number.isInteger(grid.h) || grid.w < 8 || grid.h < 8 ||
      grid.w > 512 || grid.h > 512 || grid.w * grid.h > 262144) return null;
  try {
    const raw = atob(grid.data);
    if (raw.length !== grid.w * grid.h) return null;
    return Uint8Array.from(raw, ch => ch.charCodeAt(0));
  } catch { return null; }
}
function encode(values: Uint8Array): string {
  // Chunk to avoid stack exhaustion for 512x512 masks.
  let raw = '';
  for (let i = 0; i < values.length; i += 8192)
    raw += Array.from(values.subarray(i, i + 8192), v => String.fromCharCode(v)).join('');
  return btoa(raw);
}

/**
 * Produce a NEW mask recipe only with calibrated, same-source observations.
 * The caller must verify the original SHA before applying the revision.
 * Existing manual strokes, limits, edits, invert and feather are preserved.
 * Occluder evidence subtracts only where independently confident; unknown
 * pixels keep the original mask and remain manually editable.
 */
export function refineObservedAnatomy(
  mask: Extract<Mask, { kind: 'subject' }>,
  evidence: AnatomyEvidence,
  verifiedSourceSha256: string,
): AnatomyResult {
  if (!digest.test(verifiedSourceSha256) || evidence.sourceSha256 !== verifiedSourceSha256 ||
      !evidence.modelId.trim() || !evidence.modelVersion.trim() ||
      evidence.framingKey !== mask.framingKey) return { ok: false, reason: 'unverified-source' };
  if (mask.confidence === 'low' || !validConfidence(evidence.partConfidence) ||
      !validConfidence(evidence.occluderConfidence) ||
      evidence.partConfidence < 0.9 || evidence.occluderConfidence < 0.9)
    return { ok: false, reason: 'uncalibrated-evidence' };
  const base = bytes(mask.grid);
  const parts = bytes(evidence.observedParts);
  const occluders = bytes(evidence.foregroundOccluders);
  if (!base || !parts || !occluders ||
      evidence.observedParts.w !== mask.grid.w || evidence.observedParts.h !== mask.grid.h ||
      evidence.foregroundOccluders.w !== mask.grid.w || evidence.foregroundOccluders.h !== mask.grid.h)
    return { ok: false, reason: 'invalid-grid' };
  const revised = new Uint8Array(base);
  let changed = false;
  for (let i = 0; i < revised.length; i++) {
    // Conservative high-probability observations, never a class-based shape guess.
    const part = parts[i] >= 230 ? parts[i] : 0;
    const occlusion = occluders[i] >= 230 ? occluders[i] : 0;
    const next = clamp(Math.max(base[i], part) * (1 - occlusion / 255));
    if (next !== base[i]) { revised[i] = next; changed = true; }
  }
  if (!changed) return { ok: false, reason: 'no-change' };
  return { ok: true, reason: 'observed-refinement',
    mask: { ...mask, grid: { ...mask.grid, data: encode(revised) },
      // Fine detail from the old segmentation is stale after a grid revision.
      detail: undefined, strokes: mask.strokes.map(stroke => ({ ...stroke, points: [...stroke.points] })) } };
}
