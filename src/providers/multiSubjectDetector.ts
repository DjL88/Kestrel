import { findSubjects } from './objectDetector';
import { detectSubjectInArea } from './subjectDetector';
import { createSubjectMask, type Mask } from '../core/maskTypes';
import { guideRegion } from '../core/subjectGuide';
import { sampledRegion } from '../core/subjectRegion';

export interface InstanceFinding {
  label: string;
  score: number;
  mask: Extract<Mask, { kind: 'subject' }>;
}

/** Box-guided salient-object segmentation, not an identity or dedicated instance model.
 * Fail closed if any candidate cannot be segmented; never silently protect only the largest.
 */
export async function detectSubjectInstances(framed: HTMLCanvasElement, key: string, signal?: AbortSignal): Promise<InstanceFinding[]> {
  const found = await findSubjects(framed, signal);
  signal?.throwIfAborted();
  if (!found.length || found.length > 12) return [];
  const result: InstanceFinding[] = [];
  for (const [index, item] of found.entries()) {
    signal?.throwIfAborted();
    const { detection } = item;
    const region = guideRegion(detection.box, detection.score, framed.width, framed.height)
      ?? (found.length === 1 ? { x: 0, y: 0, w: 1, h: 1 } : null);
    if (!region) return [];
    const { box, bounds } = sampledRegion(region, framed.width, framed.height);
    const piece = document.createElement('canvas');
    try {
      piece.width = box.w;
      piece.height = box.h;
      const context = piece.getContext('2d');
      if (!context) return [];
      context.drawImage(framed, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      const segmented = await detectSubjectInArea(piece, bounds, framed.height / framed.width);
      signal?.throwIfAborted();
      if (!segmented.assessment.usable || segmented.assessment.confidence === 'low') return [];
      result.push({ label: detection.label, score: detection.score,
        mask: createSubjectMask('instance-' + index, segmented.grid, key, segmented.assessment.confidence, segmented.detail) });
    } finally {
      piece.width = 0;
      piece.height = 0;
    }
  }
  return result;
}
