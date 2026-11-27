import { pixelStyleTags } from '../core/sceneTags';
import type { PhotoTag } from '../core/photoTags';
import type { PhotoEdit } from '../core/photoEdits';
import type { PhotoHistogram } from '../v2/ui/contract';

/**
 * Picture work for the background checks that run after an import, in a worker, so they never hold the interface
 * (owner, 27 Nov: "avoid being hijacked by processing power"). Where a worker cannot start, or one request fails, the
 * caller does the same work on the page as before, so the answer never goes missing.
 */
export type PixelRequest =
  | { type: 'style'; id: number; rgba: Uint8ClampedArray }
  | { type: 'thumbnail'; id: number; blob: Blob; maxWidth: number; quality: number; size: { width: number; height: number } | null }
  | { type: 'histogram'; id: number; width: number; height: number; data: Uint8ClampedArray; edit: PhotoEdit };
type Reply = { id: number; tags?: PhotoTag[]; blob?: Blob; histogram?: PhotoHistogram; failed?: true };

let worker: Worker | null = null;
let broken = false;
let nextId = 0;
const waiting = new Map<number, (reply: Reply | null) => void>();

function ensure(): Worker | null {
  if (worker || broken || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return worker;
  try {
    const started = new Worker(new URL('./pixelAnalysisWorker.ts', import.meta.url), { type: 'module' });
    started.onmessage = (event: MessageEvent<Reply>) => {
      const done = waiting.get(event.data.id);
      waiting.delete(event.data.id);
      done?.(event.data.failed ? null : event.data);
    };
    started.onerror = (event) => {
      event.preventDefault();
      broken = true;
      for (const done of waiting.values()) done(null);
      waiting.clear();
      started.terminate();
      worker = null;
    };
    worker = started;
  } catch {
    broken = true;
  }
  return worker;
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
function ask(request: WithoutId<PixelRequest>, transfer: Transferable[] = []): Promise<Reply | null> {
  const target = ensure();
  if (!target) return Promise.resolve(null);
  const id = (nextId += 1);
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    target.postMessage({ ...request, id }, transfer);
  });
}

/** The measured style tags (black and white, high key, low key); the same answer as pixelStyleTags on the page. */
export async function pixelStyleTagsOffThread(rgba: Uint8ClampedArray): Promise<PhotoTag[]> {
  // A copy goes to the worker, so the caller's pixels stay usable.
  const copy = rgba.slice();
  return (await ask({ type: 'style', rgba: copy }, [copy.buffer]))?.tags ?? pixelStyleTags(rgba);
}

/** A small JPEG thumbnail made in the worker, or null (then the caller makes it on the page, as before). */
export async function thumbnailOffThread(blob: Blob, maxWidth: number, quality: number, size: { width: number; height: number } | null): Promise<Blob | null> {
  return (await ask({ type: 'thumbnail', blob, maxWidth, quality, size }))?.blob ?? null;
}

/**
 * The histogram of a small unedited picture with this edit applied, measured in the worker (the edit maths on the
 * processor there), or null (then the caller measures on the page, as before).
 */
export async function histogramOffThread(small: ImageData, edit: PhotoEdit): Promise<PhotoHistogram | null> {
  const data = small.data.slice();
  return (await ask({ type: 'histogram', width: small.width, height: small.height, data, edit }, [data.buffer]))?.histogram ?? null;
}
