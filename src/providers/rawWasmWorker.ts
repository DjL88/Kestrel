/**
 * Develops RAW files with Kestrel's own pipeline (crates/kestrel-raw, compiled to WebAssembly) off the interface thread,
 * so the web app develops sensor data like the desktop app does. One file at a time. Messages:
 *   in  { type: 'develop', id, url, bytes }           out { type: 'developed', id, jpeg } or { type: 'error', id, message }
 *   in  { type: 'mode', id, url, prefix, fileLength } out { type: 'mode', id, mode }      or { type: 'error', id, message }
 * After a failure that stopped the module, the next request starts a fresh instance.
 */
import { instantiateRawWasm, type RawWasm } from './wasiShim';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let compiled: Promise<WebAssembly.Module> | null = null;
/** Above this, the instance is dropped after a develop and the next file gets a fresh one (the compiled module is kept). */
const RECYCLE_ABOVE_BYTES = 256 * 1024 * 1024;
let instance: RawWasm | null = null;

async function decoder(url: string): Promise<RawWasm> {
  if (instance) return instance;
  compiled ??= fetch(url).then(async (response) => {
    if (!response.ok) throw new Error('The RAW decoder could not be loaded.');
    return WebAssembly.compile(await response.arrayBuffer());
  }).catch((error) => { compiled = null; throw error; });
  instance = await instantiateRawWasm(await compiled);
  return instance;
}

scope.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  try {
    const raw = await decoder(message.url);
    if (message.type === 'develop') {
      const jpeg = raw.develop(new Uint8Array(message.bytes as ArrayBuffer));
      // WebAssembly memory never shrinks: after a big frame, let this instance go so the memory is given back.
      if (raw.memoryBytes() > RECYCLE_ABOVE_BYTES) instance = null;
      scope.postMessage({ type: 'developed', id: message.id, jpeg: jpeg.buffer }, [jpeg.buffer]);
    } else if (message.type === 'mode') {
      scope.postMessage({ type: 'mode', id: message.id, mode: raw.sensorMode(new Uint8Array(message.prefix as ArrayBuffer), message.fileLength) });
    }
  } catch (problem) {
    // The module may be in a broken state after a trap; never reuse it.
    if (problem instanceof WebAssembly.RuntimeError || (problem instanceof Error && problem.cause instanceof WebAssembly.RuntimeError)) instance = null;
    scope.postMessage({ type: 'error', id: message.id, message: problem instanceof Error ? problem.message : 'This RAW file could not be read.' });
  }
};
