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
  /** The edit applied to a small test picture, to compare with the page's answer (workerRendersLikePage). */
  | { type: 'check'; id: number; width: number; height: number; data: Uint8ClampedArray; edit: PhotoEdit }
  /** The photo at full resolution, for the zoomed-in detail: its file, decoded in the worker. */
  | { type: 'detail-source'; slot: string; key: string; blob: Blob }
  /** One region of the framed photo, at the size it is shown, with the edit. */
  | { type: 'detail'; id: number; slot: string; key: string; framing: PhotoFraming; region: { x: number; y: number; width: number; height: number };
      scale: number; edit: PhotoEdit; view: { x: number; y: number; w: number; h: number }; aspect: number; lensCentre: LensCentre }
  | { type: 'draw'; id: number; slot: string; key: string; edge: number; edit: PhotoEdit };

/** Where the lens's centre falls in the framed picture (photoFraming.ts lensCentre). */
export type LensCentre = { x: number; y: number; r: number };

export type LiveDraftReply = { id: number; missing: true } | { id: number; bitmap: ImageBitmap; ms: number } | { id: number; pixels: Uint8ClampedArray };

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
  /** The worker's answer for an edit on a small test picture (pixels), or null. */
  check(width: number, height: number, data: Uint8ClampedArray, edit: PhotoEdit): Promise<Uint8ClampedArray | null>;
  /** Keep this photo's full-resolution file in the worker for detail (once per slot and key). */
  sendDetailSource(slot: string, key: string, blob: Blob): void;
  detailSourceKey(slot: string): string | undefined;
  /** Draw one region at full detail; newest wins per slot, null when overtaken or on failure. */
  drawDetail(request: Omit<Extract<LiveDraftRequest, { type: 'detail' }>, 'type' | 'id'>): Promise<ImageBitmap | null>;
}

export function liveDraftSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

export function createLiveDraftClient(start: () => WorkerLike): LiveDraftClient {
  let worker: WorkerLike | null = null;
  let nextId = 0;
  const bases = new Map<string, string>();
  const detailSources = new Map<string, string>();
  const detailLatest = new Map<string, number>();
  const waiting = new Map<number, (bitmap: ImageBitmap | null) => void>();
  const checks = new Map<number, (pixels: Uint8ClampedArray | null) => void>();
  /** Per slot: the draw being worked on, and the newest step waiting behind it. */
  const busy = new Set<string>();
  const queued = new Map<string, { send: () => void; resolve: (bitmap: ImageBitmap | null) => void }>();

  const ensure = (): WorkerLike => {
    if (worker) return worker;
    const started = start();
    started.onmessage = (event) => {
      const reply = event.data;
      const checked = checks.get(reply.id);
      if (checked) { checks.delete(reply.id); checked('pixels' in reply ? reply.pixels : null); return; }
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
      for (const done of checks.values()) done(null);
      checks.clear();
      bases.clear();
      detailSources.clear();
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
    check(width, height, data, edit) {
      return new Promise((resolve) => {
        const id = (nextId += 1);
        checks.set(id, resolve);
        const copy = data.slice();
        try { ensure().postMessage({ type: 'check', id, width, height, data: copy, edit } satisfies LiveDraftRequest, [copy.buffer]); }
        catch { checks.delete(id); resolve(null); }
      });
    },
    sendDetailSource(slot, key, blob) {
      detailSources.set(slot, key);
      ensure().postMessage({ type: 'detail-source', slot, key, blob } satisfies LiveDraftRequest);
    },
    detailSourceKey: (slot) => detailSources.get(slot),
    drawDetail(request) {
      return new Promise<ImageBitmap | null>((resolve) => {
        if (detailSources.get(request.slot) !== request.key) { resolve(null); return; }
        const id = (nextId += 1);
        detailLatest.set(request.slot, id);
        waiting.set(id, (bitmap) => {
          // Overtaken while it was drawn: the newer request's answer is the one shown.
          if (detailLatest.get(request.slot) !== id) { bitmap?.close(); resolve(null); return; }
          resolve(bitmap);
        });
        try {
          ensure().postMessage({ type: 'detail', id, ...request } satisfies LiveDraftRequest);
        } catch {
          waiting.delete(id);
          resolve(null);
        }
      });
    },
    release(slot) {
      bases.delete(slot);
      detailSources.delete(slot);
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
