/**
 * BiRefNet-lite (Zheng et al., MIT; Swin-T backbone): a fine-edge subject mask for feathers, fur and whiskers, as a
 * desktop "fine detail" pack beside the built-in U²-Netp mask. It reads the whole picture resized to 1024 x 1024
 * (ImageNet mean and standard deviation) and gives a soft alpha at 1024 x 1024, resampled here to the mask size.
 * The alpha is soft on purpose: edge pixels between 0 and 1 are the fine detail, never thresholded away.
 */
export const BIREFNET_INPUT = 1024;
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

export function birefnetInput(rgba: Uint8ClampedArray, size = BIREFNET_INPUT): Float32Array {
  const plane = size * size;
  if (rgba.length < plane * 4) throw new RangeError('The picture is smaller than the model input.');
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) for (let c = 0; c < 3; c += 1) out[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  return out;
}

export interface SoftMask {
  w: number;
  h: number;
  /** 0..255 alpha, row by row. */
  alpha: Uint8Array;
  /** Share of the frame at alpha >= 0.5. */
  coverage: number;
  /** Share of the frame that is soft edge (alpha strictly between 0.05 and 0.95). */
  edgeShare: number;
}

/**
 * The model's square output (logits or probabilities) resampled bilinearly to w x h. A non-finite value refuses the
 * whole mask, so a broken run can never become a selection.
 */
export function birefnetMask(raw: Float32Array, w: number, h: number, size = BIREFNET_INPUT): SoftMask {
  if (raw.length !== size * size) throw new Error('The fine-edge mask model returned an unexpected result.');
  if (!(Number.isSafeInteger(w) && Number.isSafeInteger(h) && w > 0 && h > 0)) throw new RangeError('Invalid mask size.');
  let logits = false;
  for (const v of raw) {
    if (!Number.isFinite(v)) throw new Error('The fine-edge mask model returned an invalid result.');
    if (v < 0 || v > 1) logits = true;
  }
  const p = (i: number) => (logits ? 1 / (1 + Math.exp(-raw[i])) : raw[i]);
  const alpha = new Uint8Array(w * h);
  let inside = 0;
  let edge = 0;
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(size - 1, Math.max(0, ((y + 0.5) * size) / h - 0.5));
    const y0 = Math.floor(sy); const y1 = Math.min(size - 1, y0 + 1); const fy = sy - y0;
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(size - 1, Math.max(0, ((x + 0.5) * size) / w - 0.5));
      const x0 = Math.floor(sx); const x1 = Math.min(size - 1, x0 + 1); const fx = sx - x0;
      const v = (p(y0 * size + x0) * (1 - fx) + p(y0 * size + x1) * fx) * (1 - fy) + (p(y1 * size + x0) * (1 - fx) + p(y1 * size + x1) * fx) * fy;
      alpha[y * w + x] = Math.round(v * 255);
      if (v >= 0.5) inside += 1;
      if (v > 0.05 && v < 0.95) edge += 1;
    }
  }
  return { w, h, alpha, coverage: inside / (w * h), edgeShare: edge / (w * h) };
}

export interface MaskComparison {
  /** Overlap of the two subjects (alpha >= 0.5), 0..1. */
  iou: number;
  /** Share of the fine mask's subject the coarse mask missed: fine edges such as wing tips, tail and whiskers. */
  gain: number;
  /** Share of the coarse mask's subject the fine mask left out. */
  loss: number;
}

/**
 * Compare the fine-edge mask with the built-in coarse one, both 0..255 alpha at the same size. This is what the
 * guardian's whole-subject check reads: a large gain means the coarse mask cut off part of the subject.
 */
export function compareSubjectMasks(coarse: Uint8Array, fine: Uint8Array): MaskComparison {
  if (coarse.length !== fine.length || !coarse.length) throw new RangeError('Masks differ in size.');
  let both = 0; let coarseOnly = 0; let fineOnly = 0;
  for (let i = 0; i < coarse.length; i += 1) {
    const c = coarse[i] >= 128; const f = fine[i] >= 128;
    if (c && f) both += 1; else if (c) coarseOnly += 1; else if (f) fineOnly += 1;
  }
  const union = both + coarseOnly + fineOnly;
  return {
    iou: union ? both / union : 0,
    gain: both + fineOnly ? fineOnly / (both + fineOnly) : 0,
    loss: both + coarseOnly ? coarseOnly / (both + coarseOnly) : 0,
  };
}

/** Use the fine mask only when both models clearly found the same subject; otherwise the built-in mask stays. */
export const SAME_SUBJECT_IOU = 0.6;
export const preferFineMask = (comparison: MaskComparison) => comparison.iou >= SAME_SUBJECT_IOU;
