import type { SearchObservation } from '../core/photoSearch';

/**
 * Experimental platform OCR. Uses only an already available device TextDetector;
 * NEVER fetches model weights or sends image bytes over a network.
 * Disabled on platforms without a local implementation. This is not a promise
 * that a browser's TextDetector is offline: the host must explicitly certify it.
 */
export interface LocalTextReader {
  readonly deviceLocal: true;
  detect(image: ImageBitmap): Promise<readonly { rawValue: string; confidence?: number }[]>;
}
export interface OcrRegion { x: number; y: number; width: number; height: number }
export interface OcrResult { observations: SearchObservation[]; reason: string; reads: number }
export interface OcrOptions {
  signal?: AbortSignal;
  /** User explicitly requested local OCR; no background opt-in is implied. */
  consent: boolean;
  /** Host attests that this implementation is wholly offline. */
  reader?: LocalTextReader;
  region: OcrRegion;
  /** Current editor/export activity and mobile memory pressure must block work. */
  isBusy?: () => boolean;
  maxPixels?: number;
}
const empty = (reason: string, reads = 0): OcrResult => ({ observations: [], reason, reads });
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Local text check cancelled', 'AbortError');
};
const REGISTRATION = /^G-[A-Z]{4}$/;
const RING = /^[A-Z]{1,3}[ -]?[0-9]{4,8}$/;
/** Conservative: never promote arbitrary scene words or unsupported scripts. */
export function validatedMark(raw: string): string | null {
  if (typeof raw !== 'string') return null; // the optional host detector is an untrusted runtime boundary
  const value = raw.toUpperCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (value.length > 16 || value.length < 5) return null;
  return REGISTRATION.test(value) || RING.test(value) ? value : null;
}
export function corroborateOcr(
  first: readonly { rawValue: string; confidence?: number }[],
  second: readonly { rawValue: string; confidence?: number }[],
): SearchObservation[] {
  const observed = (items: readonly { rawValue: string; confidence?: number }[]) => {
    const marks = new Map<string, boolean>();
    for (const item of items) {
      // A reported low/invalid confidence is never evidence. A reader that
      // omits confidence may still suggest the text, but not call it agreement.
      if (item.confidence !== undefined && (!Number.isFinite(item.confidence) || item.confidence < 0.9)) continue;
      const value = validatedMark(item.rawValue);
      if (value) marks.set(value, (marks.get(value) ?? false) || item.confidence !== undefined);
    }
    return marks;
  };
  const a = observed(first), b = observed(second);
  // Two scalings of the same pixels are correlated: both high-confidence
  // readings may be marked agreed, but missing confidences remain needs-review.
  // Neither status is a user-confirmed tag or EXIF claim.
  return [...a].filter(([value]) => b.has(value)).slice(0, 4)
    .map(([value, high]) => ({ value, status: high && b.get(value) ? 'agreed' as const : 'needs-review' as const }));
}
function validRegion(r: OcrRegion, width: number, height: number): boolean {
  return [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
    r.x >= 0 && r.y >= 0 && r.width >= 24 && r.height >= 12 &&
    r.x + r.width <= width && r.y + r.height <= height;
}
function sharpEnough(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  let sum = 0, sum2 = 0, count = 0;
  const step = Math.max(2, Math.ceil(Math.sqrt(width * height / 4096)));
  for (let y = 1; y < height - 1; y += step) for (let x = 1; x < width - 1; x += step) {
    const i = (y * width + x) * 4;
    const grey = (j: number) => data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
    const lap = 4 * grey(i) - grey(i - 4) - grey(i + 4) - grey(i - width * 4) - grey(i + width * 4);
    sum += lap; sum2 += lap * lap; count++;
  }
  return count > 16 && sum2 / count - (sum / count) ** 2 >= 65;
}
/** Two independently rendered ROI views; bounded to a single user-invoked region. */
export async function readLocalRegion(source: CanvasImageSource & { width: number; height: number }, options: OcrOptions): Promise<OcrResult> {
  if (!options.consent) return empty('Local OCR not requested');
  if (!options.reader?.deviceLocal) return empty('No approved offline OCR reader installed');
  if (options.isBusy?.()) return empty('Editor is busy');
  if (!validRegion(options.region, source.width, source.height)) return empty('Invalid or distant text region');
  const r = options.region, limit = options.maxPixels ?? 262_144;
  // Reject NaN, fractions and out-of-range caller budgets rather than disabling the size cap.
  if (!Number.isSafeInteger(limit) || limit < 4096 || limit > 1_048_576) return empty('Invalid text-region memory budget');
  if (r.width * r.height > limit) return empty('Text region exceeds memory budget');
  abort(options.signal);
  const views: Array<{ rawValue: string; confidence?: number }[]> = [];
  for (const scale of [1, 1.25]) {
    abort(options.signal);
    if (options.isBusy?.()) return empty('Editor became busy', views.length);
    const w = Math.ceil(r.width * scale), h = Math.ceil(r.height * scale);
    if (w * h > limit) return empty('Scaled text region exceeds memory budget', views.length);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return empty('Local image processing unavailable', views.length);
    ctx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, w, h);
    if (!sharpEnough(ctx, w, h)) return empty('Text is too blurred or low-detail', views.length);
    const bitmap = await createImageBitmap(canvas);
    try {
      abort(options.signal);
      const results = await options.reader.detect(bitmap);
      abort(options.signal);
      views.push(results.slice(0, 12));
    } finally {
      bitmap.close();
      canvas.width = canvas.height = 0;
    }
  }
  const observations = corroborateOcr(views[0], views[1]);
  return { observations, reads: 2, reason: observations.length ? 'Two local crop readings agree; review before confirming' : 'Uncertain or conflicting text; abstained' };
}
