import { HeifUndecodableError } from './heifWasmCore';

type Reply =
  | { type: 'png'; id: number; png: Blob; width: number; height: number }
  | { type: 'pixels'; id: number; width: number; height: number; data: ArrayBuffer }
  | { type: 'error'; id: number; message: string; undecodable: boolean };

/** Above this many pixels the worker is let go after the photo, so the WebAssembly memory it grew is given back. */
const RECYCLE_ABOVE_PIXELS = 24_000_000;

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void }>();
// One photo at a time: a 48-megapixel phone frame needs a few hundred megabytes while it decodes.
let queue: Promise<unknown> = Promise.resolve();

function ensureWorker(): Worker {
  if (worker) return worker;
  const started = new Worker(new URL('./heifWasmWorker.ts', import.meta.url), { type: 'module' });
  started.onmessage = (event: MessageEvent<Reply>) => {
    const pending = waiting.get(event.data.id);
    if (!pending) return;
    waiting.delete(event.data.id);
    pending.resolve(event.data);
  };
  started.onerror = (event) => {
    // The worker itself failed (out of memory, or the decoder could not load): fail what was waiting, start afresh next time.
    event.preventDefault();
    for (const pending of waiting.values()) pending.reject(new HeifUndecodableError('InFlight ran out of room decoding this HEIF photo.'));
    waiting.clear();
    started.terminate();
    if (worker === started) worker = null;
  };
  worker = started;
  return started;
}

function inWorker(bytes: ArrayBuffer): Promise<Reply> {
  const run = () => new Promise<Reply>((resolve, reject) => {
    const id = (nextId += 1);
    waiting.set(id, { resolve, reject });
    ensureWorker().postMessage({ id, bytes }, [bytes]);
  });
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

async function encodePng(width: number, height: number, data: ArrayBuffer): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new HeifUndecodableError('InFlight could not prepare this HEIF photo for display.');
  context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!png) throw new HeifUndecodableError('InFlight could not prepare this HEIF photo for display.');
  return png;
}

/**
 * Decode a HEIF original to a full-size PNG. Rejects with HeifUndecodableError and a plain English reason when the file
 * cannot be decoded (damaged, an unsupported codec, or too large); the interface then shows its own translated message.
 */
export async function decodeHeifToPng(original: Blob): Promise<Blob> {
  // Every platform InFlight ships on has both; the decoder is shipped once, in the worker.
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
    throw new HeifUndecodableError('This browser cannot run InFlight’s HEIF decoder.');
  }
  const reply = await inWorker(await original.arrayBuffer());
  if (reply.type === 'error') {
    throw new HeifUndecodableError(reply.undecodable && reply.message ? reply.message : 'This HEIF photo could not be decoded.');
  }
  if (reply.width * reply.height > RECYCLE_ABOVE_PIXELS && worker) {
    worker.terminate();
    worker = null;
  }
  return reply.type === 'png' ? reply.png : encodePng(reply.width, reply.height, reply.data);
}
