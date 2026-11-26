import { stitchPanorama, type PanoOptions, type PanoResult, type PanoSource, type PanoStage } from '../core/panorama';

/**
 * Runs panorama stitching (src/core/panorama.ts) in a Web Worker so the editor keeps responding while it works. The
 * frames cross as ImageBitmaps (transferred, not copied) and the worker reads them through an OffscreenCanvas. Where
 * a Worker, OffscreenCanvas or ImageBitmap is missing, or the worker stops, the same stitcher runs on this thread and
 * `onMainThread` says so. Cancel stops the worker outright.
 */

export type PanoramaRequest = { bitmaps: ImageBitmap[]; options: Omit<PanoOptions, 'signal' | 'onProgress'> };
export type PanoramaMessage =
  | { type: 'progress'; done: number; total: number; stage: PanoStage }
  | { type: 'result'; result: PanoResult }
  | { type: 'error'; message: string };

/** The part of `Worker` used here, so tests can stand in a fake. */
export interface PanoWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

/** A bitmap's full-size RGBA through an OffscreenCanvas. */
export function bitmapPanoSource(bitmap: ImageBitmap, makeCanvas: (w: number, h: number) => OffscreenCanvas = (w, h) => new OffscreenCanvas(w, h)): PanoSource {
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data, bits: 8 };
}

/** The worker's side, run directly by the unit tests. */
export async function runPanoramaRequest(
  request: PanoramaRequest, post: (message: PanoramaMessage, transfer?: Transferable[]) => void,
  makeSource: (bitmap: ImageBitmap) => PanoSource = (bitmap) => bitmapPanoSource(bitmap),
): Promise<void> {
  try {
    const sources = request.bitmaps.map((bitmap) => { const source = makeSource(bitmap); bitmap.close?.(); return source; });
    const result = await stitchPanorama(sources, {
      ...request.options, onProgress: (done, total, stage) => post({ type: 'progress', done, total, stage }),
    });
    post({ type: 'result', result }, result.ok ? [result.data.buffer] : []);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    for (const bitmap of request.bitmaps) bitmap.close?.();
  }
}

function startPanoWorker(): PanoWorkerLike {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error('Background stitching is not available here.');
  }
  return new Worker(new URL('./panoramaWorker.ts', import.meta.url), { type: 'module' }) as unknown as PanoWorkerLike;
}

export interface OffThreadPanoOptions extends Omit<PanoOptions, 'signal'> {
  signal?: AbortSignal;
  createWorker?: () => PanoWorkerLike;
  /** Bitmaps of the frames, for the worker. Default `createImageBitmap`. */
  toBitmap?: (image: CanvasImageSource) => Promise<ImageBitmap>;
  /** The same frames on this thread, used only when the worker cannot run. */
  hereSources: () => PanoSource[];
}

/** Stitch in a worker when possible. `onMainThread` is true when it had to run here. */
export async function stitchPanoramaOffThread(images: readonly CanvasImageSource[], options: OffThreadPanoOptions): Promise<{ result: PanoResult; onMainThread: boolean }> {
  const { signal, onProgress, createWorker = startPanoWorker, toBitmap = (image) => createImageBitmap(image), hereSources, ...stitchOptions } = options;
  const here = async () => ({ result: await stitchPanorama(hereSources(), { ...stitchOptions, signal, onProgress }), onMainThread: true });
  let worker: PanoWorkerLike;
  try { worker = createWorker(); } catch { return here(); }
  let bitmaps: ImageBitmap[];
  try { bitmaps = await Promise.all(images.map((image) => toBitmap(image))); }
  catch { worker.terminate(); return here(); }
  signal?.throwIfAborted();
  const outcome = await new Promise<{ result: PanoResult } | { lost: true } | { cancelled: unknown } | { error: string }>((resolve) => {
    const onAbort = () => { worker.terminate(); resolve({ cancelled: signal!.reason }); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (value: Parameters<typeof resolve>[0]) => { signal?.removeEventListener('abort', onAbort); worker.terminate(); resolve(value); };
    worker.onmessage = (event) => {
      const message = event.data as PanoramaMessage;
      if (message.type === 'progress') onProgress?.(message.done, message.total, message.stage);
      else if (message.type === 'result') finish({ result: message.result });
      else finish({ error: message.message });
    };
    worker.onerror = () => finish({ lost: true });
    try { worker.postMessage({ bitmaps, options: stitchOptions } satisfies PanoramaRequest, bitmaps); }
    catch { finish({ lost: true }); }
  });
  if ('cancelled' in outcome) throw outcome.cancelled ?? new DOMException('Stitching was stopped.', 'AbortError');
  if ('error' in outcome) throw new Error(outcome.error);
  if ('lost' in outcome) { signal?.throwIfAborted(); return here(); }
  return { result: outcome.result, onMainThread: false };
}
