import type { PhotoEdit } from '../core/photoEdits';
import type { PhotoFraming } from '../core/photoFraming';
import type { Raw16Working } from './rawMaster16';
import { measureStep } from './previewTiming';

type Reply = { id: number; none: true } | { id: number; missing: true } | { id: number; width: number; height: number; rgba: ArrayBuffer };
export interface Screen16 { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }

let worker: Worker | null = null;
let nextId = 0;
const latest = new Map<string, number>();
const waiting = new Map<number, (reply: Reply | null) => void>();
let queue: Promise<unknown> = Promise.resolve();

/** Each kept 16-bit copy gets a number the first time it is sent; the worker keeps the last few by that number. */
let nextPicture = 0;
const pictureIds = new WeakMap<Raw16Working, number>();
/** The copies the current worker holds (a restarted worker holds none). */
let sent = new Set<number>();

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
    if (worker === started) { worker = null; sent = new Set(); }
  };
  worker = started;
  sent = new Set();
  return started;
}

/** Send one edit; the 16-bit copy goes with it only when the worker does not have it yet. */
function post(id: number, working: Raw16Working, edit: PhotoEdit, framing: PhotoFraming | undefined, withPicture: boolean): void {
  let picture = pictureIds.get(working);
  if (picture === undefined) { picture = (nextPicture += 1); pictureIds.set(working, picture); }
  const target = ensureWorker();
  const message: Record<string, unknown> = { id, picture, width: working.picture.width, height: working.picture.height, turn: working.turn, edit, framing };
  if (withPicture || !sent.has(picture)) {
    // Once per photo (and again only if the worker restarted or let it go): the page keeps its own copy for the histogram.
    const copyStart = performance.now();
    const data = working.picture.data.slice().buffer;
    measureStep('preview:raw16-copy', copyStart, { bytes: data.byteLength });
    message.data = data;
    sent.add(picture);
    target.postMessage(message, [data]);
    return;
  }
  target.postMessage(message);
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
    const finish = (reply: Reply | null) => resolve(reply && 'rgba' in reply
      ? { width: reply.width, height: reply.height, rgba: new Uint8ClampedArray(reply.rgba) }
      : null);
    waiting.set(id, (reply) => {
      // The worker let this copy go (it keeps the last few): send it once more with the same edit.
      if (reply && 'missing' in reply) {
        waiting.set(id, finish);
        post(id, working, edit, framing, true);
        return;
      }
      finish(reply);
    });
    post(id, working, edit, framing, false);
  });
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
