import { scorePreview, scoreWithSubjects, type CullSuggestion, type SubjectFinding } from '../core/autoCull';
import { boxSharpness, decodeTile, mergeDetections, tilePlan, tileScale, toInput, type Box, type Detection } from '../core/objectDetection';

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

function sharpnessOf(make: MakeContext, picture: Drawable, box: Box): number {
  const pad = 0.1;
  const x = Math.max(0, box.x - box.w * pad);
  const y = Math.max(0, box.y - box.h * pad);
  const cw = Math.min(picture.width - x, box.w * (1 + 2 * pad));
  const ch = Math.min(picture.height - y, box.h * (1 + 2 * pad));
  const scale = Math.min(1, 160 / Math.max(cw, ch));
  const w = Math.max(4, Math.round(cw * scale));
  const h = Math.max(4, Math.round(ch * scale));
  try { return boxSharpness(draw(make, picture, { x, y, w: cw, h: ch }, w, h), w, h); } catch { return 0; }
}

export async function computeCullObservation(
  frameId: string, picture: Drawable, make: MakeContext, infer: Infer | null,
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
    const findings: SubjectFinding[] = mergeDetections(detections)
      .filter((d) => d.score >= 0.3 && finite(d))
      .sort((a, b) => b.score * Math.sqrt(b.box.w * b.box.h) - a.score * Math.sqrt(a.box.w * a.box.h))
      .slice(0, 8)
      .map((d) => ({ label: d.label, score: d.score, size: Math.max(d.box.w, d.box.h), sharpness: sharpnessOf(make, picture, d.box) }));
    return { result: scoreWithSubjects(base, findings), base, detectorFailed: false };
  } catch {
    return { result: base, base, detectorFailed: true };
  }
}
