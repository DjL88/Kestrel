/**
 * Runs RF-DETR Nano off the interface thread, so the app stays usable while photos are scanned with the optional
 * second subject finder. One session in one worker (the model needs about 430 MB, so one copy is enough). The
 * messages are described in src/core/rfDetrWorkerProtocol.ts. The model bytes arrive already checked against their
 * pinned SHA-256; this worker never fetches anything.
 */
import { createOrtSession, loadOrt, ortOptions, readOrtPlan } from './ortRuntime';

type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

const SIZE = 384;

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
      if (!ort || !session) throw new Error('The second subject finder is not ready.');
      const started = performance.now();
      const out = await session.run({ pixel_values: new ort.Tensor('float32', message.input as Float32Array, [1, 3, SIZE, SIZE]) });
      const runMs = performance.now() - started;
      // Copy out of the runtime's own memory before handing the arrays over.
      const logits = new Float32Array(out.logits.data as Float32Array);
      const boxes = new Float32Array(out.pred_boxes.data as Float32Array);
      scope.postMessage({ type: 'result', id: message.id, logits, boxes, runMs }, [logits.buffer, boxes.buffer]);
    }
  } catch (problem) {
    scope.postMessage({ type: 'error', id: message.id, message: problem instanceof Error ? problem.message : String(problem) });
  }
};
