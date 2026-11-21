import type { Mask } from '../core/maskTypes';
import { captureAnatomyMaskSnapshot } from '../core/anatomyMaskEvidence';
import { proposeObservedMaskCorrection, type ObservedMaskProposal, type ObservedMaskRequest } from '../core/observedMaskProposal';
import { detectSubjectInArea } from './subjectDetector';

/**
 * One deliberate local on-device action: the photographer selects a visible
 * area and requests Add missing area / Remove spill. No background inference,
 * automatic correction, cloud call, species claim or semantic part invention.
 *
 * W1 should call this only from an explicit mask action, show before/after,
 * and commit 'after' through the existing undo/history recipe after approval.
 */
export async function suggestObservedMaskCorrection(
  piece: HTMLCanvasElement,
  mask: Extract<Mask, { kind: 'subject' }>,
  request: Omit<ObservedMaskRequest, 'maskSnapshot'>,
  verifiedSourceSha256: string,
  currentRecipeRevision: () => number,
  currentMask: () => Extract<Mask, { kind: 'subject' }> | null,
): Promise<ObservedMaskProposal> {
  const snapshot = captureAnatomyMaskSnapshot(mask);
  const capturedRevision = currentRecipeRevision();
  if (request.recipeRevision !== capturedRevision ||
      request.framingKey !== mask.framingKey ||
      request.sourceSha256 !== verifiedSourceSha256)
    return { ok: false, reason: 'stale' };
  const detected = await detectSubjectInArea(
    piece, request.area, piece.height / Math.max(1, piece.width),
  );
  const live = currentMask();
  if (!live || captureAnatomyMaskSnapshot(live) !== snapshot ||
      currentRecipeRevision() !== capturedRevision)
    return { ok: false, reason: 'stale' };
  if (!detected.assessment.usable) return { ok: false, reason: 'invalid' };
  return proposeObservedMaskCorrection(live, detected.grid,
    { ...request, maskSnapshot: snapshot }, verifiedSourceSha256, currentRecipeRevision());
}
