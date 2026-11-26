import { mergeHdr, type HdrOptions, type HdrResult, type HdrSource, type HdrStage } from '../core/hdrMerge';

/**
 * Runs the HDR merge (src/core/hdrMerge.ts) in a Web Worker so the editor keeps responding while a big bracket works.
 * Frames cross either as ImageBitmaps (verified raster originals, read in bands through an OffscreenCanvas) or as
 * 16-bit RGB pictures (a RAW's full-size 16-bit develop); both are transferred, not copied. Where a Worker,
 * OffscreenCanvas or ImageBitmap is missing, or the worker stops, the same merge runs on this thread and
 * `onMainThread` says so. Cancel stops the worker outright.
 */

export type HdrFrameInput =
  | { kind: 'picture'; image: CanvasImageSource }
  | { kind: 'rgb16'; width: number; height: number; data: Uint16Array };

type WireFrame = { kind: 'bitmap'; bitmap: ImageBitmap } | { kind: 'rgb16'; width: number; height: number; data: Uint16Array };
export type HdrMergeRequest = { frames: WireFrame[]; options: Omit<HdrOptions, 'signal' | 'onProgress'> };
export type HdrMergeMessage =
  | { type: 'progress'; done: number; total: number; stage: HdrStage }
  | { type: 'result'; result: HdrResult }
  | { type: 'error'; message: string };

/** The part of `Worker` used here, so tests can stand in a fake. */
export interface HdrWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

/** Rows of a 16-bit RGB picture as RGBA, without copying the whole picture. */
export function rgb16Source(width: number, height: number, data: Uint16Array): HdrSource {
  return {
    width, height, bits: 16,
    readRows: (y0, rows) => {
      const out = new Uint16Array(width * rows * 4);
      for (let p = 0, q = y0 * width * 3, n = width * rows; p < n; p++, q += 3) {
        out[p * 4] = data[q]; out[p * 4 + 1] = data[q + 1]; out[p * 4 + 2] = data[q + 2]; out[p * 4 + 3] = 65535;
      }
      return out;
    },
  };
}

/** Rows of a decoded picture through a band-sized canvas (an OffscreenCanvas in the worker). */
export function canvasSource(image: CanvasImageSource, width: number, height: number,
  makeContext: (w: number, h: number) => OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null): HdrSource {
  let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  let bandRows = 0;
  return {
    width, height, bits: 8,
    readRows: (y0, rows) => {
      if (!context || bandRows !== rows) { context = makeContext(width, rows); bandRows = rows; }
      if (!context) throw new Error('Canvas unavailable');
      context.clearRect(0, 0, width, rows);
      context.drawImage(image, 0, y0, width, rows, 0, 0, width, rows);
      return context.getImageData(0, 0, width, rows).data;
    },
  };
}

const offscreen = (w: number, h: number) => new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });

/** The worker's side, run directly by the unit tests. */
export async function runHdrMergeRequest(
  request: HdrMergeRequest, post: (message: HdrMergeMessage, transfer?: Transferable[]) => void,
  makeBitmapSource: (bitmap: ImageBitmap) => HdrSource = (bitmap) => canvasSource(bitmap, bitmap.width, bitmap.height, offscreen),
): Promise<void> {
  try {
    const sources = request.frames.map((frame) => (frame.kind === 'bitmap' ? makeBitmapSource(frame.bitmap) : rgb16Source(frame.width, frame.height, frame.data)));
    const result = await mergeHdr(sources, {
      ...request.options, onProgress: (done, total, stage) => post({ type: 'progress', done, total, stage }),
    });
    post({ type: 'result', result }, result.ok ? [result.data.buffer] : []);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    for (const frame of request.frames) if (frame.kind === 'bitmap') frame.bitmap.close?.();
  }
}

function startHdrWorker(): HdrWorkerLike {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error('Background merging is not available here.');
  }
  return new Worker(new URL('./hdrMergeWorker.ts', import.meta.url), { type: 'module' }) as unknown as HdrWorkerLike;
}

export interface OffThreadHdrOptions extends Omit<HdrOptions, 'signal'> {
  signal?: AbortSignal;
  createWorker?: () => HdrWorkerLike;
  /** Bitmaps of the decoded pictures, for the worker. Default `createImageBitmap`. */
  toBitmap?: (image: CanvasImageSource) => Promise<ImageBitmap>;
  /** The same frames on this thread, used only when the worker cannot run. */
  hereSources: () => HdrSource[];
}

/** Merge in a worker when possible. `onMainThread` is true when it had to run here. */
export async function mergeHdrOffThread(frames: readonly HdrFrameInput[], options: OffThreadHdrOptions): Promise<{ result: HdrResult; onMainThread: boolean }> {
  const { signal, onProgress, createWorker = startHdrWorker, toBitmap = (image) => createImageBitmap(image), hereSources, ...mergeOptions } = options;
  const here = async () => ({ result: await mergeHdr(hereSources(), { ...mergeOptions, signal, onProgress }), onMainThread: true });
  let worker: HdrWorkerLike;
  try { worker = createWorker(); } catch { return here(); }
  let wire: WireFrame[];
  try {
    wire = await Promise.all(frames.map(async (frame): Promise<WireFrame> => (frame.kind === 'picture'
      ? { kind: 'bitmap', bitmap: await toBitmap(frame.image) }
      // A copy crosses, so the fallback here still has its own picture if the worker is lost.
      : { kind: 'rgb16', width: frame.width, height: frame.height, data: frame.data.slice() })));
  } catch { worker.terminate(); return here(); }
  signal?.throwIfAborted();
  const transfer: Transferable[] = wire.map((frame) => (frame.kind === 'bitmap' ? frame.bitmap : frame.data.buffer));
  const outcome = await new Promise<{ result: HdrResult } | { lost: true } | { cancelled: unknown } | { error: string }>((resolve) => {
    const onAbort = () => { worker.terminate(); resolve({ cancelled: signal!.reason }); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (value: Parameters<typeof resolve>[0]) => { signal?.removeEventListener('abort', onAbort); worker.terminate(); resolve(value); };
    worker.onmessage = (event) => {
      const message = event.data as HdrMergeMessage;
      if (message.type === 'progress') onProgress?.(message.done, message.total, message.stage);
      else if (message.type === 'result') finish({ result: message.result });
      else finish({ error: message.message });
    };
    worker.onerror = () => finish({ lost: true });
    try { worker.postMessage({ frames: wire, options: mergeOptions } satisfies HdrMergeRequest, transfer); }
    catch { finish({ lost: true }); }
  });
  if ('cancelled' in outcome) throw outcome.cancelled ?? new DOMException('Merging was stopped.', 'AbortError');
  if ('error' in outcome) throw new Error(outcome.error);
  if ('lost' in outcome) { signal?.throwIfAborted(); return here(); }
  return { result: outcome.result, onMainThread: false };
}
