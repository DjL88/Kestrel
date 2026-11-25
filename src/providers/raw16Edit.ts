import { frameAndEditRgb16, type Rgb16Image } from '../core/master16';
import type { PhotoEdit } from '../core/photoEdits';
import type { PhotoFraming } from '../core/photoFraming';

type Reply = { width: number; height: number; data: ArrayBuffer; offset: number; length: number } | { error: string };

/** How a worker is started; replaced in tests. Null where workers are not available (the work then runs here). */
export type StartWorker = () => Worker | null;
const startEditWorker: StartWorker = () =>
  typeof Worker === 'undefined' ? null : new Worker(new URL('./raw16EditWorker.ts', import.meta.url), { type: 'module' });

/**
 * Frame and edit a full-size 16-bit picture in a worker, with exactly the maths of `frameAndEditRgb16` (it runs that
 * same function). With `shared`, `picture` is left untouched and a copy goes to the worker; otherwise its buffer is
 * handed over and `picture` must not be used again. Cancelling ends the worker at once, so a cancelled export frees its
 * memory instead of finishing in the background. Without workers (tests, very old browsers) it runs here instead.
 */
export async function frameAndEditOffThread(picture: Rgb16Image, turn: number, edit: PhotoEdit, framing: PhotoFraming | undefined,
  options?: { shared?: boolean; signal?: AbortSignal }, start: StartWorker = startEditWorker): Promise<Rgb16Image> {
  options?.signal?.throwIfAborted();
  let worker: Worker | null = null;
  try { worker = start(); } catch { worker = null; }
  if (!worker) {
    const input = options?.shared ? { ...picture, data: picture.data.slice() } : picture;
    return frameAndEditRgb16(input, turn, edit, framing);
  }
  const running = worker;
  return new Promise<Rgb16Image>((resolve, reject) => {
    const finish = () => { running.terminate(); options?.signal?.removeEventListener('abort', cancel); };
    const cancel = () => { finish(); reject(options?.signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
    options?.signal?.addEventListener('abort', cancel, { once: true });
    running.onmessage = (event: MessageEvent<Reply>) => {
      finish();
      const reply = event.data;
      if ('error' in reply) reject(new Error(reply.error));
      else resolve({ width: reply.width, height: reply.height, data: new Uint16Array(reply.data, reply.offset, reply.length) });
    };
    running.onerror = (event) => {
      event.preventDefault?.();
      finish();
      reject(new Error('The 16-bit picture could not be made: the background worker stopped.'));
    };
    // A shared picture is copied; otherwise its own buffer is handed over (it may hold a small header before the pixels).
    const pixels = options?.shared ? picture.data.slice() : picture.data;
    const data = pixels.buffer as ArrayBuffer;
    running.postMessage({ width: picture.width, height: picture.height, data, offset: pixels.byteOffset, length: pixels.length, turn, edit, framing }, [data]);
  });
}
