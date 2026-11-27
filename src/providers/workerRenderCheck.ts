import type { PhotoEdit } from '../core/photoEdits';

/**
 * Whether the drag worker draws a kind of edit exactly as the page does, byte for byte, on this device. The editor draws
 * its full-quality picture in the worker only for a kind of edit found to match (FrameImage verifyWorker), so moving that
 * work off the page never changes a pixel. Graphics differ between machines: on the CI runner a real edit differed while
 * a small fixed test edit matched (27 Nov), so each kind of edit is checked with the real edit, once.
 */
export function samePixels(a: ArrayLike<number> | null, b: ArrayLike<number> | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
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
