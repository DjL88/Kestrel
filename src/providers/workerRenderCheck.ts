import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import type { PhotoEdit } from '../core/photoEdits';
import { liveDraft, liveDraftSupported } from './liveDraft';
import { measureStep } from './previewTiming';

/**
 * Whether the drag worker draws an edit exactly as the page does, byte for byte, on this device. The editor draws its
 * full-quality picture in the worker only when it does (FrameImage), so moving that work off the page never changes a
 * pixel. Graphics drivers differ: where the worker has no WebGL, or its WebGL answers differently, every full-quality
 * picture is drawn on the page, as before. Asked once per page, on a small test picture with tone, colour, detail and an
 * early stage, the parts that run on the graphics card on the page.
 */
export const CHECK_EDIT: PhotoEdit = {
  exposure: 0.4, warmth: 0.2, colour: -0.15, contrast: 0.2, highlights: -0.3, shadows: 0.25, clarity: 0.3, sharpen: 0.4, dehaze: 0.2,
} as PhotoEdit;

/** A test picture with smooth gradients, edges and fine texture, so every part of the edit has something to change. */
export function checkPicture(width = 192, height = 128): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((seed >> 8) % 21) - 10;
    const edge = (x > width / 2) !== (y > height / 2) ? 60 : 0;
    const i = (y * width + x) * 4;
    data[i] = (x * 255) / width + noise + edge; data[i + 1] = (y * 255) / height + noise; data[i + 2] = 128 + noise - edge; data[i + 3] = 255;
  }
  return data;
}

export function samePixels(a: ArrayLike<number> | null, b: ArrayLike<number> | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

let verdict: Promise<boolean> | null = null;
export function workerRendersLikePage(): Promise<boolean> {
  verdict ??= (async () => {
    if (!liveDraftSupported() || typeof document === 'undefined') return false;
    const started = performance.now();
    const width = 192, height = 128;
    const data = checkPicture(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.putImageData(new ImageData(data.slice(), width, height), 0, 0);
    applyCanvasPhotoEdit(canvas, CHECK_EDIT);
    const onPage = context.getImageData(0, 0, width, height).data;
    const inWorker = await liveDraft().check(width, height, data, CHECK_EDIT);
    const same = samePixels(onPage, inWorker);
    // The verdict is kept as a mark (inflight:preview:worker-check, detail.same) for traces and tests.
    measureStep('preview:worker-check', started, { same });
    if (!same) console.info('The drag worker draws edits differently from the page here, so full-quality pictures are drawn on the page.');
    return same;
  })().catch(() => false);
  return verdict;
}

/**
 * Which parts of the edit maths an edit uses (the settings it changes from neutral), so its picture follows the same
 * code on the graphics card and the processor as any other edit with the same parts. Values do not matter, only which.
 */
export function renderSignature(edit: PhotoEdit): string {
  const active = (value: unknown): boolean => {
    if (value === undefined || value === null || value === false || value === 0 || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(active);
    return true;
  };
  return Object.keys(edit).filter((key) => active((edit as unknown as Record<string, unknown>)[key])).sort().join(',');
}

/**
 * Per signature, whether the worker's full-quality picture was found byte for byte the page's, the first time that
 * kind of edit was drawn (both drew it from the same framed picture). A small test picture alone was not enough: on
 * the CI runner it matched while a real edit did not (27 Nov). Unknown and "no" both mean the page draws it.
 */
const verdicts = new Map<string, boolean>();
export const workerVerdict = (signature: string): boolean | undefined => verdicts.get(signature);
export function recordWorkerVerdict(signature: string, same: boolean): void {
  // A "no" is final for this page; a "yes" never overrides one.
  if (verdicts.get(signature) === false) return;
  verdicts.set(signature, same);
}
