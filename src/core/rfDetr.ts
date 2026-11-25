/**
 * RF-DETR Nano (Roboflow, Apache-2.0), the optional subject detector that runs beside YOLOX-tiny. It reads a plain
 * 384 x 384 resize of a tile (no letterbox), normalised with the ImageNet mean and standard deviation, and answers
 * 300 queries: 91 COCO logits each (sigmoid scores, id 0 unused) and a box as centre x, centre y, width, height in 0..1
 * of the tile. Its classes are mapped onto the same subject classes YOLOX reports, so the two can be compared.
 */
import { SUBJECT_CLASSES, mergeDetections, type Box, type Detection } from './objectDetection';

export const RFDETR_INPUT = 384;
export const RFDETR_QUERIES = 300;
export const RFDETR_LOGITS = 91;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** COCO category id (RF-DETR's 91) to the contiguous 80-class id YOLOX uses, for the subject classes only. */
export const RFDETR_TO_SUBJECT: Readonly<Record<number, number>> = {
  1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8,
  16: 14, 17: 15, 18: 16, 19: 17, 20: 18, 21: 19, 22: 20, 23: 21, 24: 22, 25: 23,
};

/** Planar float input from an RGBA picture already resized to 384 x 384. */
export function rfDetrInput(rgba: Uint8ClampedArray, size = RFDETR_INPUT): Float32Array {
  const plane = size * size;
  if (rgba.length < plane * 4) throw new RangeError('The picture is smaller than the model input.');
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) out[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Boxes in the photo's own pixels, subject classes only, at or above `minScore`. Non-finite output is ignored. */
export function decodeRfDetr(logits: Float32Array, boxes: Float32Array, tile: Box, minScore = 0.35): Detection[] {
  if (logits.length !== RFDETR_QUERIES * RFDETR_LOGITS || boxes.length !== RFDETR_QUERIES * 4) {
    throw new Error('The subject detector returned an unexpected result.');
  }
  const found: Detection[] = [];
  for (let q = 0; q < RFDETR_QUERIES; q += 1) {
    let bestId = -1;
    let bestLogit = -Infinity;
    for (let id = 1; id < RFDETR_LOGITS; id += 1) {
      const value = logits[q * RFDETR_LOGITS + id];
      if (value > bestLogit) { bestLogit = value; bestId = id; }
    }
    const classId = RFDETR_TO_SUBJECT[bestId];
    const score = sigmoid(bestLogit);
    if (classId === undefined || !(score >= minScore)) continue;
    const [cx, cy, w, h] = [boxes[q * 4], boxes[q * 4 + 1], boxes[q * 4 + 2], boxes[q * 4 + 3]];
    if (![cx, cy, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    const x0 = Math.max(0, cx - w / 2);
    const y0 = Math.max(0, cy - h / 2);
    const x1 = Math.min(1, cx + w / 2);
    const y1 = Math.min(1, cy + h / 2);
    if (x1 <= x0 || y1 <= y0) continue;
    found.push({
      label: SUBJECT_CLASSES[classId], classId, score,
      box: { x: tile.x + x0 * tile.w, y: tile.y + y0 * tile.h, w: (x1 - x0) * tile.w, h: (y1 - y0) * tile.h },
    });
  }
  return mergeDetections(found);
}

const overlap = (a: Box, b: Box) => {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

export type DetectorAgreement = 'both' | 'rfdetr-only' | 'yolox-only';

export interface TandemDetection extends Detection {
  agreement: DetectorAgreement;
  /** True when the two detectors did not agree: the photo needs a person's look. Never a reason to reject. */
  review: boolean;
}

/**
 * Compare the two detectors' answers. A subject both found (same class, boxes overlapping by `minIoU`) keeps the
 * better box and the higher score. A subject only one found is kept and marked for review, so disagreement can never
 * hide a subject or reject a photo. Without RF-DETR (`rfdetr` null) the YOLOX answer is returned unchanged in meaning.
 */
export function tandemDetections(rfdetr: readonly Detection[] | null, yolox: readonly Detection[], minIoU = 0.5): TandemDetection[] {
  if (rfdetr === null) return yolox.map((d) => ({ ...d, agreement: 'yolox-only', review: false }));
  const used = new Set<number>();
  const out: TandemDetection[] = [];
  for (const r of rfdetr) {
    let match = -1;
    let bestIoU = minIoU;
    yolox.forEach((y, i) => {
      if (used.has(i) || y.classId !== r.classId) return;
      const value = overlap(r.box, y.box);
      if (value >= bestIoU) { bestIoU = value; match = i; }
    });
    if (match >= 0) {
      used.add(match);
      const y = yolox[match];
      out.push({ ...(r.score >= y.score ? r : y), score: Math.max(r.score, y.score), agreement: 'both', review: false });
    } else {
      out.push({ ...r, agreement: 'rfdetr-only', review: true });
    }
  }
  yolox.forEach((y, i) => { if (!used.has(i)) out.push({ ...y, agreement: 'yolox-only', review: true }); });
  return out.sort((a, b) => b.score - a.score);
}
