import type { PhotoEdit } from '../core/photoEdits';
import type { PhotoFraming } from '../core/photoFraming';
import type { Raw16Working } from './rawMaster16';

type Reply = { id: number; none: true } | { id: number; width: number; height: number; rgba: ArrayBuffer };
export interface Screen16 { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }

let worker: Worker | null = null;
let nextId = 0;
const latest = new Map<string, number>();
const waiting = new Map<number, (reply: Reply | null) => void>();
let queue: Promise<unknown> = Promise.resolve();

function ensureWorker(): Worker {
  if (worker) return worker;
  const started = new Worker(new URL('./raw16RenderWorker.ts', import.meta.url), { type: 'module' });
  started.onmessage = (event: MessageEvent<Reply>) => {
    const done = waiting.get(event.data.id);
    waiting.delete(event.data.id);
    done?.(event.data);
  };
  started.onerror = (event) => {
    event.preventDefault();
    for (const done of waiting.values()) done(null);
    waiting.clear();
    started.terminate();
    if (worker === started) worker = null;
  };
  worker = started;
  return started;
}

/**
 * The kept 16-bit copy with this edit, drawn in a worker and rounded to the screen once. One at a time, latest wins per slot (one
 * picture on screen): a request overtaken by a newer one for the same slot before it starts resolves to null without working. Null too when the edit cannot be
 * carried at 16 bits or the worker failed, and the caller keeps today's picture.
 */
export function renderRaw16Screen(slot: string, working: Raw16Working, edit: PhotoEdit, framing: PhotoFraming | undefined): Promise<Screen16 | null> {
  const id = (nextId += 1);
  latest.set(slot, id);
  const run = () => new Promise<Screen16 | null>((resolve) => {
    if (latest.get(slot) !== id || typeof Worker === 'undefined') { resolve(null); return; }
    latest.delete(slot);
    const data = working.picture.data.slice().buffer;
    waiting.set(id, (reply) => resolve(reply && !('none' in reply)
      ? { width: reply.width, height: reply.height, rgba: new Uint8ClampedArray(reply.rgba) }
      : null));
    ensureWorker().postMessage({ id, width: working.picture.width, height: working.picture.height, data, turn: working.turn, edit, framing }, [data]);
  });
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
