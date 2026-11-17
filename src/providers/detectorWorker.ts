/**
 * Runs the subject-detection model off the interface thread, so the app stays usable while photos are scanned.
 * One model session per worker; several workers can run at once. Messages:
 *   in  { type: 'init', url, bytes, sha256 }            out { type: 'ready' } or { type: 'error', message }
 *   in  { type: 'run', id, input, size }                out { type: 'result', id, data } or { type: 'error', id, message }
 */
type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let ort: Ort | null = null;
let session: Session | null = null;

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

scope.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      const response = await fetch(message.url);
      if (!response.ok) throw new Error('The subject detector could not be loaded.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== message.bytes || (await sha256Hex(bytes)) !== message.sha256) {
        throw new Error('The subject detector file does not match its checksum, so it was not used.');
      }
      ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.numThreads = 1; // One thread per worker: several workers share the cores without needing cross-origin isolation.
      ort.env.wasm.proxy = false;
      session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
      scope.postMessage({ type: 'ready' });
    } else if (message.type === 'run') {
      if (!ort || !session) throw new Error('The subject detector is not ready.');
      const size: number = message.size;
      const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', message.input as Float32Array, [1, 3, size, size]) });
      const data = results[session.outputNames[0]]?.data;
      if (!(data instanceof Float32Array)) throw new Error('The subject detector returned an unexpected result.');
      const copy = new Float32Array(data); // Detach from the runtime's own memory before handing it over.
      scope.postMessage({ type: 'result', id: message.id, data: copy }, [copy.buffer]);
    }
  } catch (problem) {
    scope.postMessage({ type: 'error', id: message.id, message: problem instanceof Error ? problem.message : String(problem) });
  }
};
