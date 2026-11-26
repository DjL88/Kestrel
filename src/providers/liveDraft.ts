import type { PhotoEdit } from '../core/photoEdits';
import type { PhotoFraming } from '../core/photoFraming';

/**
 * The quick picture drawn while a slider is dragged (liveDraftWorker.ts does the work). The page sends each picture's
 * framed source once, then only the edit for each step; the worker answers with an ImageBitmap the page draws straight onto
 * the live canvas. One draw at a time per picture on screen, and the newest step wins: a step overtaken before it starts
 * resolves to null without any work, so the picture never falls behind the slider.
 */
export type LiveDraftRequest =
  | { type: 'base'; slot: string; key: string; base: ImageBitmap; lensCentre: LensCentre }
  | { type: 'base-file'; slot: string; key: string; blob: Blob; framing: PhotoFraming; longEdge: number }
  | { type: 'release'; slot: string }
  | { type: 'draw'; id: number; slot: string; key: string; edge: number; edit: PhotoEdit };

/** Where the lens's centre falls in the framed picture (photoFraming.ts lensCentre). */
export type LensCentre = { x: number; y: number; r: number };

export type LiveDraftReply = { id: number; missing: true } | { id: number; bitmap: ImageBitmap; ms: number };

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate'> & {
  onmessage: ((event: MessageEvent<LiveDraftReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export interface LiveDraftClient {
  /** The framed full-size picture an edit is drawn from, already on the page (from a full render). */
  sendBase(slot: string, key: string, base: ImageBitmap, lensCentre: LensCentre): void;
  /** The framed picture made from the photo file, decoded and framed in the worker. */
  sendBaseFile(slot: string, key: string, blob: Blob, framing: PhotoFraming, longEdge: number): void;
  /** The base this slot has, if any. */
  baseKey(slot: string): string | undefined;
  /** Draw this step at `edge` pixels on the long side. Null when overtaken, when the worker has no base, or on failure. */
  draw(slot: string, key: string, edge: number, edit: PhotoEdit): Promise<ImageBitmap | null>;
  release(slot: string): void;
}

export function liveDraftSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

export function createLiveDraftClient(start: () => WorkerLike): LiveDraftClient {
  let worker: WorkerLike | null = null;
  let nextId = 0;
  const bases = new Map<string, string>();
  const waiting = new Map<number, (bitmap: ImageBitmap | null) => void>();
  /** Per slot: the draw being worked on, and the newest step waiting behind it. */
  const busy = new Set<string>();
  const queued = new Map<string, { send: () => void; resolve: (bitmap: ImageBitmap | null) => void }>();

  const ensure = (): WorkerLike => {
    if (worker) return worker;
    const started = start();
    started.onmessage = (event) => {
      const reply = event.data;
      const done = waiting.get(reply.id);
      waiting.delete(reply.id);
      if (!done) { if ('bitmap' in reply) reply.bitmap.close(); return; }
      done('bitmap' in reply ? reply.bitmap : null);
    };
    started.onerror = (event) => {
      event.preventDefault?.();
      // The worker is gone, and so are the pictures it held: every slot sends its base again before drawing.
      for (const done of waiting.values()) done(null);
      waiting.clear();
      bases.clear();
      started.terminate();
      if (worker === started) worker = null;
    };
    worker = started;
    return started;
  };

  const runNext = (slot: string) => {
    busy.delete(slot);
    const next = queued.get(slot);
    if (!next) return;
    queued.delete(slot);
    next.send();
  };

  return {
    sendBase(slot, key, base, lensCentre) {
      bases.set(slot, key);
      ensure().postMessage({ type: 'base', slot, key, base, lensCentre } satisfies LiveDraftRequest, [base]);
    },
    sendBaseFile(slot, key, blob, framing, longEdge) {
      bases.set(slot, key);
      ensure().postMessage({ type: 'base-file', slot, key, blob, framing, longEdge } satisfies LiveDraftRequest);
    },
    baseKey: (slot) => bases.get(slot),
    draw(slot, key, edge, edit) {
      return new Promise<ImageBitmap | null>((resolve) => {
        if (bases.get(slot) !== key) { resolve(null); return; }
        const send = () => {
          busy.add(slot);
          const id = (nextId += 1);
          waiting.set(id, (bitmap) => { resolve(bitmap); runNext(slot); });
          try {
            ensure().postMessage({ type: 'draw', id, slot, key, edge, edit } satisfies LiveDraftRequest);
          } catch {
            waiting.delete(id);
            resolve(null);
            runNext(slot);
          }
        };
        if (!busy.has(slot)) { send(); return; }
        // Newest wins: the step that was waiting is overtaken and never drawn.
        queued.get(slot)?.resolve(null);
        queued.set(slot, { send, resolve });
      });
    },
    release(slot) {
      bases.delete(slot);
      queued.get(slot)?.resolve(null);
      queued.delete(slot);
      worker?.postMessage({ type: 'release', slot } satisfies LiveDraftRequest);
    },
  };
}

let shared: LiveDraftClient | null = null;
/** The one draft worker for the editor's pictures on this page. */
export function liveDraft(): LiveDraftClient {
  shared ??= createLiveDraftClient(() => new Worker(new URL('./liveDraftWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);
  return shared;
}
