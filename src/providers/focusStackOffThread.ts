import { stackFocus, type StackOptions, type StackResult, type StackSource, type StackStage } from '../core/focusStack';

/**
 * Runs focus stacking (src/core/focusStack.ts) in a Web Worker so the editor keeps responding while a big stack works.
 * The frames cross as ImageBitmaps (transferred, not copied) and the worker reads them in bands through an
 * OffscreenCanvas, exactly as the interface thread would. Where a Worker, OffscreenCanvas or ImageBitmap is missing,
 * or the worker stops, the same stacker runs on this thread instead and `onMainThread` says so. Cancel stops the worker
 * outright, so a long blend does not keep running after Cancel.
 */

export type FocusStackRequest = { bitmaps: ImageBitmap[]; options: Omit<StackOptions, 'signal' | 'onProgress'> };
export type FocusStackMessage =
  | { type: 'progress'; done: number; total: number; stage: StackStage }
  | { type: 'result'; result: StackResult }
  | { type: 'error'; message: string };

/** The part of `Worker` used here, so tests can stand in a fake. */
export interface StackWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

/** Rows of a bitmap through a band-sized OffscreenCanvas. */
export function bitmapStackSource(bitmap: ImageBitmap, makeCanvas: (w: number, h: number) => OffscreenCanvas = (w, h) => new OffscreenCanvas(w, h)): StackSource {
  const width = bitmap.width, height = bitmap.height;
  let canvas: OffscreenCanvas | null = null;
  let context: OffscreenCanvasRenderingContext2D | null = null;
  return {
    width, height, bits: 8,
    readRows: (y0, rows) => {
      if (!canvas || canvas.height !== rows) {
        canvas = makeCanvas(width, rows);
        context = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (!context) throw new Error('Canvas unavailable');
      context.clearRect(0, 0, width, rows);
      context.drawImage(bitmap, 0, y0, width, rows, 0, 0, width, rows);
      return context.getImageData(0, 0, width, rows).data;
    },
  };
}

/** The worker's side, run directly by the unit tests. */
export async function runFocusStackRequest(
  request: FocusStackRequest, post: (message: FocusStackMessage, transfer?: Transferable[]) => void,
  makeSource: (bitmap: ImageBitmap) => StackSource = (bitmap) => bitmapStackSource(bitmap),
): Promise<void> {
  try {
    const result = await stackFocus(request.bitmaps.map(makeSource), {
      ...request.options, onProgress: (done, total, stage) => post({ type: 'progress', done, total, stage }),
    });
    post({ type: 'result', result }, result.ok ? [result.data.buffer] : []);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    for (const bitmap of request.bitmaps) bitmap.close?.();
  }
}

class WorkerUnavailable extends Error {}

function startStackWorker(): StackWorkerLike {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new WorkerUnavailable('Background stacking is not available here.');
  }
  return new Worker(new URL('./focusStackWorker.ts', import.meta.url), { type: 'module' }) as unknown as StackWorkerLike;
}

export interface OffThreadStackOptions extends Omit<StackOptions, 'signal'> {
  signal?: AbortSignal;
  createWorker?: () => StackWorkerLike;
  /** Bitmaps of the frames, for the worker. Default `createImageBitmap`. */
  toBitmap?: (image: CanvasImageSource) => Promise<ImageBitmap>;
  /** The same frames on this thread, used only when the worker cannot run. */
  hereSources: () => StackSource[];
}

/** Stack in a worker when possible. `onMainThread` is true when it had to run here. */
export async function stackFocusOffThread(images: readonly CanvasImageSource[], options: OffThreadStackOptions): Promise<{ result: StackResult; onMainThread: boolean }> {
  const { signal, onProgress, createWorker = startStackWorker, toBitmap = (image) => createImageBitmap(image), hereSources, ...stackOptions } = options;
  const here = async () => ({ result: await stackFocus(hereSources(), { ...stackOptions, signal, onProgress }), onMainThread: true });
  let worker: StackWorkerLike;
  try { worker = createWorker(); } catch { return here(); }
  let bitmaps: ImageBitmap[];
  try { bitmaps = await Promise.all(images.map((image) => toBitmap(image))); }
  catch { worker.terminate(); return here(); }
  signal?.throwIfAborted();
  const outcome = await new Promise<{ result: StackResult } | { lost: true } | { cancelled: unknown } | { error: string }>((resolve) => {
    const onAbort = () => { worker.terminate(); resolve({ cancelled: signal!.reason }); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (value: Parameters<typeof resolve>[0]) => { signal?.removeEventListener('abort', onAbort); worker.terminate(); resolve(value); };
    worker.onmessage = (event) => {
      const message = event.data as FocusStackMessage;
      if (message.type === 'progress') onProgress?.(message.done, message.total, message.stage);
      else if (message.type === 'result') finish({ result: message.result });
      else finish({ error: message.message });
    };
    worker.onerror = () => finish({ lost: true });
    try { worker.postMessage({ bitmaps, options: stackOptions } satisfies FocusStackRequest, bitmaps); }
    catch { finish({ lost: true }); }
  });
  if ('cancelled' in outcome) throw outcome.cancelled ?? new DOMException('Stacking was stopped.', 'AbortError');
  if ('error' in outcome) throw new Error(outcome.error);
  if ('lost' in outcome) { signal?.throwIfAborted(); return here(); }
  return { result: outcome.result, onMainThread: false };
}
