import type { WasmSensorMode } from './wasiShim';

/**
 * Kite44's RAW pipeline in the browser: the same Rust code as the desktop app (crates/kestrel-raw), compiled to
 * WebAssembly and run in a Web Worker. Like the bundled models, the binary is found with a glob, so a checkout without
 * it (AI Studio may omit large binaries) still builds and simply keeps showing embedded previews.
 */
const assets: Record<string, string> = (() => {
  // Vite replaces this call at build time. Outside Vite (unit tests under Node) it doesn't exist: no decoder there.
  try {
    return import.meta.glob('../assets/wasm/*.wasm', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
  } catch {
    return {};
  }
})();
const wasmUrl = assets['../assets/wasm/kestrel_raw.wasm'] ?? null;

/** Whether this build of the web app carries the RAW decoder. */
export const webRawAvailable = () => wasmUrl !== null && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';

type Reply = { type: 'developed'; id: number; jpeg: ArrayBuffer } | { type: 'developed16'; id: number; picture: ArrayBuffer } | { type: 'mode'; id: number; mode: WasmSensorMode } | { type: 'error'; id: number; message: string };

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void }>();
// One file at a time: a 45-megapixel frame needs several hundred megabytes while it develops.
let queue: Promise<unknown> = Promise.resolve();

function ensureWorker(): Worker {
  if (worker) return worker;
  const started = new Worker(new URL('./rawWasmWorker.ts', import.meta.url), { type: 'module' });
  started.onmessage = (event: MessageEvent<Reply>) => {
    const pending = waiting.get(event.data.id);
    if (!pending) return;
    waiting.delete(event.data.id);
    if (event.data.type === 'error') pending.reject(new Error(event.data.message));
    else pending.resolve(event.data);
  };
  started.onerror = (event) => {
    // The worker itself died (for example, out of memory): fail what was waiting and start afresh next time.
    event.preventDefault();
    for (const pending of waiting.values()) pending.reject(new Error('The RAW decoder ran out of room for this file. Kite44 keeps using the preview stored in the file.'));
    waiting.clear();
    started.terminate();
    if (worker === started) worker = null;
  };
  worker = started;
  return started;
}

function ask(message: Record<string, unknown>, transfer: Transferable[]): Promise<Reply> {
  const run = () => new Promise<Reply>((resolve, reject) => {
    if (!wasmUrl) { reject(new Error('This build cannot develop RAW files in the browser.')); return; }
    const id = (nextId += 1);
    waiting.set(id, { resolve, reject });
    ensureWorker().postMessage({ ...message, id, url: new URL(wasmUrl, location.href).href }, transfer);
  });
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/** Develop a RAW file's sensor data to a full-size JPEG in the browser. Rejects with a plain message. */
export async function developRawInBrowser(file: Blob): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  const reply = await ask({ type: 'develop', bytes }, [bytes]);
  if (reply.type !== 'developed') throw new Error('This RAW file could not be developed.');
  return new Blob([reply.jpeg], { type: 'image/jpeg' });
}

/** Develop a RAW file to its full-size 16-bit picture in the browser (see `parseRgb16`). Rejects with a plain message. */
export async function developRaw16InBrowser(file: Blob): Promise<ArrayBuffer> {
  const bytes = await file.arrayBuffer();
  const reply = await ask({ type: 'develop16', bytes }, [bytes]);
  if (reply.type !== 'developed16') throw new Error('This RAW file could not be developed.');
  return reply.picture;
}

/** Inspect the file header and propagate unavailable or failed inspections. */
export async function inspectSensorModeInBrowser(file: Blob, prefixBytes: number): Promise<WasmSensorMode> {
  const prefix = await file.slice(0, prefixBytes).arrayBuffer();
  const reply = await ask({ type: 'mode', prefix, fileLength: file.size }, [prefix]);
  if (reply.type !== 'mode') throw new Error('The RAW decoder could not inspect the file header.');
  return reply.mode;
}

/** Best-effort Nikon label for the review UI. */
export async function sensorModeInBrowser(file: Blob, prefixBytes: number): Promise<WasmSensorMode> {
  try {
    return await inspectSensorModeInBrowser(file, prefixBytes);
  } catch {
    return 'other';
  }
}
