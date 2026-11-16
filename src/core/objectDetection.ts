/**
 * Finding the subject: a small object detector that recognises people, animals and vehicles (including aeroplanes), whatever the camera.
 * YOLOX-tiny by Megvii, Apache-2.0 (github.com/Megvii-BaseDetection/YOLOX), trained on the 80 COCO classes. Runs on this device.
 * A photo with a distant jet is far larger than the model's 416 px input, so large photos are searched in overlapping tiles.
 */
export const DETECTOR_MODEL = {
  name: 'YOLOX-tiny',
  file: 'yolox_tiny.onnx',
  bytes: 20219662,
  sha256: '427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7',
  licence: 'Apache-2.0',
  inputSize: 416,
} as const;

/** The COCO classes that can be the subject of a photo for this app. Everything else (chairs, bottles...) is ignored. */
export const SUBJECT_CLASSES: Record<number, string> = {
  0: 'person', 1: 'bicycle', 2: 'car', 3: 'motorcycle', 4: 'aeroplane', 5: 'bus', 6: 'train', 7: 'truck', 8: 'boat',
  14: 'bird', 15: 'cat', 16: 'dog', 17: 'horse', 18: 'sheep', 19: 'cow', 20: 'elephant', 21: 'bear', 22: 'zebra', 23: 'giraffe',
};

export interface Box { x: number; y: number; w: number; h: number }
export interface Detection { label: string; classId: number; score: number; box: Box }

const STRIDES = [8, 16, 32] as const;
const CLASS_COUNT = 80;
const ROW = 5 + CLASS_COUNT;
export const OUTPUT_ROWS = STRIDES.reduce((sum, stride) => sum + (DETECTOR_MODEL.inputSize / stride) ** 2, 0);

/** The areas of a photo to look at: the whole photo first, then overlapping tiles when it is big enough that a distant subject would be tiny. */
export function tilePlan(width: number, height: number, tileEdge = 2400, overlap = 0.15): Box[] {
  const whole: Box = { x: 0, y: 0, w: width, h: height };
  if (Math.max(width, height) <= tileEdge) return [whole];
  const axis = (length: number) => {
    const count = Math.max(1, Math.ceil(length / (tileEdge * (1 - overlap))));
    if (count === 1) return [{ start: 0, size: length }];
    const size = Math.min(length, Math.ceil(length / (count - overlap * (count - 1))));
    const step = (length - size) / (count - 1);
    return Array.from({ length: count }, (_, i) => ({ start: Math.round(i * step), size }));
  };
  const tiles = [whole];
  for (const row of axis(height)) for (const col of axis(width)) tiles.push({ x: col.start, y: row.start, w: col.size, h: row.size });
  return tiles;
}

/** How much a tile is shrunk to fit the model's square input (the picture sits top-left, the rest is padding). */
export const tileScale = (tile: Box, size = DETECTOR_MODEL.inputSize) => Math.min(size / tile.w, size / tile.h);

/** The model's input: planar, blue-green-red, 0 to 255, padded with grey. `rgba` is the tile already resized to fit the square. */
export function toInput(rgba: Uint8ClampedArray, width: number, height: number, size = DETECTOR_MODEL.inputSize): Float32Array {
  const plane = size * size;
  const out = new Float32Array(plane * 3).fill(114);
  for (let y = 0; y < Math.min(height, size); y += 1) {
    for (let x = 0; x < Math.min(width, size); x += 1) {
      const from = (y * width + x) * 4;
      const to = y * size + x;
      out[to] = rgba[from + 2];
      out[plane + to] = rgba[from + 1];
      out[2 * plane + to] = rgba[from];
    }
  }
  return out;
}

const iou = (a: Box, b: Box) => {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/** Turn the model's raw output for one tile into boxes in the photo's own pixels. */
export function decodeTile(output: Float32Array, tile: Box, minScore = 0.3): Detection[] {
  if (output.length !== OUTPUT_ROWS * ROW) throw new Error('The subject detector returned an unexpected result.');
  const scale = tileScale(tile);
  const found: Detection[] = [];
  let row = 0;
  for (const stride of STRIDES) {
    const cells = DETECTOR_MODEL.inputSize / stride;
    for (let gy = 0; gy < cells; gy += 1) {
      for (let gx = 0; gx < cells; gx += 1, row += 1) {
        const at = row * ROW;
        const objectness = output[at + 4];
        if (objectness < minScore) continue;
        let best = -1;
        let bestScore = 0;
        for (const id of Object.keys(SUBJECT_CLASSES)) {
          const score = output[at + 5 + Number(id)];
          if (score > bestScore) { bestScore = score; best = Number(id); }
        }
        const score = objectness * bestScore;
        if (best < 0 || score < minScore) continue;
        const cx = (output[at] + gx) * stride;
        const cy = (output[at + 1] + gy) * stride;
        const w = Math.exp(output[at + 2]) * stride;
        const h = Math.exp(output[at + 3]) * stride;
        found.push({
          label: SUBJECT_CLASSES[best], classId: best, score,
          box: { x: tile.x + (cx - w / 2) / scale, y: tile.y + (cy - h / 2) / scale, w: w / scale, h: h / scale },
        });
      }
    }
  }
  return found;
}

/** Keep the best box where several overlap, within each kind of subject. */
export function mergeDetections(all: Detection[], threshold = 0.5): Detection[] {
  const kept: Detection[] = [];
  for (const candidate of [...all].sort((a, b) => b.score - a.score)) {
    if (!kept.some((other) => other.classId === candidate.classId && iou(other.box, candidate.box) > threshold)) kept.push(candidate);
  }
  return kept;
}

/** Edge strength inside a box, in a fixed-size view so photos and subjects of any size compare fairly. Higher is sharper. */
export function boxSharpness(rgba: Uint8ClampedArray, width: number, height: number): number {
  if (width < 4 || height < 4) return 0;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) luma[i] = 0.213 * rgba[i * 4] + 0.715 * rgba[i * 4 + 1] + 0.072 * rgba[i * 4 + 2];
  let sum = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      sum += Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width]);
    }
  }
  return sum / ((width - 2) * (height - 2));
}
