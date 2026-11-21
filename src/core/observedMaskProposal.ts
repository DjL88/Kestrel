import type { Mask, SubjectGrid } from './maskTypes';
import { captureAnatomyMaskSnapshot } from './anatomyMaskEvidence';

/** Explicit user-selected region. This is NOT an anatomy/species classifier. */
export interface ObservedMaskRequest {
  sourceSha256: string;
  framingKey: string;
  recipeRevision: number;
  maskSnapshot: string;
  /** Selection in framed-image coordinates, normalized to [0, 1]. */
  area: { x: number; y: number; w: number; h: number };
  operation: 'add' | 'subtract';
}
export type ObservedMaskProposal =
  | { ok: true; before: Extract<Mask, { kind: 'subject' }>; after: Extract<Mask, { kind: 'subject' }>; changedCells: number; requiresApproval: true }
  | { ok: false; reason: 'stale' | 'invalid' | 'too-broad' | 'no-change' };

function decode(grid: SubjectGrid): Uint8Array | null {
  if (!Number.isInteger(grid.w) || !Number.isInteger(grid.h) || grid.w < 8 || grid.h < 8 ||
      grid.w > 512 || grid.h > 512 || grid.w * grid.h > 262144) return null;
  try {
    const raw = atob(grid.data);
    if (raw.length !== grid.w * grid.h) return null;
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  } catch { return null; }
}
function encode(data: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < data.length; i += 8192) {
    raw += Array.from(data.subarray(i, i + 8192), v => String.fromCharCode(v)).join('');
  }
  return btoa(raw);
}
const validArea = (a: ObservedMaskRequest['area']) =>
  [a.x, a.y, a.w, a.h].every(Number.isFinite) &&
  a.x >= 0 && a.y >= 0 && a.w > 0 && a.h > 0 &&
  a.x + a.w <= 1 && a.y + a.h <= 1;

/**
 * Use a REAL local segmentation map of a user-selected area to propose a
 * reversible change. This deliberately makes no claim that the map identifies
 * feet, branches, hair or any other semantic part. Approval is always required.
 * Existing brush edits and local adjustment recipe remain untouched.
 */
export function proposeObservedMaskCorrection(
  mask: Extract<Mask, { kind: 'subject' }>,
  observed: SubjectGrid,
  request: ObservedMaskRequest,
  verifiedSourceSha256: string,
  currentRecipeRevision: number,
): ObservedMaskProposal {
  if (!/^[a-f0-9]{64}$/i.test(verifiedSourceSha256) ||
      request.sourceSha256 !== verifiedSourceSha256 ||
      request.framingKey !== mask.framingKey ||
      !Number.isSafeInteger(request.recipeRevision) || request.recipeRevision < 0 ||
      request.recipeRevision !== currentRecipeRevision ||
      request.maskSnapshot !== captureAnatomyMaskSnapshot(mask))
    return { ok: false, reason: 'stale' };
  if (!validArea(request.area) || (request.operation !== 'add' && request.operation !== 'subtract') ||
      observed.w !== mask.grid.w || observed.h !== mask.grid.h)
    return { ok: false, reason: 'invalid' };
  const base = decode(mask.grid);
  const detected = decode(observed);
  if (!base || !detected) return { ok: false, reason: 'invalid' };
  const result = new Uint8Array(base);
  let changed = 0;
  let subjectCells = 0;
  for (const value of base) if (value >= 128) subjectCells++;
  for (let y = 0; y < observed.h; y++) {
    const cy = (y + 0.5) / observed.h;
    if (cy < request.area.y || cy > request.area.y + request.area.h) continue;
    for (let x = 0; x < observed.w; x++) {
      const cx = (x + 0.5) / observed.w;
      if (cx < request.area.x || cx > request.area.x + request.area.w) continue;
      const i = y * observed.w + x;
      // A high-confidence segmentation pixel is a candidate, not proof of anatomy.
      if (detected[i] < 230) continue;
      const next = request.operation === 'add'
        ? Math.max(base[i], detected[i])
        : Math.round(base[i] * (1 - detected[i] / 255));
      if (next !== base[i]) { result[i] = next; changed++; }
    }
  }
  if (!changed) return { ok: false, reason: 'no-change' };
  // Prevent accidental bulk replacement from a broad or misplaced selection.
  if (changed > Math.max(4, Math.floor(subjectCells / 4)) ||
      changed > Math.max(4, Math.floor(base.length / 20)))
    return { ok: false, reason: 'too-broad' };
  return {
    ok: true, requiresApproval: true, changedCells: changed, before: mask,
    after: { ...mask, grid: { ...mask.grid, data: encode(result) }, detail: undefined,
      strokes: mask.strokes.map(stroke => ({ ...stroke, points: [...stroke.points] })) },
  };
}
