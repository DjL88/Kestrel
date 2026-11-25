/**
 * Runs one onnxruntime model session off the interface thread (src/providers/offThreadSession.ts starts it). The
 * subject outline and photo similarity models each took 1-4 s per photo on the page's own thread, so a swipe or tap
 * made meanwhile waited for them. Messages:
 *   in  { type: 'init', model }                       out { type: 'ready', loadMs, inputNames, outputNames } or { type: 'error', message }
 *   in  { type: 'run', id, feeds: { name: { data, dims } } }  out { type: 'result', id, outputs: { name: { data, dims } }, runMs } or { type: 'error', id, message }
 * The model bytes arrive already checked against their pinned SHA-256; this worker never fetches anything.
 */
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
      ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.numThreads = 1; // one thread: no cross-origin isolation needed, on any host and offline
      ort.env.wasm.proxy = false;
      const started = performance.now();
      session = await ort.InferenceSession.create(new Uint8Array(message.model as ArrayBuffer), { executionProviders: ['wasm'] });
      scope.postMessage({ type: 'ready', loadMs: performance.now() - started, inputNames: [...session.inputNames], outputNames: [...session.outputNames] });
    } else if (message.type === 'run') {
      if (!ort || !session) throw new Error('The model is not ready.');
      const feeds: Record<string, import('onnxruntime-web/wasm').Tensor> = {};
      for (const [name, value] of Object.entries(message.feeds as Record<string, { data: Float32Array; dims: number[] }>)) {
        feeds[name] = new ort.Tensor('float32', value.data, value.dims);
      }
      const started = performance.now();
      const results = await session.run(feeds);
      const runMs = performance.now() - started;
      const outputs: Record<string, { data: Float32Array; dims: number[] }> = {};
      const transfer: ArrayBuffer[] = [];
      for (const [name, tensor] of Object.entries(results)) {
        if (!(tensor.data instanceof Float32Array)) continue; // on purpose: U2-Net and DINOv2 answer in float32 only
        const data = new Float32Array(tensor.data); // out of the runtime's own memory before handing it over
        outputs[name] = { data, dims: [...tensor.dims] };
        transfer.push(data.buffer);
      }
      scope.postMessage({ type: 'result', id: message.id, outputs, runMs }, transfer);
    }
  } catch (problem) {
    scope.postMessage({ type: 'error', id: message.id, message: problem instanceof Error ? problem.message : String(problem) });
  }
};
