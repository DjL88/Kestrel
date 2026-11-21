import type { Mask, SubjectGrid } from './maskTypes';

/**
 * Optional, rights-cleared local segmenter evidence. Each map refers to the
 * SAME framed image and source digest as the existing subject mask.
 * This function never guesses missing legs, wings, hands, paws or hair.
 */
export interface AnatomyEvidence {
  sourceSha256: string;
  framingKey: string;
  /** Exact base grid this asynchronous proposal analysed (no cross-revision replacement). */
  baseGridData: string;
  /** Monotonically increasing edit recipe revision captured before inference. */
  recipeRevision: number;
  modelId: string;
  modelVersion: string;
  /** Full-image confidence maps, 0..255, with identical dimensions. */
  observedParts: SubjectGrid;
  foregroundOccluders: SubjectGrid;
  /** Independent calibration provenance; caller must verify the signed/approved local manifest. */
  calibration: {
    modelId: string;
    modelVersion: string;
    domain: AnatomyEvidence['domain'];
    datasetDigestSha256: string;
    calibrationVersion: string;
    positiveCount: number;
    negativeCount: number;
    /** A trusted caller has validated this rights-cleared evaluation manifest. */
    approved: boolean;
  };
  /** Independently calibrated probabilities, NOT raw detector logits. */
  partConfidence: number;
  occluderConfidence: number;
  /** Explicitly identify the model's class scope; species guesses are not accepted. */
  domain: 'wildlife' | 'person' | 'pet' | 'sport' | 'macro' | 'general';
}

/** A trusted, offline signed-asset authority must verify the exact calibration
 * manifest and its model/dataset binding. Never trust evidence.approved alone.
 * This callback must fail closed if the model pack is absent or unverified. */
export type VerifyAnatomyCalibration = (calibration: AnatomyEvidence['calibration'], evidence: AnatomyEvidence) => boolean;

export type AnatomyResult =
  | { ok: true; mask: Extract<Mask, { kind: 'subject' }>; reason: 'observed-refinement' }
  | { ok: false; reason: 'unverified-source' | 'uncalibrated-evidence' | 'invalid-grid' | 'conflicting-evidence' | 'excessive-change' | 'detached-anatomy' | 'stale-recipe' | 'no-change' };

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
  currentRecipeRevision: number,
  verifyCalibration: VerifyAnatomyCalibration,
): AnatomyResult {
  if (!digest.test(verifiedSourceSha256) || evidence.sourceSha256 !== verifiedSourceSha256 ||
      !evidence.modelId.trim() || !evidence.modelVersion.trim() ||
      evidence.framingKey !== mask.framingKey) return { ok: false, reason: 'unverified-source' };
  // A matching source digest alone does not protect edits made while a model
  // was running. Refuse stale proposals rather than replace a newer mask.
  if (!Number.isSafeInteger(currentRecipeRevision) || currentRecipeRevision < 0 ||
      !Number.isSafeInteger(evidence.recipeRevision) || evidence.recipeRevision < 0 ||
      evidence.recipeRevision !== currentRecipeRevision ||
      evidence.baseGridData !== mask.grid.data)
    return { ok: false, reason: 'stale-recipe' };
  const calibration = evidence.calibration;
  // A bare detector score is never a calibrated probability. Reject missing,
  // unapproved or wrong-domain/model evaluation records, including fixtures.
  // A trusted asset loader must verify the underlying signed manifest; this
  // boolean alone is NOT proof of real-world calibration.
  if (!calibration || calibration.approved !== true ||
      calibration.modelId !== evidence.modelId ||
      calibration.modelVersion !== evidence.modelVersion ||
      calibration.domain !== evidence.domain ||
      !digest.test(calibration.datasetDigestSha256) ||
      !calibration.calibrationVersion?.trim() ||
      !Number.isSafeInteger(calibration.positiveCount) ||
      !Number.isSafeInteger(calibration.negativeCount) ||
      calibration.positiveCount < 1 || calibration.negativeCount < 1 ||
      typeof verifyCalibration !== 'function')
    return { ok: false, reason: 'uncalibrated-evidence' };
  // A self-asserted approved:true bit is insufficient: a separately trusted
  // signed-asset authority must validate this precise manifest before use.
  try {
    if (verifyCalibration(calibration, evidence) !== true)
      return { ok: false, reason: 'uncalibrated-evidence' };
  } catch {
    return { ok: false, reason: 'uncalibrated-evidence' };
  }
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
  let added = 0;
  let removed = 0;
  let subjectCells = 0;
  for (let i = 0; i < revised.length; i++) {
    // These are pixel-wise evidence maps, not an invitation to extrapolate anatomy.
    // A detector calling the SAME pixel both an appendage and an occluder is
    // contradictory; never silently pick a winner.
    const part = parts[i] >= 230 ? parts[i] : 0;
    const occlusion = occluders[i] >= 230 ? occluders[i] : 0;
    if (part && occlusion) return { ok: false, reason: 'conflicting-evidence' };
    if (base[i] >= 128) subjectCells++;
    const next = clamp(Math.max(base[i], part) * (1 - occlusion / 255));
    if (next !== base[i]) {
      revised[i] = next;
      changed = true;
      if (base[i] < 128 && next >= 128) added++;
      if (base[i] >= 128 && next < 128) removed++;
    }
  }
  if (!changed) return { ok: false, reason: 'no-change' };
  // A small observed foot or foreground branch is plausible; wholesale
  // replacement of the silhouette is not. Keep the old mask for manual review.
  const maxChange = Math.max(4, Math.floor(subjectCells / 4));
  if (added > maxChange || removed > maxChange)
    return { ok: false, reason: 'excessive-change' };
  if (added > 0) {
    // Only add pixels connected to an existing observed subject. A high
    // detector score alone must not paste an isolated twig, bird or bystander
    // into the mask. Eight-neighbour connectivity retains diagonal thin legs.
    // This traverses at most the bounded 512² mask; no recursive stack.
    const width = mask.grid.w;
    const height = mask.grid.h;
    const seen = new Uint8Array(revised.length);
    const queue = new Int32Array(revised.length);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < base.length; i++) {
      if (base[i] >= 128 && revised[i] >= 128) {
        seen[i] = 1;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
          const nextIndex = ny * width + nx;
          if (!seen[nextIndex] && revised[nextIndex] >= 128) {
            seen[nextIndex] = 1;
            queue[tail++] = nextIndex;
          }
        }
      }
    }
    for (let i = 0; i < base.length; i++) {
      if (base[i] < 128 && revised[i] >= 128 && !seen[i])
        return { ok: false, reason: 'detached-anatomy' };
    }
  }
  return { ok: true, reason: 'observed-refinement',
    mask: { ...mask, grid: { ...mask.grid, data: encode(revised) },
      // Fine detail from the old segmentation is stale after a grid revision.
      detail: undefined, strokes: mask.strokes.map(stroke => ({ ...stroke, points: [...stroke.points] })) } };
}
