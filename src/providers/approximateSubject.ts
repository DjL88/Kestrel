import { approximateSubjectGrid, boxCoverage, boxToFractions } from '../core/approximateSubject';
import type { SubjectAssessment } from '../core/subjectModel';
import type { FoundSubject } from './objectDetector';
import type { SubjectGrid } from '../core/maskTypes';

export interface ApproximateSubject {
  grid: SubjectGrid;
  assessment: SubjectAssessment;
  guide: { label: string; score: number };
  boxFinding: FoundSubject;
  /** Always true: a soft area inside the detector's box, never an outline. */
  approximate: true;
}

/**
 * The fallback for "Detect subject" when the outline model is unavailable: the allowed detectors (YOLOX-Tiny, and RF-DETR
 * Nano when installed) propose a box, and a soft elliptical area inside it is offered, labelled approximate. Null when the
 * detector finds nothing it trusts: the caller says so and offers drawing a region by hand. Runs on this device only.
 */
export async function detectSubjectApproximate(framed: HTMLCanvasElement, signal?: AbortSignal): Promise<ApproximateSubject | null> {
  const { findSubject } = await import('./objectDetector');
  const found = await findSubject(framed, signal);
  signal?.throwIfAborted();
  if (!found) return null;
  const box = boxToFractions(found.detection.box, framed.width, framed.height);
  if (!box || boxCoverage(box) > 0.92) return null;
  let pixels: { data: Uint8ClampedArray; width: number; height: number } | undefined;
  const scale = Math.min(1, 320 / Math.max(framed.width, framed.height));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(framed.width * scale));
  small.height = Math.max(1, Math.round(framed.height * scale));
  const context = small.getContext('2d', { willReadFrequently: true });
  if (context) { context.drawImage(framed, 0, 0, small.width, small.height); pixels = { data: context.getImageData(0, 0, small.width, small.height).data, width: small.width, height: small.height }; }
  const grid = approximateSubjectGrid(box, framed.height / framed.width, pixels);
  return {
    grid, guide: { label: found.detection.label, score: found.detection.score }, boxFinding: found, approximate: true,
    assessment: { coverage: boxCoverage(box) * Math.PI / 4, decisive: 0, confidence: 'medium', usable: true, reason: 'Approximate subject area, from the detector' },
  };
}
