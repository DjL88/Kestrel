import { effectiveAlpha, maskAlpha, type MaskContext } from './masks';
import { denoiseEyes, isDenoisePair } from './denoiseRegions';
import type { Mask } from './maskTypes';

/**
 * A learned denoiser's result (NAFNet today, the trained TrueDetail network later), kept as a reversible part of the
 * edit. The model's output for the subject's area is stored once as a separate picture on this device (never over the
 * original, never uploaded); the recipe says which picture, where it sits in the framed photo, and how strongly it is
 * blended into the subject and eye regions of the TrueDetail denoise pair. Removing the field removes the effect.
 *
 * It is blended first, on the photo's own pixels, like the conventional noise reduction, so tone and sharpening act
 * on the cleaned picture. The 16-bit TIFF refuses it (the stored result is 8-bit), and says so, rather than drop it.
 */
export interface TrueDetailAi {
  /** Optional model pack id, e.g. 'nafnet-sidd-w32-w16'. */
  model: string;
  /** The model file's SHA-256, so the result is tied to the exact weights that made it. */
  modelSha256: string;
  /** The stored result in the device's picture store (its SHA-256 id). */
  asset: string;
  /** The framing it was made for (`framingKey`). A different crop or rotation leaves it out and says so. */
  framingKey: string;
  /** Where the stored picture sits, 0 to 1 of the framed photo. */
  rect: { x: number; y: number; w: number; h: number };
  /** The denoise pair whose subject (and eye layers) say where it applies: `<id>` of `<id>-background` + `<id>`. */
  maskId: string;
  /** Blend strength, 0 to 1, inside subjects and inside eyes. */
  subject: number;
  eyes: number;
}

const unit = (v: unknown, low = 0, high = 1): v is number => typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high;

export function validTrueDetailAi(value: unknown): value is TrueDetailAi {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const rect = v.rect as Record<string, unknown> | null;
  return typeof v.model === 'string' && /^[a-z0-9-]{1,64}$/.test(v.model) &&
    typeof v.modelSha256 === 'string' && /^[0-9a-f]{64}$/.test(v.modelSha256) &&
    typeof v.asset === 'string' && /^[0-9a-f]{64}$/.test(v.asset) &&
    typeof v.framingKey === 'string' && v.framingKey.length <= 80 &&
    typeof v.maskId === 'string' && v.maskId.length > 0 && v.maskId.length <= 200 &&
    typeof rect === 'object' && rect !== null && unit(rect.x) && unit(rect.y) && unit(rect.w, 0.001) && unit(rect.h, 0.001) &&
    (rect.x as number) + (rect.w as number) <= 1.000001 && (rect.y as number) + (rect.h as number) <= 1.000001 &&
    unit(v.subject) && unit(v.eyes);
}

/**
 * Per-pixel blend weight for this canvas: the subject's coverage times its strength, and inside an eye layer the eye
 * strength instead. Zero everywhere when the pair it names is missing or hidden (nothing is guessed).
 */
export function trueDetailAiWeight(ai: Pick<TrueDetailAi, 'maskId' | 'subject' | 'eyes'>, masks: readonly Mask[] | undefined, width: number, height: number, context: MaskContext): Float32Array {
  const weight = new Float32Array(width * height);
  const list = masks ?? [];
  const i = list.findIndex(m => m.id === ai.maskId);
  if (i < 1 || !isDenoisePair(list[i - 1], list[i])) return weight;
  const subject = list[i] as Extract<Mask, { kind: 'subject' }>;
  const alpha = maskAlpha(subject, width, height, context);
  const eye = new Float32Array(width * height);
  for (const layer of denoiseEyes(subject, list)) {
    const a = effectiveAlpha(layer, list, width, height, context);
    for (let p = 0; p < eye.length; p++) eye[p] = Math.max(eye[p], a[p]);
  }
  for (let p = 0; p < weight.length; p++) weight[p] = alpha[p] * (ai.subject + eye[p] * (ai.eyes - ai.subject));
  return weight;
}

/** The stored picture's place in a canvas that shows `context.view` of the framed photo, in whole canvas pixels. */
export function trueDetailAiPlacement(ai: TrueDetailAi, width: number, height: number, context: MaskContext): { x: number; y: number; w: number; h: number } {
  const { view } = context;
  return {
    x: (ai.rect.x - view.x) / view.w * width, y: (ai.rect.y - view.y) / view.h * height,
    w: ai.rect.w / view.w * width, h: ai.rect.h / view.h * height,
  };
}

/** Blend the learned picture into the base in place. `learned` is the same size as `base`; transparent pixels (outside
 * the stored area) leave the base untouched. Linear in display values, like the conventional pair's own blend. */
export function blendLearned(base: Uint8ClampedArray, learned: Uint8ClampedArray, weight: Float32Array): void {
  if (base.length !== learned.length || weight.length * 4 !== base.length) throw new RangeError('Learned layer must match the picture');
  for (let p = 0; p < weight.length; p++) {
    const j = p * 4;
    const w = weight[p] * learned[j + 3] / 255;
    if (w <= 0) continue;
    for (let c = 0; c < 3; c++) base[j + c] = Math.round(base[j + c] + (learned[j + c] - base[j + c]) * w);
  }
}

/** The subject's bounding area (alpha at least 0.05), padded by an eighth of its size, 0 to 1 of the picture; or null. */
export function subjectRect(alpha: Float32Array, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!(alpha[y * width + x] >= 0.05)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < x0) return null;
  const pad = Math.max(4, Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) / 8));
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  return { x: x0 / width, y: y0 / height, w: (x1 - x0 + 1) / width, h: (y1 - y0 + 1) / height };
}

/**
 * The working-size subject alpha resampled onto the full-size area the learned denoiser ran on (`rect`, 0 to 1 of the
 * framed photo), nearest sample, so the learned result can be judged on its own full-size pixels.
 */
export function alphaForArea(alpha: Float32Array, width: number, height: number, rect: { x: number; y: number; w: number; h: number }, areaWidth: number, areaHeight: number): Float32Array {
  if (alpha.length !== width * height) throw new RangeError('Alpha must match the working size');
  const out = new Float32Array(areaWidth * areaHeight);
  for (let y = 0; y < areaHeight; y++) {
    const wy = Math.min(height - 1, Math.max(0, Math.floor((rect.y + (y + 0.5) / areaHeight * rect.h) * height)));
    for (let x = 0; x < areaWidth; x++) {
      const wx = Math.min(width - 1, Math.max(0, Math.floor((rect.x + (x + 0.5) / areaWidth * rect.w) * width)));
      out[y * areaWidth + x] = alpha[wy * width + wx];
    }
  }
  return out;
}
