/**
 * Runs the subject-detection model off the interface thread, so the app stays usable while photos are scanned.
 * One model session per worker; several workers can run at once. Messages:
 *   in  { type: 'init', model, ort? }  (model: the checked file's bytes) out { type: 'ready', loadMs } or { type: 'error', message }
 *   in  { type: 'run', id, input, size }                out { type: 'result', id, data, runMs } or { type: 'error', id, message }
 * The times go back to the interface thread for Settings → Models (src/core/modelStats.ts).
 */
import { createOrtSession, loadOrt, ortOptions, readOrtPlan } from './ortRuntime';

type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let ort: Ort | null = null;
let session: Session | null = null;

scope.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      // The page sends the plan (src/core/ortThreads.ts): one thread on the web and phones, a share of the cores on the isolated desktop app.
      const plan = readOrtPlan(message.ort);
      ort = await loadOrt(plan);
      const started = performance.now();
      session = await createOrtSession(ort, new Uint8Array(message.model as ArrayBuffer), ortOptions(plan));
      scope.postMessage({ type: 'ready', loadMs: performance.now() - started });
    } else if (message.type === 'run') {
      if (!ort || !session) throw new Error('The subject detector is not ready.');
      const size: number = message.size;
      const started = performance.now();
      const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', message.input as Float32Array, [1, 3, size, size]) });
      const data = results[session.outputNames[0]]?.data;
      if (!(data instanceof Float32Array)) throw new Error('The subject detector returned an unexpected result.');
      const copy = new Float32Array(data); // Detach from the runtime's own memory before handing it over.
      scope.postMessage({ type: 'result', id: message.id, data: copy, runMs: performance.now() - started }, [copy.buffer]);
    }
  } catch (problem) {
    scope.postMessage({ type: 'error', id: message.id, message: problem instanceof Error ? problem.message : String(problem) });
  }
};
