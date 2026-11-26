import { scorePreview, scoreWithSubjects, type CullSuggestion, type SubjectFinding } from '../core/autoCull';
import { boxSharpness, decodeTile, mergeDetections, tilePlan, tileScale, toInput, type Box, type Detection } from '../core/objectDetection';
import { SAM_INPUT, samInput, samMaskSize } from '../core/efficientSam';
import { boxInMask, maskedSharpness, usableMask, type SubjectMaskPixels } from '../core/maskSharpness';

/**
 * The culling look at one decoded picture, written against any 2D canvas so it runs inside a worker
 * (OffscreenCanvas + ImageBitmap) as well as in a unit test. It is the same work as cullPreviewObservation.ts
 * followed by objectDetector.ts's findSubjectsSamePass: the 256 px detail score, then YOLOX on the whole frame, tiles
 * only when nothing confident was seen, every merged subject's sharpness at 160 px. The RF-DETR tandem is not here:
 * when that optional pack is installed the caller keeps the main-thread path, so both give the same answer.
 *
 * This is observation, not a decision. A detector failure is reported (detectorFailed), never hidden, so a degraded
 * scan can never auto-accept (src/core/cullEvidenceFinal.ts).
 */
export interface Drawable { readonly width: number; readonly height: number }
export interface Context2D {
  drawImage(image: never, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  imageSmoothingQuality?: string;
}
export type MakeContext = (width: number, height: number) => Context2D | null;
/** One detector run on a 416 × 416 input; resolves with the raw output rows. */
export type Infer = (input: Float32Array) => Promise<Float32Array>;
/**
 * Masked sharpness preview (x-std-mask-sharpness): EfficientSAM-Ti reads the picture once (`input`, 1024 × 1024 planar
 * RGB) and answers one box prompt per subject (boxes in mask pixels), with a mask of `size` or null for each, in order.
 * Passed only when the preview is on and the pack is installed; without it every subject keeps its box sharpness.
 */
export type Segment = (input: Float32Array, boxes: readonly Box[], size: { w: number; h: number }) => Promise<Array<SubjectMaskPixels | null>>;

export interface ComputedObservation {
  result: CullSuggestion;
  base: CullSuggestion;
  detectorFailed: boolean;
}

function draw(make: MakeContext, picture: Drawable, box: Box, width: number, height: number): Uint8ClampedArray {
  const context = make(width, height);
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture as never, box.x, box.y, box.w, box.h, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

/**
 * A subject's sharpness on its padded box at 160 px: inside its mask when a usable one is given (src/core/maskSharpness.ts),
 * otherwise over the whole box. `maskSharpness` is set only when the mask was used.
 */
export function subjectSharpness(make: MakeContext, picture: Drawable, box: Box, mask?: SubjectMaskPixels | null): { sharpness: number; maskSharpness?: number } {
  const pad = 0.1;
  const x = Math.max(0, box.x - box.w * pad);
  const y = Math.max(0, box.y - box.h * pad);
  const cw = Math.min(picture.width - x, box.w * (1 + 2 * pad));
  const ch = Math.min(picture.height - y, box.h * (1 + 2 * pad));
  const scale = Math.min(1, 160 / Math.max(cw, ch));
  const w = Math.max(4, Math.round(cw * scale));
  const h = Math.max(4, Math.round(ch * scale));
  let rgba: Uint8ClampedArray;
  try { rgba = draw(make, picture, { x, y, w: cw, h: ch }, w, h); } catch { return { sharpness: 0 }; }
  const masked = usableMask(mask) ? maskedSharpness(rgba, w, h, mask, { x, y, w: cw, h: ch }, picture.width, picture.height) : null;
  return masked === null ? { sharpness: boxSharpness(rgba, w, h) } : { sharpness: masked, maskSharpness: masked };
}

/** One mask per box from `segment`, or nulls when it fails: a failed mask only means the box value is kept. */
export async function subjectMasks(make: MakeContext, picture: Drawable, boxes: readonly Box[], segment: Segment | null): Promise<Array<SubjectMaskPixels | null>> {
  if (!segment || !boxes.length) return boxes.map(() => null);
  try {
    const size = samMaskSize(picture.width, picture.height);
    const input = samInput(draw(make, picture, { x: 0, y: 0, w: picture.width, h: picture.height }, SAM_INPUT, SAM_INPUT));
    const masks = await segment(input, boxes.map((box) => boxInMask(box, picture.width, picture.height, size)), size);
    return boxes.map((_, i) => masks[i] ?? null);
  } catch {
    return boxes.map(() => null);
  }
}

export async function computeCullObservation(
  frameId: string, picture: Drawable, make: MakeContext, infer: Infer | null, segment: Segment | null = null,
): Promise<ComputedObservation> {
  const { width, height } = picture;
  const scale = Math.min(1, 256 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const base = scorePreview(frameId, draw(make, picture, { x: 0, y: 0, w: width, h: height }, w, h), w, h);
  if (!infer) return { result: base, base, detectorFailed: false };
  try {
    const lookIn = async (tile: Box): Promise<Detection[]> => {
      const s = tileScale(tile);
      const tw = Math.max(1, Math.round(tile.w * s));
      const th = Math.max(1, Math.round(tile.h * s));
      return decodeTile(await infer(toInput(draw(make, picture, tile, tw, th), tw, th)), tile);
    };
    const plan = tilePlan(width, height);
    let detections = await lookIn(plan[0]);
    if (!detections.some((d) => d.score >= 0.5)) {
      for (const tile of plan.slice(1)) detections = detections.concat(await lookIn(tile));
    }
    const finite = (d: Detection) => Number.isFinite(d.box.x) && Number.isFinite(d.box.y) &&
      Number.isFinite(d.box.w) && Number.isFinite(d.box.h) && d.box.w > 0 && d.box.h > 0;
    const top = mergeDetections(detections)
      .filter((d) => d.score >= 0.3 && finite(d))
      .sort((a, b) => b.score * Math.sqrt(b.box.w * b.box.h) - a.score * Math.sqrt(a.box.w * a.box.h))
      .slice(0, 8);
    const masks = await subjectMasks(make, picture, top.map((d) => d.box), segment);
    const findings: SubjectFinding[] = top.map((d, i) => ({
      label: d.label, score: d.score, size: Math.max(d.box.w, d.box.h), ...subjectSharpness(make, picture, d.box, masks[i]),
    }));
    return { result: scoreWithSubjects(base, findings), base, detectorFailed: false };
  } catch {
    return { result: base, base, detectorFailed: true };
  }
}
